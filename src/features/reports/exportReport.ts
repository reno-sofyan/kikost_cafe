import jsPDF from 'jspdf'
import { formatRupiah } from '@/lib/currency'
import { formatDate } from '@/lib/datetime'
import { saveFile, saveTextFile } from '@/lib/saveFile'
import type { SalesReport } from '@/db/repositories/reports'

export async function exportSalesReportCsv(report: SalesReport): Promise<void> {
  const lines: string[] = []
  lines.push('Ringkasan')
  lines.push(`Omzet,${report.revenue}`)
  lines.push(`Jumlah Transaksi,${report.transactionCount}`)
  lines.push(`Rata-rata Transaksi,${Math.round(report.averageTransaction)}`)
  lines.push(`Diskon,${report.discountTotal}`)
  lines.push(`Pajak,${report.taxTotal}`)
  lines.push(`Service Charge,${report.serviceChargeTotal}`)
  lines.push(`Retur,${report.returnTotal}`)
  lines.push(`Pembatalan,${report.voidCount}`)
  lines.push(`Pengeluaran,${report.expenseTotal}`)
  lines.push(`Laba Kotor,${report.grossProfit}`)
  lines.push('')
  lines.push('Produk,Qty Terjual,Omzet,HPP')
  for (const p of report.allProductSales) lines.push(`${p.productName},${p.qtySold},${p.revenue},${p.costTotal}`)
  lines.push('')
  lines.push('Kategori,Omzet')
  for (const c of report.byCategory) lines.push(`${c.categoryName},${c.revenue}`)
  lines.push('')
  lines.push('Kasir,Omzet,Jumlah Transaksi')
  for (const c of report.byCashier) lines.push(`${c.cashierName},${c.revenue},${c.transactionCount}`)
  lines.push('')
  lines.push('Metode Pembayaran,Jumlah')
  for (const m of report.byPaymentMethod) lines.push(`${m.method},${m.amount}`)

  await saveTextFile(`laporan-penjualan-${formatDate(report.range.from)}.csv`, lines.join('\n'), 'text/csv')
}

export async function exportSalesReportPdf(report: SalesReport): Promise<void> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  let y = 15
  doc.setFontSize(14)
  doc.text('Laporan Penjualan', 15, y)
  y += 6
  doc.setFontSize(9)
  doc.text(`${formatDate(report.range.from)} - ${formatDate(report.range.to)}`, 15, y)
  y += 8

  const summaryRows: [string, string][] = [
    ['Omzet', formatRupiah(report.revenue)],
    ['Jumlah Transaksi', String(report.transactionCount)],
    ['Rata-rata Transaksi', formatRupiah(report.averageTransaction)],
    ['Diskon', formatRupiah(report.discountTotal)],
    ['Pajak', formatRupiah(report.taxTotal)],
    ['Service Charge', formatRupiah(report.serviceChargeTotal)],
    ['Retur', formatRupiah(report.returnTotal)],
    ['Pembatalan', String(report.voidCount)],
    ['Pengeluaran', formatRupiah(report.expenseTotal)],
    ['Laba Kotor', formatRupiah(report.grossProfit)],
  ]
  for (const [label, value] of summaryRows) {
    doc.text(label, 15, y)
    doc.text(value, 100, y)
    y += 5
  }

  y += 5
  doc.setFontSize(11)
  doc.text('Produk Terlaris', 15, y)
  y += 6
  doc.setFontSize(8)
  for (const p of report.topProducts) {
    if (y > 280) {
      doc.addPage()
      y = 15
    }
    doc.text(`${p.productName} x${p.qtySold}`, 15, y)
    doc.text(formatRupiah(p.revenue), 150, y)
    y += 4.5
  }

  await saveFile(`laporan-penjualan-${formatDate(report.range.from)}.pdf`, doc.output('blob'))
}
