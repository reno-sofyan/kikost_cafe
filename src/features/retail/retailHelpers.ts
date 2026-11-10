import { formatRupiah } from '@/lib/currency'
import type { Product } from '@/types/domain'

export type StockStatus = 'aman' | 'menipis' | 'habis'

export function stockStatus(p: Pick<Product, 'stockQty' | 'lowStockThreshold'>): StockStatus {
  if (p.stockQty <= 0) return 'habis'
  return p.stockQty <= p.lowStockThreshold ? 'menipis' : 'aman'
}

const STATUS_STYLE: Record<StockStatus, { label: string; badge: string; text: string }> = {
  aman: { label: 'Aman', badge: 'border-success-600 text-success-500', text: 'text-ink-300' },
  menipis: { label: 'Menipis', badge: 'border-accent-500 text-accent-400', text: 'text-accent-400' },
  habis: { label: 'Habis', badge: 'border-red-500 text-red-500', text: 'text-red-500' },
}

export function stockTone(p: Pick<Product, 'stockQty' | 'lowStockThreshold'>) {
  return STATUS_STYLE[stockStatus(p)]
}

/** "2 dus + 6 pcs" (isi per dus diisi), atau null. */
export function packBreakdown(qty: number, packSize: number | null | undefined, unit = 'pcs'): string | null {
  if (!packSize || packSize <= 1) return null
  if (qty <= 0) return '—'
  const dus = Math.floor(qty / packSize)
  const rest = Math.round((qty - dus * packSize) * 1000) / 1000
  return `${dus} dus + ${rest.toLocaleString('id-ID')} ${unit}`
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? words[0]?.[1] ?? '')).toUpperCase() || '?'
}

/**
 * Jumlah dari kolom yang juga menerima pindaian: pemindai barcode mengetik kode
 * lalu Enter di kolom yang sedang fokus. Kode produk ini (di akhir teks) = +1 dari
 * angka sebelumnya; selain itu teks dibaca sebagai angka biasa.
 */
export function qtyAfterScan(text: string, barcode: string | null): { qty: number; scanned: boolean } {
  const code = barcode?.trim()
  if (code && text.endsWith(code)) {
    const before = Number(text.slice(0, -code.length).replace(/[^\d.]/g, '')) || 0
    return { qty: before + 1, scanned: true }
  }
  return { qty: Number(text.replace(/[^\d.]/g, '')) || 0, scanned: false }
}

/** "Rp 18,4 jt" untuk kartu ringkas. */
export function compactRupiah(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`
  if (Math.abs(n) >= 1_000_000) return `Rp ${(n / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`
  return formatRupiah(n)
}

