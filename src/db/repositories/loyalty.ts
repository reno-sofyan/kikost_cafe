import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { getSettings } from '@/db/repositories/settings'
import { featuresForBusinessType } from '@/lib/businessType'
import { computePointsBalance, loyaltySettingsOf, nextTierFor, pointsEarnedFor, pointsExpiryMonthsOf, tierForSpend } from '@/lib/loyalty'
import { getTrustedNow } from '@/lib/clockGuard'
import type { Customer, LoyaltyTier, Order } from '@/types/domain'

/**
 * Saldo poin TIDAK disimpan sebagai angka yang diubah-ubah: selalu dihitung dari
 * transaksi lunas pelanggan (poin didapat − ditukar) + koreksi manual. Dengan
 * begitu transaksi yang dibatalkan otomatis tak lagi dihitung, dan beberapa
 * tablet tak saling menimpa saldo saat sinkronisasi.
 */
export interface CustomerLoyalty {
  lifetimeSpend: number
  transactionCount: number
  /** Transaksi lunas terakhir (null = belum pernah). */
  lastOrderAt: number | null
  earned: number
  redeemed: number
  adjustment: number
  /** Saldo dari transaksi lunas + koreksi, setelah dikurangi poin yang hangus. */
  balance: number
  /** Poin yang sudah hangus karena melewati masa berlaku. */
  expired: number
  /** Poin berikutnya yang akan hangus & kapan (null bila tak ada masa berlaku). */
  nextExpiry: { points: number; at: number } | null
  /** Saldo dikurangi poin yang sedang dipakai di pesanan terbuka lain. */
  available: number
  tier: LoyaltyTier
  nextTier: { tier: LoyaltyTier; remaining: number } | null
}

function summarize(paid: Order[], open: Order[], customer: Customer | undefined, loyalty: ReturnType<typeof loyaltySettingsOf>, excludeOrderId?: string): CustomerLoyalty {
  const adjustment = customer?.pointsAdjustment ?? 0
  const log = customer?.pointsLog ?? []
  // Koreksi lama (sebelum ada rincian bertanggal) dianggap terjadi saat pelanggan didaftarkan.
  const legacyAdjustment = adjustment - log.reduce((s, e) => s + e.delta, 0)
  const events = [
    ...paid.flatMap((o) => [
      { at: o.paidAt ?? o.createdAt, delta: o.pointsEarned ?? 0 },
      { at: o.paidAt ?? o.createdAt, delta: -(o.pointsRedeemed ?? 0) },
    ]),
    ...log.map((e) => ({ at: e.at, delta: e.delta })),
    { at: customer?.createdAt ?? 0, delta: legacyAdjustment },
  ]
  const points = computePointsBalance(events, pointsExpiryMonthsOf(loyalty), getTrustedNow())
  const lifetimeSpend = paid.reduce((s, o) => s + o.grandTotal, 0)
  const earned = paid.reduce((s, o) => s + (o.pointsEarned ?? 0), 0)
  const redeemed = paid.reduce((s, o) => s + (o.pointsRedeemed ?? 0), 0)
  const reserved = open.filter((o) => o.id !== excludeOrderId).reduce((s, o) => s + (o.pointsRedeemed ?? 0), 0)
  const balance = points.balance
  return {
    lifetimeSpend,
    transactionCount: paid.length,
    lastOrderAt: paid.length ? Math.max(...paid.map((o) => o.paidAt ?? o.createdAt)) : null,
    earned,
    redeemed,
    adjustment,
    balance,
    expired: points.expired,
    nextExpiry: points.nextExpiry,
    available: Math.max(0, balance - reserved),
    tier: tierForSpend(lifetimeSpend, loyalty),
    nextTier: nextTierFor(lifetimeSpend, loyalty),
  }
}

