import type { Purchase } from '@/types/domain'

/**
 * HPP rata-rata tertimbang setelah penerimaan: nilai stok lama (stok × HPP lama)
 * ditambah nilai barang masuk, dibagi stok baru. Stok lama ≤ 0 atau HPP lama 0
 * (belum pernah diisi) = harga beli baru. Harga beli 0 = HPP tak berubah.
 */
export function weightedAverageCost(oldQty: number, oldCost: number, inQty: number, inCost: number): number {
  if (inQty <= 0 || inCost <= 0) return oldCost
  if (oldQty <= 0 || oldCost <= 0) return Math.round(inCost)
  return Math.round((oldQty * oldCost + inQty * inCost) / (oldQty + inQty))
}

export type AbcClass = 'A' | 'B' | 'C'

export interface AbcRow {
  productId: string
  name: string
  revenue: number
  qty: number
  profit: number
}

/**
 * Analisis ABC (Pareto) berdasar omzet: A = produk penyumbang ±80% omzet pertama,
 * B = 15% berikutnya, C = sisanya. Urut omzet terbesar dulu.
 */
export function abcClassify<T extends Pick<AbcRow, 'revenue'>>(rows: T[]): Array<T & { abc: AbcClass; share: number; cumulativeShare: number }> {
  const sorted = [...rows].filter((r) => r.revenue > 0).sort((a, b) => b.revenue - a.revenue)
  const total = sorted.reduce((s, r) => s + r.revenue, 0)
  let cumulative = 0
  return sorted.map((r) => {
    const before = cumulative
    cumulative += r.revenue
    const share = total > 0 ? r.revenue / total : 0
    // Kelas dari porsi kumulatif SEBELUM produk ini — produk pertama selalu A.
    const abc: AbcClass = before / total < 0.8 ? 'A' : before / total < 0.95 ? 'B' : 'C'
    return { ...r, abc, share, cumulativeShare: total > 0 ? cumulative / total : 0 }
  })
}

/** Laku cepat/lambat dari rata-rata terjual per hari dan perkiraan hari stok habis. */
export function stockCoverDays(stockQty: number, soldQty: number, days: number): number | null {
  const perDay = days > 0 ? soldQty / days : 0
  if (perDay <= 0) return null
  return Math.max(0, stockQty) / perDay
}

// ---- Hutang pemasok ----

/** Total pembayaran yang tercatat pada dokumen pembelian. */
export function purchasePaid(p: Pick<Purchase, 'payments'>): number {
  return (p.payments ?? []).reduce((s, x) => s + Math.max(0, x.amount), 0)
}

/** Sisa hutang satu pembelian (0 untuk draf, retur, atau yang lunas). */
export function purchaseBalance(p: Pick<Purchase, 'status' | 'docType' | 'totalCost' | 'payments' | 'dueDate'>): number {
  if (p.status !== 'received' || p.docType === 'return' || !p.dueDate) return 0
  return Math.max(0, p.totalCost - purchasePaid(p))
}

export interface SupplierDebt {
  supplierKey: string
  supplierName: string
  /** Jumlah sisa hutang pembelian tempo. */
  billed: number
  /** Nilai retur yang dipotongkan ke hutang. */
  returnCredit: number
  /** Hutang bersih (billed − returnCredit, min 0). */
  outstanding: number
  overdue: number
  /** Jatuh tempo terdekat dari pembelian yang belum lunas. */
  nextDue: string | null
}

/** Hutang per pemasok (kunci = supplierId, atau nama bila belum dari master). */
export function supplierDebts(purchases: Purchase[], todayKey: string): SupplierDebt[] {
  const map = new Map<string, SupplierDebt>()
  const row = (p: Purchase) => {
    const key = p.supplierId || `name:${p.supplierName.trim().toLowerCase()}`
    let r = map.get(key)
    if (!r) {
      r = { supplierKey: key, supplierName: p.supplierName, billed: 0, returnCredit: 0, outstanding: 0, overdue: 0, nextDue: null }
      map.set(key, r)
    }
    return r
  }
  for (const p of purchases) {
    if (p.docType === 'return') {
      if (p.status === 'received' && p.returnSettlement === 'debt') row(p).returnCredit += p.totalCost
      continue
    }
    const balance = purchaseBalance(p)
    if (balance <= 0) continue
    const r = row(p)
    r.billed += balance
    if (p.dueDate! < todayKey) r.overdue += balance
    if (!r.nextDue || p.dueDate! < r.nextDue) r.nextDue = p.dueDate!
  }
  return [...map.values()]
    .map((r) => ({ ...r, outstanding: Math.max(0, r.billed - r.returnCredit), overdue: Math.max(0, Math.min(r.overdue, r.billed - r.returnCredit)) }))
    .filter((r) => r.billed > 0 || r.returnCredit > 0)
    .sort((a, b) => b.outstanding - a.outstanding)
}

/** `YYYY-MM-DD` + n hari. */
export function addDaysToKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
