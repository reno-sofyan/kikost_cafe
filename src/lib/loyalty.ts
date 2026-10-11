import type { AppSettings, LoyaltySettings, LoyaltyTier } from '@/types/domain'

export const DEFAULT_LOYALTY: LoyaltySettings = {
  enabled: false,
  earnPerAmount: 10_000,
  pointValue: 100,
  minRedeem: 10,
  tiers: [
    { name: 'Silver', minSpend: 0, multiplier: 1 },
    { name: 'Gold', minSpend: 1_000_000, multiplier: 1.25 },
    { name: 'Platinum', minSpend: 5_000_000, multiplier: 1.5 },
  ],
}

export function loyaltySettingsOf(settings: Pick<AppSettings, 'loyalty'>): LoyaltySettings {
  const l = settings.loyalty
  if (!l) return DEFAULT_LOYALTY
  return { ...DEFAULT_LOYALTY, ...l, tiers: l.tiers?.length ? l.tiers : DEFAULT_LOYALTY.tiers }
}

/** Tingkatan member dari total belanja seumur hidup (tier tertinggi yang syaratnya terpenuhi). */
export function tierForSpend(lifetimeSpend: number, loyalty: LoyaltySettings): LoyaltyTier {
  const sorted = [...loyalty.tiers].sort((a, b) => a.minSpend - b.minSpend)
  let tier = sorted[0] ?? DEFAULT_LOYALTY.tiers[0]
  for (const t of sorted) if (lifetimeSpend >= t.minSpend) tier = t
  return tier
}

/** Tier berikutnya & kekurangan belanja untuk mencapainya (null bila sudah tertinggi). */
export function nextTierFor(lifetimeSpend: number, loyalty: LoyaltySettings): { tier: LoyaltyTier; remaining: number } | null {
  const next = [...loyalty.tiers].sort((a, b) => a.minSpend - b.minSpend).find((t) => t.minSpend > lifetimeSpend)
  return next ? { tier: next, remaining: next.minSpend - lifetimeSpend } : null
}

/** Poin dari sebuah transaksi: tiap `earnPerAmount` rupiah penjualan bersih = 1 poin × pengali tier. */
export function pointsEarnedFor(netAmount: number, loyalty: LoyaltySettings, tier: LoyaltyTier): number {
  if (!loyalty.enabled || loyalty.earnPerAmount <= 0 || netAmount <= 0) return 0
  return Math.floor((netAmount / loyalty.earnPerAmount) * Math.max(0, tier.multiplier))
}

/** Masa berlaku poin dalam bulan (0 = tidak pernah hangus). */
export function pointsExpiryMonthsOf(loyalty: LoyaltySettings): number {
  return Math.max(0, Math.floor(loyalty.expiryMonths ?? 0))
}

function addMonths(at: number, months: number): number {
  const d = new Date(at)
  d.setMonth(d.getMonth() + months)
  return d.getTime()
}

/**
 * Saldo poin dari riwayat mutasi (+ didapat / koreksi tambah, − ditukar / koreksi
 * kurang). Poin dipakai dari yang PALING LAMA dulu; tiap perolehan hangus
 * `expiryMonths` bulan setelah didapat bila belum terpakai.
 */
export function computePointsBalance(
  events: { at: number; delta: number }[],
  expiryMonths: number,
  now: number,
): { balance: number; expired: number; nextExpiry: { points: number; at: number } | null } {
  // Pada waktu yang sama, penukaran diproses dulu: poin dari sebuah transaksi tak bisa dipakai di transaksi itu sendiri.
  const sorted = events.filter((e) => e.delta !== 0).sort((a, b) => a.at - b.at || a.delta - b.delta)
  const lots: { expiresAt: number; left: number }[] = []
  let expired = 0
  const expireUntil = (t: number) => {
    while (lots.length && lots[0].expiresAt <= t) expired += lots.shift()!.left
  }
  for (const e of sorted) {
    expireUntil(e.at)
    if (e.delta > 0) {
      lots.push({ expiresAt: expiryMonths > 0 ? addMonths(e.at, expiryMonths) : Infinity, left: e.delta })
      continue
    }
    let need = -e.delta
    while (need > 0 && lots.length) {
      const used = Math.min(need, lots[0].left)
      lots[0].left -= used
      need -= used
      if (lots[0].left === 0) lots.shift()
    }
  }
  expireUntil(now)
  const first = lots.find((l) => Number.isFinite(l.expiresAt))
  return {
    balance: lots.reduce((s, l) => s + l.left, 0),
    expired,
    nextExpiry: first ? { points: first.left, at: first.expiresAt } : null,
  }
}
