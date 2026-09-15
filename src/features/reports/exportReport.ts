import jsPDF from 'jspdf'
import { formatRupiah } from '@/lib/currency'
import { formatDate } from '@/lib/datetime'
import { saveFile, saveTextFile } from '@/lib/saveFile'
import type { SalesReport, DateRange } from '@/db/repositories/reports'
import { accountingExportToCsv, buildAccountingExport } from '@/db/repositories/accounting'

export async function exportAccountingJournalCsv(range: DateRange): Promise<{ balanced: boolean }> {
  const exp = await buildAccountingExport(range)
  await saveTextFile(`jurnal-akuntansi-${formatDate(range.from)}.csv`, accountingExportToCsv(exp), 'text/csv')
  return { balanced: exp.totals.balanced }
}

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

const PDF_PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer',
  card: 'Kartu',
}

const PAGE_MARGIN = 15
const PAGE_BOTTOM = 282
const CONTENT_WIDTH = 180

interface TableColumn {
  header: string
  width: number
  align?: 'left' | 'right'
}

/** Menggambar tabel dengan border, header terisi warna, dan baris zebra; mengulang header bila pindah halaman. Kolom tanpa judul (header kosong semua) tidak digambar bar header-nya. */
function drawTable(doc: jsPDF, startY: number, columns: TableColumn[], rows: string[][]): number {
  const rowHeight = 6
  const headerHeight = 7
  const hasHeader = columns.some((c) => c.header !== '')
  let y = startY

  function drawHeader() {
    if (!hasHeader) return
    doc.setFillColor(70, 40, 22)
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(8.5)
    doc.setFont('helvetica', 'bold')
    doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, headerHeight, 'F')
    let x = PAGE_MARGIN
    for (const col of columns) {
      const tx = col.align === 'right' ? x + col.width - 2 : x + 2
      doc.text(col.header, tx, y + headerHeight - 2.3, { align: col.align === 'right' ? 'right' : 'left' })
      x += col.width
    }
    y += headerHeight
    doc.setTextColor(30, 30, 30)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
  }

  drawHeader()

  rows.forEach((row, i) => {
    if (y + rowHeight > PAGE_BOTTOM) {
      doc.addPage()
      y = PAGE_MARGIN
      drawHeader()
    }
    if (i % 2 === 1) {
      doc.setFillColor(245, 240, 235)
      doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, rowHeight, 'F')
    }
    doc.setDrawColor(220, 210, 200)
    doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, rowHeight)
    let x = PAGE_MARGIN
    for (const [j, col] of columns.entries()) {
      const tx = col.align === 'right' ? x + col.width - 2 : x + 2
      doc.text(row[j] ?? '', tx, y + rowHeight - 2, { align: col.align === 'right' ? 'right' : 'left', maxWidth: col.width - 4 })
      x += col.width
    }
    y += rowHeight
  })

  if (rows.length === 0) {
    doc.setTextColor(140, 140, 140)
    doc.text('Tidak ada data', PAGE_MARGIN + 2, y + rowHeight - 2)
    doc.setTextColor(30, 30, 30)
    y += rowHeight
  }

  return y + 6
}

function sectionTitle(doc: jsPDF, y: number, title: string): number {
  if (y + 12 > PAGE_BOTTOM) {
    doc.addPage()
    y = PAGE_MARGIN
  }
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(70, 40, 22)
  doc.text(title, PAGE_MARGIN, y)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(30, 30, 30)
  return y + 6
}

function addFooters(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages()
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)
    doc.setFontSize(7.5)
    doc.setTextColor(150, 150, 150)
    doc.text(`Halaman ${p} / ${pageCount}`, PAGE_MARGIN + CONTENT_WIDTH, 291, { align: 'right' })
  }
}

export async function exportSalesReportPdf(report: SalesReport): Promise<void> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  let y = 18

  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(70, 40, 22)
  doc.text('Laporan Penjualan', PAGE_MARGIN, y)
  y += 6
  doc.setFontSize(9.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 100, 100)
  doc.text(`${formatDate(report.range.from)} - ${formatDate(report.range.to)}`, PAGE_MARGIN, y)
  doc.setTextColor(30, 30, 30)
  y += 9

  y = sectionTitle(doc, y, 'Ringkasan')
  const summaryPairs: [string, string][] = [
    ['Omzet', formatRupiah(report.revenue)],
    ['Jumlah Transaksi', String(report.transactionCount)],
    ['Rata-rata Transaksi', formatRupiah(report.averageTransaction)],
    ['Laba Kotor', formatRupiah(report.grossProfit)],
    ['Diskon', formatRupiah(report.discountTotal)],
    ['Pajak', formatRupiah(report.taxTotal)],
    ['Service Charge', formatRupiah(report.serviceChargeTotal)],
    ['Retur', formatRupiah(report.returnTotal)],
    ['Pembatalan', String(report.voidCount)],
    ['Pengeluaran', formatRupiah(report.expenseTotal)],
  ]
  const summaryRows: string[][] = []
  for (let i = 0; i < summaryPairs.length; i += 2) {
    const [l1, v1] = summaryPairs[i]
    const [l2, v2] = summaryPairs[i + 1] ?? ['', '']
    summaryRows.push([l1, v1, l2, v2])
  }
  y = drawTable(
    doc,
    y,
    [
      { header: '', width: 45 },
      { header: '', width: 45, align: 'right' },
      { header: '', width: 45 },
      { header: '', width: 45, align: 'right' },
    ],
    summaryRows,
  )

  y = sectionTitle(doc, y, 'Produk Terlaris')
  y = drawTable(
    doc,
    y,
    [
      { header: 'Produk', width: 100 },
      { header: 'Qty', width: 30, align: 'right' },
      { header: 'Omzet', width: 50, align: 'right' },
    ],
    report.topProducts.map((p) => [p.productName, String(p.qtySold), formatRupiah(p.revenue)]),
  )

  y = sectionTitle(doc, y, 'Penjualan per Kategori')
  y = drawTable(
    doc,
    y,
    [
      { header: 'Kategori', width: 130 },
      { header: 'Omzet', width: 50, align: 'right' },
    ],
    report.byCategory.map((c) => [c.categoryName, formatRupiah(c.revenue)]),
  )

  y = sectionTitle(doc, y, 'Penjualan per Kasir')
  y = drawTable(
    doc,
    y,
    [
      { header: 'Kasir', width: 90 },
      { header: 'Transaksi', width: 40, align: 'right' },
      { header: 'Omzet', width: 50, align: 'right' },
    ],
    report.byCashier.map((c) => [c.cashierName, String(c.transactionCount), formatRupiah(c.revenue)]),
  )

  y = sectionTitle(doc, y, 'Metode Pembayaran')
  drawTable(
    doc,
    y,
    [
      { header: 'Metode', width: 130 },
      { header: 'Jumlah', width: 50, align: 'right' },
    ],
    report.byPaymentMethod.map((m) => [PDF_PAYMENT_METHOD_LABELS[m.method] ?? m.method, formatRupiah(m.amount)]),
  )

  addFooters(doc)

  await saveFile(`laporan-penjualan-${formatDate(report.range.from)}.pdf`, doc.output('blob'))
}