/** `excludeOrderId`: pesanan yang sedang diedit — poin yang dipakainya tak dihitung "terpakai di tempat lain". */
export async function getCustomerLoyalty(customerId: string, excludeOrderId?: string): Promise<CustomerLoyalty> {
  const loyalty = loyaltySettingsOf(await getSettings())
  const customer = await db.customers.get(customerId)
  const paid = await db.orders.where('status').anyOf(['paid', 'completed']).filter((o) => o.customerId === customerId).toArray()
  const open = await db.orders.where('status').equals('open').filter((o) => o.customerId === customerId).toArray()
  return summarize(paid, open, customer, loyalty, excludeOrderId)
}

/** Ringkasan member untuk semua pelanggan sekaligus (layar Pelanggan). */
export async function listCustomerLoyalty(): Promise<Map<string, CustomerLoyalty>> {
  const loyalty = loyaltySettingsOf(await getSettings())
  const customers = await db.customers.toArray()
  const orders = await db.orders.where('status').anyOf(['paid', 'completed', 'open']).filter((o) => !!o.customerId).toArray()
  const byCustomer = new Map<string, { paid: Order[]; open: Order[] }>()
  for (const o of orders) {
    const bucket = byCustomer.get(o.customerId as string) ?? { paid: [], open: [] }
    ;(o.status === 'open' ? bucket.open : bucket.paid).push(o)
    byCustomer.set(o.customerId as string, bucket)
  }
  return new Map(
    customers.map((c) => {
      const b = byCustomer.get(c.id) ?? { paid: [], open: [] }
      return [c.id, summarize(b.paid, b.open, c, loyalty)]
    }),
  )
}

/**
 * Poin yang didapat sebuah pesanan saat lunas. Dipanggil DI DALAM transaksi
 * pembayaran (butuh `db.orders` & `db.settings`). Tier dihitung dari belanja
 * sebelum pesanan ini. Dasarnya penjualan bersih (tanpa pajak & service charge).
 */
export async function pointsToEarnForOrder(order: Order): Promise<number> {
  if (!order.customerId) return 0
  const settings = await getSettings()
  const loyalty = loyaltySettingsOf(settings)
  if (!loyalty.enabled || !featuresForBusinessType(settings.businessType).loyalty) return 0
  const paid = await db.orders.where('status').anyOf(['paid', 'completed']).filter((o) => o.customerId === order.customerId && o.id !== order.id).toArray()
  const tier = tierForSpend(paid.reduce((s, o) => s + o.grandTotal, 0), loyalty)
  return pointsEarnedFor(order.subtotal - order.discountAmount, loyalty, tier)
}

/** Koreksi poin manual oleh pengelola (+ menambah, − mengurangi), wajib alasan & tercatat di log. */
export async function adjustCustomerPoints(customerId: string, delta: number, reason: string, actor: { userId: string; userName: string }): Promise<void> {
  const amount = Math.trunc(delta)
  if (!amount) throw new Error('Jumlah koreksi poin tidak boleh 0.')
  if (!reason.trim()) throw new Error('Alasan koreksi poin wajib diisi.')
  const current = await getCustomerLoyalty(customerId)
  if (current.balance + amount < 0) throw new Error(`Saldo poin tidak cukup — saldo saat ini ${current.balance}.`)
  await db.transaction('rw', db.customers, db.syncQueue, db.auditLogs, async () => {
    const customer = await db.customers.get(customerId)
    if (!customer) throw new Error('Pelanggan tidak ditemukan')
    const now = getTrustedNow()
    const updated = {
      ...customer,
      pointsAdjustment: (customer.pointsAdjustment ?? 0) + amount,
      pointsLog: [...(customer.pointsLog ?? []), { at: now, delta: amount, reason: reason.trim() }],
      updatedAt: now,
    }
    await db.customers.put(updated)
    await enqueueSync('customers', customerId, updated)
    await recordAuditLog({
      userId: actor.userId,
      userName: actor.userName,
      action: 'customer.points_adjust',
      entityType: 'customer',
      entityId: customerId,
      details: `Poin ${customer.name} ${amount > 0 ? 'ditambah' : 'dikurangi'} ${Math.abs(amount)}. Alasan: ${reason.trim()}`,
    })
  })
}
