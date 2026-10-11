import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { getSettings } from '@/db/repositories/settings'
import { addCashMovement, getOpenShift } from '@/db/repositories/shifts'
import type { DateRange } from '@/db/repositories/reports'
import { featuresForBusinessType } from '@/lib/businessType'
import { getTrustedNow } from '@/lib/clockGuard'
import { newId } from '@/lib/id'
import { loyaltySettingsOf } from '@/lib/loyalty'
import type { AppSettings, Customer, DepositEntry, PaymentMethod } from '@/types/domain'

/**
 * Saldo member (deposit). Seperti poin, saldo TIDAK disimpan sebagai angka yang
 * diubah-ubah: isi & tarik saldo dicatat di `customer.depositLog`, pemakaiannya
 * adalah pembayaran bermetode `deposit` (pembalik saat batal/retur otomatis
 * mengembalikan saldo). Uang isi saldo adalah titipan pelanggan (utang usaha),
 * baru menjadi omzet ketika dipakai membayar pesanan.
 */
export const DEPOSIT_TOPUP_METHODS: PaymentMethod[] = ['cash', 'qris', 'transfer', 'card']

export function depositEnabledFor(settings: Pick<AppSettings, 'businessType' | 'loyalty'>): boolean {
  const loyalty = loyaltySettingsOf(settings)
  return featuresForBusinessType(settings.businessType).loyalty && loyalty.enabled && !!loyalty.depositEnabled
}

export interface CustomerDeposit {
  balance: number
  toppedUp: number
  withdrawn: number
  spent: number
  entries: DepositEntry[]
}

function summarize(customer: Customer | undefined, spent: number): CustomerDeposit {
  const entries = [...(customer?.depositLog ?? [])].sort((a, b) => b.at - a.at)
  const toppedUp = entries.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0)
  const withdrawn = entries.filter((e) => e.amount < 0).reduce((s, e) => s - e.amount, 0)
  return { balance: toppedUp - withdrawn - spent, toppedUp, withdrawn, spent, entries }
}

/** Total pemakaian saldo per pelanggan (pembayaran + tip yang ikut dibayar − pembalik). */
async function spentByCustomer(): Promise<Map<string, number>> {
  const spent = new Map<string, number>()
  await db.payments
    .where('method')
    .anyOf(['deposit', 'giftcard'])
    .each((p) => {
      if (p.customerId) spent.set(p.customerId, (spent.get(p.customerId) ?? 0) + p.amount + (p.tipAmount ?? 0))
    })
  return spent
}

export async function getCustomerDeposit(customerId: string): Promise<CustomerDeposit> {
  const customer = await db.customers.get(customerId)
  return summarize(customer, (await spentByCustomer()).get(customerId) ?? 0)
}

/** Saldo semua pelanggan sekaligus (layar Pelanggan). */
export async function listCustomerDeposits(): Promise<Map<string, CustomerDeposit>> {
  const spent = await spentByCustomer()
  return new Map((await db.customers.toArray()).map((c) => [c.id, summarize(c, spent.get(c.id) ?? 0)]))
}

/**
 * Isi saldo (`amount` positif) atau tarik/koreksi saldo (negatif, wajib alasan).
 * Tunai dicatat sebagai Kas Masuk/Keluar shift yang sedang buka supaya kas laci cocok.
 */
