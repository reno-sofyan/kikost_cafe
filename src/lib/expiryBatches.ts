import { jakartaDateKey } from '@/lib/datetime'
import type { ExpiryBatch, Product } from '@/types/domain'

/** Batas "hampir kedaluwarsa" di layar Stok. */
export const NEAR_EXPIRY_DAYS = 14

const DAY_MS = 24 * 60 * 60 * 1000

function roundQty(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** Validasi ringan `YYYY-MM-DD` (tanggal kalender nyata). */
export function isValidDateKey(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** Selisih hari kalender `dateKey` − hari ini (WIB). Negatif = sudah lewat. */
export function daysUntil(dateKey: string, now: number): number {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number]
  const [ty, tm, td] = jakartaDateKey(now).split('-').map(Number) as [number, number, number]
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / DAY_MS)
}

/** Urut kedaluwarsa paling awal dulu (FEFO), lalu yang diterima lebih dulu. */
function byExpiry(a: ExpiryBatch, b: ExpiryBatch): number {
  return a.expiryDate === b.expiryDate ? a.receivedAt - b.receivedAt : a.expiryDate < b.expiryDate ? -1 : 1
}

export function sortedBatches(batches: ExpiryBatch[] | undefined): ExpiryBatch[] {
  return (batches ?? []).filter((b) => b.qty > 0).sort(byExpiry)
}

export function batchedQty(batches: ExpiryBatch[] | undefined): number {
  return roundQty((batches ?? []).reduce((s, b) => s + Math.max(0, b.qty), 0))
}

/**
 * Mengurangi stok bertanggal sebanyak `qty` — FEFO (kedaluwarsa terdekat dulu),
 * atau dari batch `preferBatchId` lebih dulu (mis. membuang batch yang sudah exp).
 */
function consume(batches: ExpiryBatch[], qty: number, preferBatchId?: string): ExpiryBatch[] {
  let left = qty
  const order = sortedBatches(batches)
  if (preferBatchId) {
    const i = order.findIndex((b) => b.id === preferBatchId)
    if (i > 0) order.unshift(...order.splice(i, 1))
  }
  const out: ExpiryBatch[] = []
  for (const b of order) {
    const take = Math.min(b.qty, left)
    left = roundQty(left - take)
    const rest = roundQty(b.qty - take)
    if (rest > 0) out.push({ ...b, qty: rest })
  }
  return out.sort(byExpiry)
}

/**
 * Batch setelah pergerakan stok `delta`. Stok masuk bertanggal menambah batch
 * (digabung bila tanggalnya sama); stok keluar memotong FEFO. Hasilnya selalu
 * dijaga ≤ stok akhir (`resultingQty`) — stok minus/koreksi manual memangkas
 * batch tertua.
 */
export function applyBatchDelta(
  batches: ExpiryBatch[] | undefined,
  delta: number,
  resultingQty: number,
  opts: { expiryDate?: string | null; batchId?: string; newId: () => string; now: number },
): ExpiryBatch[] {
  let next = sortedBatches(batches)
  if (delta > 0 && isValidDateKey(opts.expiryDate)) {
    const same = next.find((b) => b.expiryDate === opts.expiryDate)
    next = same
      ? next.map((b) => (b === same ? { ...b, qty: roundQty(b.qty + delta) } : b))
      : [...next, { id: opts.newId(), expiryDate: opts.expiryDate, qty: roundQty(delta), receivedAt: opts.now }].sort(byExpiry)
  } else if (delta < 0) {
    next = consume(next, -delta, opts.batchId)
  }
  return clampBatches(next, resultingQty)
}

/** Pangkas batch supaya jumlahnya tak melebihi stok (stok diubah manual di form produk, dsb.). */
export function clampBatches(batches: ExpiryBatch[] | undefined, stockQty: number): ExpiryBatch[] {
  const sorted = sortedBatches(batches)
  const excess = roundQty(batchedQty(sorted) - Math.max(0, stockQty))
  return excess > 0 ? consume(sorted, excess) : sorted
}

export type ExpiryState = 'expired' | 'near' | 'ok'

export interface ProductExpiry {
  /** Tanggal kedaluwarsa terdekat yang masih ada stoknya. */
  nearest: ExpiryBatch | null
  days: number | null
  state: ExpiryState | null
  /** Jumlah stok yang sudah lewat tanggal. */
  expiredQty: number
}

export function productExpiry(product: Pick<Product, 'expiryBatches'>, now: number): ProductExpiry {
  const batches = sortedBatches(product.expiryBatches)
  const nearest = batches[0] ?? null
  if (!nearest) return { nearest: null, days: null, state: null, expiredQty: 0 }
  const days = daysUntil(nearest.expiryDate, now)
  const expiredQty = roundQty(batches.filter((b) => daysUntil(b.expiryDate, now) < 0).reduce((s, b) => s + b.qty, 0))
  return { nearest, days, state: expiryStateFor(days), expiredQty }
}

export function expiryStateFor(days: number): ExpiryState {
  return days < 0 ? 'expired' : days <= NEAR_EXPIRY_DAYS ? 'near' : 'ok'
}

const SHORT_DATE = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** "12 Des 2026" untuk `YYYY-MM-DD`. */
export function formatDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number]
  return SHORT_DATE.format(new Date(Date.UTC(y, m - 1, d)))
}

/** Label kolom "Exp Produk": "Hari ini", "2 Hari Lagi", "Lewat 3 hari", atau tanggal. */
export function expiryLabel(dateKey: string, now: number): string {
  const days = daysUntil(dateKey, now)
  if (days < 0) return `Lewat ${-days} hari`
  if (days === 0) return 'Hari ini'
  if (days <= 7) return `${days} Hari Lagi`
  return formatDateKey(dateKey)
}
