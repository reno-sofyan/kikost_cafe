import type { Order, OrderItem } from '@/types/domain'

export interface BillAdditionLine {
  item: OrderItem
  /** Jumlah yang belum pernah masuk tagihan tercetak. */
  qty: number
  /** Bagian `lineTotal` untuk `qty` itu (diskon per item ikut proporsional). */
  lineTotal: number
}

/**
 * Item yang ditambahkan SETELAH tagihan terakhir dicetak — untuk "Tagihan
 * Tambahan". Memakai potret qty saat tagihan dicetak (`billSnapshot`), jadi
 * menaikkan qty baris lama (+1) ikut terhitung. Pesanan yang tagihannya dicetak
 * sebelum potret ada memakai waktu: item yang dibuat setelah `billPrintedAt`.
 */
export function billAdditions(order: Pick<Order, 'billPrintedAt' | 'billSnapshot'>, items: OrderItem[]): BillAdditionLine[] {
  if (!order.billPrintedAt) return []
  const lines: BillAdditionLine[] = []
  for (const item of items) {
    if (item.voided || item.removed) continue
    const billed = order.billSnapshot ? (order.billSnapshot[item.id] ?? 0) : item.createdAt <= order.billPrintedAt ? item.qty : 0
    const qty = item.qty - billed
    if (qty <= 0) continue
    lines.push({ item, qty, lineTotal: Math.round((item.lineTotal * qty) / item.qty) })
  }
  return lines
}

/** Potret qty item aktif saat tagihan dicetak. */
export function billSnapshotOf(items: OrderItem[]): Record<string, number> {
  const snapshot: Record<string, number> = {}
  for (const item of items) if (!item.voided && !item.removed) snapshot[item.id] = item.qty
  return snapshot
}