export async function recordCustomerDeposit(params: {
  customerId: string
  amount: number
  method: PaymentMethod
  note: string
  actor: { userId: string; userName: string }
}): Promise<DepositEntry> {
  const amount = Math.round(params.amount)
  if (!amount) throw new Error('Nominal tidak boleh 0.')
  if (!DEPOSIT_TOPUP_METHODS.includes(params.method)) throw new Error('Metode pembayaran tidak didukung untuk saldo member.')
  const note = params.note.trim()
  if (amount < 0 && !note) throw new Error('Alasan tarik/koreksi saldo wajib diisi.')
  const target = await db.customers.get(params.customerId)
  if (!target?.giftCard && !depositEnabledFor(await getSettings())) throw new Error('Saldo member belum diaktifkan.')
  const shift = await getOpenShift()
  if (params.method === 'cash' && !shift) throw new Error('Buka shift terlebih dahulu untuk menerima/mengeluarkan uang tunai.')

  return db.transaction('rw', [db.customers, db.payments, db.shifts, db.cashMovements, db.syncQueue, db.auditLogs], async () => {
    const customer = await db.customers.get(params.customerId)
    if (!customer) throw new Error('Pelanggan tidak ditemukan')
    const current = summarize(customer, (await spentByCustomer()).get(customer.id) ?? 0)
    if (current.balance + amount < 0) throw new Error(`Saldo tidak cukup — saldo saat ini Rp${current.balance.toLocaleString('id-ID')}.`)
    const now = getTrustedNow()
    const entry: DepositEntry = {
      id: newId(),
      at: now,
      amount,
      method: params.method,
      note,
      shiftId: shift?.id ?? null,
      userId: params.actor.userId,
      userName: params.actor.userName,
    }
    const updated: Customer = { ...customer, depositLog: [...(customer.depositLog ?? []), entry], updatedAt: now }
    await db.customers.put(updated)
    await enqueueSync('customers', customer.id, updated)
    if (params.method === 'cash' && shift) {
      await addCashMovement({
        shiftId: shift.id,
        type: amount > 0 ? 'in' : 'out',
        amount: Math.abs(amount),
        reason: customer.giftCard ? `${amount > 0 ? 'Jual' : 'Tarik'} voucher hadiah ${customer.giftCard.code}` : `${amount > 0 ? 'Isi' : 'Tarik'} saldo member ${customer.name}`,
        userId: params.actor.userId,
      })
    }
    await recordAuditLog({
      userId: params.actor.userId,
      userName: params.actor.userName,
      action: customer.giftCard ? (amount > 0 ? 'giftcard.sell' : 'giftcard.withdraw') : amount > 0 ? 'customer.deposit_topup' : 'customer.deposit_withdraw',
      entityType: 'customer',
      entityId: customer.id,
      details: `${customer.giftCard ? customer.name : `Saldo ${customer.name}`} ${amount > 0 ? (customer.giftCard ? 'dijual' : 'diisi') : 'ditarik'} Rp${Math.abs(amount).toLocaleString('id-ID')} (${params.method})${note ? `. Catatan: ${note}` : ''}`,
    })
    return entry
  })
}

export interface DepositReport {
  topUpTotal: number
  topUpByMethod: { method: PaymentMethod; amount: number; count: number }[]
  withdrawnTotal: number
  /** Saldo yang dipakai membayar pesanan dalam rentang (sudah dikurangi pembalik). */
  usedTotal: number
  /** Total saldo seluruh member SAAT INI — titipan yang belum dipakai. */
  outstanding: number
  customersWithBalance: number
  /** Voucher hadiah: terjual & dipakai dalam rentang, dan sisa nilai yang belum ditukar saat ini. */
  giftCardSoldTotal: number
  giftCardSoldCount: number
  giftCardUsedTotal: number
  giftCardOutstanding: number
}

export async function buildDepositReport(range: DateRange): Promise<DepositReport> {
  const all = await listCustomerDeposits()
  const giftCardIds = new Set((await db.customers.toArray()).filter((c) => c.giftCard).map((c) => c.id))
  let giftCardSoldTotal = 0
  let giftCardSoldCount = 0
  let giftCardOutstanding = 0
  let giftCardUsedTotal = 0
  const byMethod = new Map<PaymentMethod, { amount: number; count: number }>()
  let withdrawnTotal = 0
  let outstanding = 0
  let customersWithBalance = 0
  for (const [customerId, d] of all) {
    if (giftCardIds.has(customerId)) {
      giftCardOutstanding += d.balance
      for (const e of d.entries) {
        if (e.at < range.from || e.at > range.to || e.amount <= 0) continue
        giftCardSoldTotal += e.amount
        giftCardSoldCount += 1
      }
      continue
    }
    outstanding += d.balance
    if (d.balance > 0) customersWithBalance += 1
    for (const e of d.entries) {
      if (e.at < range.from || e.at > range.to) continue
      if (e.amount < 0) {
        withdrawnTotal -= e.amount
        continue
      }
      const m = byMethod.get(e.method) ?? { amount: 0, count: 0 }
      m.amount += e.amount
      m.count += 1
      byMethod.set(e.method, m)
    }
  }
  let usedTotal = 0
  await db.payments
    .where('method')
    .anyOf(['deposit', 'giftcard'])
    .each((p) => {
      if (p.createdAt < range.from || p.createdAt > range.to) return
      if (p.method === 'giftcard') giftCardUsedTotal += p.amount
      else usedTotal += p.amount
    })
  const topUpByMethod = Array.from(byMethod.entries()).map(([method, v]) => ({ method, ...v }))
  return { topUpTotal: topUpByMethod.reduce((s, m) => s + m.amount, 0), topUpByMethod, withdrawnTotal, usedTotal, outstanding, customersWithBalance, giftCardSoldTotal, giftCardSoldCount, giftCardUsedTotal, giftCardOutstanding }
}

