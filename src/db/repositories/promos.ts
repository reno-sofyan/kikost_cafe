import { getSettings, updateSettings } from '@/db/repositories/settings'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { db } from '@/db/schema'
import { newId } from '@/lib/id'
import { getTrustedNow } from '@/lib/clockGuard'
import { loyaltySettingsOf } from '@/lib/loyalty'
import { normalizeVoucherCode } from '@/lib/promos'
import type { Kol, KolPayout, LoyaltySettings, Promo } from '@/types/domain'

/**
 * Promo, voucher, KOL, & pengaturan member disimpan di baris pengaturan (ikut
 * sinkron sebagai satu kesatuan) — jumlahnya sedikit dan harus terbaca di dalam
 * transaksi perhitungan total pesanan.
 */
type Actor = { userId: string; userName: string }
export type PromoInput = Omit<Promo, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
export type KolInput = Omit<Kol, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }

export async function listPromos(): Promise<Promo[]> {
  return [...((await getSettings()).promos ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
}

export async function listKols(): Promise<Kol[]> {
  return [...((await getSettings()).kols ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
}

export async function savePromo(input: PromoInput, actor: Actor): Promise<Promo> {
  const name = input.name.trim()
  if (!name) throw new Error('Nama promo wajib diisi.')
  if (input.kind === 'bxgy') {
    if (!((input.buyQty ?? 0) >= 1) || !((input.getQty ?? 0) >= 1)) throw new Error('Isi jumlah beli dan jumlah gratis (minimal 1).')
  } else if (!(input.value > 0)) throw new Error('Nilai potongan harus lebih dari 0.')
  if (input.kind === 'percent' && input.value > 100) throw new Error('Potongan persen maksimal 100%.')
  if (input.scope !== 'order' && input.targetIds.length === 0) throw new Error('Pilih minimal satu kategori/produk yang mendapat promo.')
  if (!!input.startTime !== !!input.endTime) throw new Error('Isi jam mulai dan jam selesai, atau kosongkan keduanya.')
  if (input.startDate && input.endDate && input.endDate < input.startDate) throw new Error('Tanggal selesai tidak boleh sebelum tanggal mulai.')
  const code = normalizeVoucherCode(input.voucherCode)
  const settings = await getSettings()
  const promos = settings.promos ?? []
  if (code && promos.some((p) => p.id !== input.id && normalizeVoucherCode(p.voucherCode) === code)) {
    throw new Error(`Kode voucher ${code} sudah dipakai promo lain.`)
  }
  if (input.kolId && !code) throw new Error('Promo milik KOL harus punya kode voucher.')
  const now = getTrustedNow()
  const existing = input.id ? promos.find((p) => p.id === input.id) : undefined
  const promo: Promo = {
    ...input,
    id: existing?.id ?? newId(),
    name,
    voucherCode: code || null,
    value: input.kind === 'bxgy' ? 0 : input.value,
    buyQty: input.kind === 'bxgy' ? Math.floor(input.buyQty ?? 1) : undefined,
    getQty: input.kind === 'bxgy' ? Math.floor(input.getQty ?? 1) : undefined,
    memberOnly: !!input.memberOnly || !!input.oncePerCustomer || !!input.birthday,
    oncePerCustomer: !!input.oncePerCustomer,
    birthday: input.birthday || null,
    usageLimit: code && input.usageLimit && input.usageLimit > 0 ? Math.floor(input.usageLimit) : null,
    kolId: input.kolId || null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await updateSettings({ promos: existing ? promos.map((p) => (p.id === promo.id ? promo : p)) : [...promos, promo] })
  await recordAuditLog({
    userId: actor.userId,
    userName: actor.userName,
    action: existing ? 'promo.update' : 'promo.create',
    entityType: 'promo',
    entityId: promo.id,
    details: `${code ? `Voucher ${code}` : 'Promo'} "${promo.name}" ${existing ? 'diubah' : 'dibuat'} (${promo.kind === 'bxgy' ? `beli ${promo.buyQty} gratis ${promo.getQty}` : promo.kind === 'percent' ? `${promo.value}%` : `Rp${promo.value}`}${promo.active ? '' : ', nonaktif'}).`,
  })
  return promo
}

export async function deletePromo(promoId: string, actor: Actor): Promise<void> {
  const settings = await getSettings()
  const promo = (settings.promos ?? []).find((p) => p.id === promoId)
  if (!promo) return
  await updateSettings({ promos: (settings.promos ?? []).filter((p) => p.id !== promoId) })
  await recordAuditLog({ userId: actor.userId, userName: actor.userName, action: 'promo.delete', entityType: 'promo', entityId: promoId, details: `Promo "${promo.name}" dihapus.` })
}

/** Jumlah transaksi lunas yang memakai tiap promo/voucher — untuk kuota & daftar promo. */
export async function promoUsageCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  await db.orders
    .where('status')
    .anyOf(['paid', 'completed'])
    .each((o) => {
      for (const a of o.appliedPromos ?? []) counts.set(a.promoId, (counts.get(a.promoId) ?? 0) + 1)
    })
  return counts
}

export async function saveKol(input: KolInput, actor: Actor): Promise<Kol> {
  const name = input.name.trim()
  if (!name) throw new Error('Nama KOL wajib diisi.')
  if (input.commissionPercent < 0 || input.commissionPercent > 100) throw new Error('Komisi harus 0–100%.')
  const settings = await getSettings()
  const kols = settings.kols ?? []
  const now = getTrustedNow()
  const existing = input.id ? kols.find((k) => k.id === input.id) : undefined
  const kol: Kol = { ...input, id: existing?.id ?? newId(), name, createdAt: existing?.createdAt ?? now, updatedAt: now }
  await updateSettings({ kols: existing ? kols.map((k) => (k.id === kol.id ? kol : k)) : [...kols, kol] })
  await recordAuditLog({
    userId: actor.userId,
    userName: actor.userName,
    action: existing ? 'kol.update' : 'kol.create',
    entityType: 'kol',
    entityId: kol.id,
    details: `KOL "${kol.name}" ${existing ? 'diubah' : 'ditambahkan'} (komisi ${kol.commissionPercent}%).`,
  })
  return kol
}

/** Menghapus KOL; voucher miliknya dilepas dari KOL itu & dinonaktifkan (riwayat laporan tetap utuh). */
export async function deleteKol(kolId: string, actor: Actor): Promise<void> {
  const settings = await getSettings()
  const kol = (settings.kols ?? []).find((k) => k.id === kolId)
  if (!kol) return
  await updateSettings({
    kols: (settings.kols ?? []).filter((k) => k.id !== kolId),
    promos: (settings.promos ?? []).map((p) => (p.kolId === kolId ? { ...p, kolId: null, active: false, updatedAt: getTrustedNow() } : p)),
  })
  await recordAuditLog({ userId: actor.userId, userName: actor.userName, action: 'kol.delete', entityType: 'kol', entityId: kolId, details: `KOL "${kol.name}" dihapus; vouchernya dinonaktifkan.` })
}

export interface KolCommission {
  /** Komisi dari seluruh transaksi lunas yang memakai voucher KOL ini. */
  earned: number
  paid: number
  /** `earned − paid`; negatif berarti lebih bayar. */
  outstanding: number
  transactionCount: number
  payouts: KolPayout[]
}

/** Komisi tiap KOL sepanjang waktu & berapa yang sudah dibayarkan. */
export async function kolCommissionLedger(): Promise<Map<string, KolCommission>> {
  const ledger = new Map<string, KolCommission>()
  const entry = (kolId: string) => {
    let e = ledger.get(kolId)
    if (!e) ledger.set(kolId, (e = { earned: 0, paid: 0, outstanding: 0, transactionCount: 0, payouts: [] }))
    return e
  }
  await db.orders
    .where('status')
    .anyOf(['paid', 'completed'])
    .each((o) => {
      for (const a of o.appliedPromos ?? []) {
        if (!a.kolId) continue
        const e = entry(a.kolId)
        e.transactionCount += 1
        e.earned += Math.round(((o.subtotal - o.discountAmount) * (a.kolCommissionPercent ?? 0)) / 100)
      }
    })
  for (const p of (await getSettings()).kolPayouts ?? []) {
    const e = entry(p.kolId)
    e.paid += p.amount
    e.payouts.push(p)
  }
  for (const e of ledger.values()) {
    e.outstanding = e.earned - e.paid
    e.payouts.sort((a, b) => b.createdAt - a.createdAt)
  }
  return ledger
}

export async function recordKolPayout(input: { kolId: string; amount: number; note: string }, actor: Actor): Promise<KolPayout> {
  const amount = Math.round(input.amount)
  if (!(amount > 0)) throw new Error('Nominal pembayaran harus lebih dari 0.')
  const settings = await getSettings()
  const kol = (settings.kols ?? []).find((k) => k.id === input.kolId)
  if (!kol) throw new Error('KOL tidak ditemukan.')
  const payout: KolPayout = { id: newId(), kolId: kol.id, kolName: kol.name, amount, note: input.note.trim(), userId: actor.userId, userName: actor.userName, createdAt: getTrustedNow() }
  await updateSettings({ kolPayouts: [...(settings.kolPayouts ?? []), payout] })
  await recordAuditLog({
    userId: actor.userId,
    userName: actor.userName,
    action: 'kol.payout',
    entityType: 'kol',
    entityId: kol.id,
    details: `Komisi KOL "${kol.name}" dibayar Rp${amount.toLocaleString('id-ID')}${payout.note ? `. Catatan: ${payout.note}` : ''}`,
  })
  return payout
}

/** Membatalkan catatan pembayaran komisi yang salah input. */
export async function deleteKolPayout(payoutId: string, actor: Actor): Promise<void> {
  const settings = await getSettings()
  const payout = (settings.kolPayouts ?? []).find((p) => p.id === payoutId)
  if (!payout) return
  await updateSettings({ kolPayouts: (settings.kolPayouts ?? []).filter((p) => p.id !== payoutId) })
  await recordAuditLog({
    userId: actor.userId,
    userName: actor.userName,
    action: 'kol.payout_delete',
    entityType: 'kol',
    entityId: payout.kolId,
    details: `Catatan pembayaran komisi "${payout.kolName}" Rp${payout.amount.toLocaleString('id-ID')} dihapus.`,
  })
}

export async function saveLoyaltySettings(input: LoyaltySettings, actor: Actor): Promise<void> {
  if (!(input.earnPerAmount > 0)) throw new Error('Nilai belanja per 1 poin harus lebih dari 0.')
  if (!(input.pointValue > 0)) throw new Error('Nilai tukar 1 poin harus lebih dari 0.')
  const tiers = input.tiers
    .map((t) => ({ name: t.name.trim(), minSpend: Math.max(0, Math.round(t.minSpend)), multiplier: Math.max(0, t.multiplier) }))
    .filter((t) => t.name)
    .sort((a, b) => a.minSpend - b.minSpend)
  if (tiers.length === 0) throw new Error('Minimal satu tingkatan member.')
  tiers[0].minSpend = 0
  const before = loyaltySettingsOf(await getSettings())
  await updateSettings({
    loyalty: { ...input, minRedeem: Math.max(1, Math.floor(input.minRedeem)), expiryMonths: Math.max(0, Math.floor(input.expiryMonths ?? 0)), depositEnabled: !!input.depositEnabled, tiers },
  })
  await recordAuditLog({
    userId: actor.userId,
    userName: actor.userName,
    action: 'loyalty.settings',
    entityType: 'settings',
    entityId: 'singleton',
    details: `Program member ${input.enabled ? 'aktif' : 'nonaktif'}: Rp${input.earnPerAmount}/poin, 1 poin = Rp${input.pointValue}${before.enabled !== input.enabled ? ' (status berubah)' : ''}.`,
  })
}
