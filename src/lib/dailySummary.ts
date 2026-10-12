import { formatRupiah } from '@/lib/currency'

export interface DailySummaryInput {
  businessName: string
  dateLabel: string
  cashierName: string
  openedLabel: string
  closedLabel: string
  totalSales: number
  transactionCount: number
  cashSales: number
  nonCashSales: number
  discountTotal: number
  returnTotal: number
  totalExpenses: number
  voidCount: number
  expectedCash: number
  actualCash: number | null
  variance: number | null
  topProducts: { name: string; qty: number }[]
  /** Omzet seluruh shift hari ini & target harian (0/undefined = tanpa target). */
  todaySales?: number
  dailyTarget?: number
  notes?: string
}

/** Pesan ringkasan tutup shift untuk pemilik (teks WhatsApp; `*…*` = tebal). */
export function dailySummaryMessage(d: DailySummaryInput): string {
  const out: string[] = []
  out.push(`*Ringkasan Shift — ${d.businessName}*`)
  out.push(`${d.dateLabel} • ${d.openedLabel}–${d.closedLabel} • Kasir ${d.cashierName}`)
  out.push('')
  out.push(`Omzet: *${formatRupiah(d.totalSales)}* (${d.transactionCount} transaksi)`)
  if (d.transactionCount > 0) out.push(`Rata-rata per transaksi: ${formatRupiah(Math.round(d.totalSales / d.transactionCount))}`)
  out.push(`Tunai: ${formatRupiah(d.cashSales)} • Non-tunai: ${formatRupiah(d.nonCashSales)}`)
  if (d.discountTotal > 0) out.push(`Diskon & promo: ${formatRupiah(d.discountTotal)}`)
  if (d.returnTotal > 0) out.push(`Retur: ${formatRupiah(d.returnTotal)}`)
  if (d.totalExpenses > 0) out.push(`Pengeluaran dari laci: ${formatRupiah(d.totalExpenses)}`)
  if (d.voidCount > 0) out.push(`Pesanan dibatalkan: ${d.voidCount}`)
  out.push('')
  out.push(`Kas seharusnya: ${formatRupiah(d.expectedCash)}`)
  if (d.actualCash != null) out.push(`Kas dihitung: ${formatRupiah(d.actualCash)}`)
  if (d.variance != null) out.push(d.variance === 0 ? 'Selisih kas: Rp0 (cocok)' : `Selisih kas: *${d.variance > 0 ? '+' : '-'}${formatRupiah(Math.abs(d.variance))}* (${d.variance > 0 ? 'lebih' : 'kurang'})`)
  if (d.topProducts.length) {
    out.push('')
    out.push('Menu terlaris:')
    d.topProducts.forEach((p, i) => out.push(`${i + 1}. ${p.name} — ${p.qty}×`))
  }
  if (d.dailyTarget && d.dailyTarget > 0 && d.todaySales != null) {
    const pct = Math.round((d.todaySales / d.dailyTarget) * 100)
    out.push('')
    out.push(`Target hari ini: ${formatRupiah(d.todaySales)} dari ${formatRupiah(d.dailyTarget)} (${pct}%)${pct >= 100 ? ' ✅' : ''}`)
  }
  if (d.notes?.trim()) {
    out.push('')
    out.push(`Catatan kasir: ${d.notes.trim()}`)
  }
  return out.join('\n')
}