// ---------------------------------------------------------------- Voucher hadiah (gift card)

export interface GiftCard {
  id: string
  code: string
  recipient: string
  initialAmount: number
  balance: number
  soldAt: number
  soldBy: string
}

/** Kode dibandingkan tanpa peduli huruf besar/kecil, spasi, & tanda hubung. */
export function normalizeGiftCardCode(code: string | null | undefined): string {
  return (code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

// Tanpa huruf/angka yang mudah tertukar (0/O, 1/I/L).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
function randomGiftCardCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
  return `GC-${chars.slice(0, 4)}-${chars.slice(4)}`
}

function toGiftCard(customer: Customer, deposit: CustomerDeposit): GiftCard {
  const first = [...deposit.entries].sort((a, b) => a.at - b.at)[0]
  return {
    id: customer.id,
    code: customer.giftCard?.code ?? '',
    recipient: customer.giftCard?.recipient ?? '',
    initialAmount: deposit.toppedUp,
    balance: deposit.balance,
    soldAt: first?.at ?? customer.createdAt,
    soldBy: first?.userName ?? '',
  }
}

export async function listGiftCards(): Promise<GiftCard[]> {
  const spent = await spentByCustomer()
  return (await db.customers.toArray())
    .filter((c) => c.giftCard)
    .map((c) => toGiftCard(c, summarize(c, spent.get(c.id) ?? 0)))
    .sort((a, b) => b.soldAt - a.soldAt)
}

export async function findGiftCard(code: string): Promise<GiftCard | null> {
  const wanted = normalizeGiftCardCode(code)
  if (!wanted) return null
  const customer = (await db.customers.toArray()).find((c) => c.giftCard && normalizeGiftCardCode(c.giftCard.code) === wanted)
  return customer ? toGiftCard(customer, summarize(customer, (await spentByCustomer()).get(customer.id) ?? 0)) : null
}

/** Menjual voucher hadiah bernilai `amount`: uang diterima sekarang, nilainya ditukar belakangan dengan kodenya. */
export async function sellGiftCard(params: { amount: number; method: PaymentMethod; recipient: string; actor: { userId: string; userName: string } }): Promise<GiftCard> {
  const amount = Math.round(params.amount)
  if (!(amount > 0)) throw new Error('Nilai voucher harus lebih dari 0.')
  if (!featuresForBusinessType((await getSettings()).businessType).promos) throw new Error('Voucher hadiah tidak tersedia untuk jenis usaha ini.')
  if (params.method === 'cash' && !(await getOpenShift())) throw new Error('Buka shift terlebih dahulu untuk menerima uang tunai.')
  let code = randomGiftCardCode()
  while (await findGiftCard(code)) code = randomGiftCardCode()
  const now = getTrustedNow()
  const customer: Customer = { id: newId(), name: `Voucher Hadiah ${code}`, phone: '', note: '', giftCard: { code, recipient: params.recipient.trim() }, createdAt: now, updatedAt: now }
  await db.transaction('rw', db.customers, db.syncQueue, async () => {
    await db.customers.add(customer)
    await enqueueSync('customers', customer.id, customer)
  })
  try {
    await recordCustomerDeposit({ customerId: customer.id, amount, method: params.method, note: params.recipient.trim() ? `Untuk ${params.recipient.trim()}` : '', actor: params.actor })
  } catch (e) {
    await db.customers.delete(customer.id)
    throw e
  }
  return (await findGiftCard(code))!
}
