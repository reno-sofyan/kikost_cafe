import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { getSettings } from '@/db/repositories/settings'
import { hppOfProduct, recalcOrderTotals } from '@/db/repositories/orders'
import { featuresForBusinessType } from '@/lib/businessType'
import { getTrustedNow } from '@/lib/clockGuard'
import { HPP_PRICING_LABELS, hppItemPatch, normalItemPatch } from '@/lib/hppPricing'
import type { HppPricing, HppPricingKind } from '@/types/domain'

/**
 * Pesanan KOL / Compliment (kafe). Seluruh item dihargai HPP, pajak & service charge
 * dinolkan, diskon/voucher/poin dilepas, dan promo otomatis tak berlaku. Tanpa PIN
 * atasan (keputusan manager kafe); pelaku, penerima & alasannya tercatat di pesanan
 * dan Log Aktivitas.
 */

export interface HppPricingInput {
  kind: HppPricingKind
  /** KOL terdaftar; kosong untuk compliment atau KOL yang belum terdaftar (pakai `name`). */
  kolId: string | null
  name: string
  reason: string
}

type Actor = { userId: string; userName: string }

const ORDER_TABLES = () => [db.orders, db.orderItems, db.products, db.syncQueue, db.settings, db.customers, db.auditLogs]

async function assertEditable(orderId: string) {
  const order = await db.orders.get(orderId)
  if (!order) throw new Error('Pesanan tidak ditemukan.')
  if (order.status !== 'open') throw new Error('Hanya pesanan yang masih terbuka yang bisa diubah harganya.')
  const paid = await db.payments.where('orderId').equals(orderId).filter((p) => p.amount > 0 && !p.reversalOfPaymentId).count()
  if (paid > 0) throw new Error('Pesanan ini sudah ada pembayarannya — harga tidak bisa diubah.')
  return order
}

/** Menjadikan pesanan KOL/Compliment (harga HPP), atas nama kasir yang sedang login. */
export async function setOrderHppPricing(orderId: string, input: HppPricingInput, actor: Actor): Promise<void> {
  const settings = await getSettings()
  if (!featuresForBusinessType(settings.businessType).hppPricing) throw new Error('Fitur KOL/Compliment hanya untuk Kafe & Restoran.')
  const kol = input.kind === 'kol' && input.kolId ? (settings.kols ?? []).find((k) => k.id === input.kolId && k.active) : undefined
  if (input.kind === 'kol' && input.kolId && !kol) throw new Error('KOL tidak ditemukan atau sudah nonaktif.')
  const order = await assertEditable(orderId)
  // Compliment = satu ketukan: penerima dari catatan/nama pelanggan pesanan bila tak diisi.
  const name = (kol?.name ?? input.name).trim() || (input.kind === 'compliment' ? order.notes?.trim() || 'Tamu' : '')
  if (!name) throw new Error('Pilih KOL atau tulis namanya.')
  const reason = input.reason.trim()
  const items = (await db.orderItems.where('orderId').equals(orderId).toArray()).filter((i) => !i.removed && !i.voided)
  const hpp = new Map<string, number>()
  for (const i of items) if (!hpp.has(i.productId)) hpp.set(i.productId, await hppOfProduct(i.productId))
  const now = getTrustedNow()
  const pricing: HppPricing = {
    kind: input.kind,
    kolId: kol?.id ?? null,
    name,
    reason,
    approvedByUserId: actor.userId,
    approvedByName: actor.userName,
    requestedByName: actor.userName,
    at: now,
    // Saat mengganti jenis/nama, pertahankan pajak & service charge asli pesanan.
    prevTaxPercent: order.hppPricing?.prevTaxPercent ?? order.taxPercent,
    prevServiceChargePercent: order.hppPricing?.prevServiceChargePercent ?? order.serviceChargePercent,
  }

  await db.transaction('rw', ORDER_TABLES(), async () => {
    for (const i of items) {
      await db.orderItems.update(i.id, { ...hppItemPatch(i, hpp.get(i.productId) ?? 0), updatedAt: now })
      const updated = await db.orderItems.get(i.id)
      if (updated) await enqueueSync('orderItems', i.id, updated)
    }
    await db.orders.update(orderId, {
      hppPricing: pricing,
      taxPercent: 0,
      serviceChargePercent: 0,
      discountType: null,
      discountValue: 0,
      discountReason: null,
      discountByName: null,
      discountApproval: null,
      voucherCode: null,
      pointsRedeemed: 0,
      pointsRedeemValue: 0,
      updatedAt: now,
    })
    await recalcOrderTotals(orderId)
    const after = await db.orders.get(orderId)
    await recordAuditLog({
      ...actor,
      action: 'order.hpp_pricing',
      entityType: 'order',
      entityId: orderId,
      details:
        `${after?.orderNumber ?? 'Pesanan'} dijadikan ${HPP_PRICING_LABELS[input.kind]} (${name}) — harga HPP, total Rp${Math.round(after?.grandTotal ?? 0)}` +
        `${reason ? `. Alasan: ${reason}` : ''}.`,
    })
  })
}

/** Melepas mode KOL/Compliment: harga jual, pajak & service charge dikembalikan. Tanpa PIN (harga justru naik). */
export async function clearOrderHppPricing(orderId: string, actor: Actor): Promise<void> {
  const order = await assertEditable(orderId)
  const pricing = order.hppPricing
  if (!pricing) return
  const items = (await db.orderItems.where('orderId').equals(orderId).toArray()).filter((i) => i.normalPrice)
  const now = getTrustedNow()
  await db.transaction('rw', ORDER_TABLES(), async () => {
    for (const i of items) {
      await db.orderItems.update(i.id, { ...normalItemPatch(i), updatedAt: now })
      const updated = await db.orderItems.get(i.id)
      if (updated) await enqueueSync('orderItems', i.id, updated)
    }
    await db.orders.update(orderId, { hppPricing: null, taxPercent: pricing.prevTaxPercent, serviceChargePercent: pricing.prevServiceChargePercent, updatedAt: now })
    await recalcOrderTotals(orderId)
    await recordAuditLog({
      ...actor,
      action: 'order.hpp_pricing_remove',
      entityType: 'order',
      entityId: orderId,
      details: `${order.orderNumber ?? 'Pesanan'}: mode ${HPP_PRICING_LABELS[pricing.kind]} (${pricing.name}) dilepas — kembali ke harga jual.`,
    })
  })
}

/** Ringkasan sebelum disetujui: total harga jual vs total HPP, dan menu yang belum punya HPP. */
export async function previewHppPricing(orderId: string): Promise<{ normalTotal: number; hppTotal: number; missingHpp: string[] }> {
  const items = (await db.orderItems.where('orderId').equals(orderId).toArray()).filter((i) => !i.removed && !i.voided)
  let normalTotal = 0
  let hppTotal = 0
  const missing = new Set<string>()
  for (const i of items) {
    const hpp = await hppOfProduct(i.productId)
    if (hpp <= 0) missing.add(i.productName)
    hppTotal += hpp * i.qty
    normalTotal += i.normalPrice ? i.normalPrice.unitPrice * i.qty : i.lineTotal
  }
  return { normalTotal, hppTotal, missingHpp: [...missing] }
}
