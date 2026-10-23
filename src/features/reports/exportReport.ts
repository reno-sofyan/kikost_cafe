import jsPDF from 'jspdf'
import { formatRupiah } from '@/lib/currency'
import { formatDate } from '@/lib/datetime'
import { saveFile, saveTextFile } from '@/lib/saveFile'
import { REPORT_SCOPE_LABELS, type SalesReport, type DateRange } from '@/db/repositories/reports'
import { ONLINE_PLATFORM_LABELS } from '@/lib/onlineOrders'
import { buildDepositReport, type DepositReport } from '@/db/repositories/deposits'
import { buildMenuEngineering, MENU_CLASS_INFO } from '@/lib/menuEngineering'
import { accountingExportToCsv, buildAccountingExport } from '@/db/repositories/accounting'
import { buildKitchenSpeedReport, buildTableTurnover, STATION_LABELS, type TableTurnover } from '@/db/repositories/serviceInsights'
import { getSettings } from '@/db/repositories/settings'
import { featuresForBusinessType } from '@/lib/businessType'
import { PAYMENT_METHOD_LABELS, paymentMethodRows } from '@/features/reports/paymentMethods'
import type { KitchenSpeed } from '@/lib/kitchenSpeed'

export async function exportAccountingJournalCsv(range: DateRange): Promise<{ balanced: boolean }> {
  const exp = await buildAccountingExport(range)
  await saveTextFile(`jurnal-akuntansi-${formatDate(range.from)}.csv`, accountingExportToCsv(exp), 'text/csv')
  return { balanced: exp.totals.balanced }
}

/** Sel CSV aman: nama produk boleh mengandung koma/kutip/baris baru. */
function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function csvRow(...cells: (string | number)[]): string {
  return cells.map(csvCell).join(',')
}

const ORDER_TYPE_LABELS: Record<string, string> = { dine_in: 'Dine-in', takeaway: 'Takeaway', delivery: 'Online' }

/** Judul & akhiran nama berkas per cakupan laporan (gabungan = nama lama, tanpa akhiran). */
function reportTitle(report: SalesReport): string {
  return report.scope === 'all' ? 'Laporan Penjualan' : `Laporan Penjualan ${REPORT_SCOPE_LABELS[report.scope]}`
}

function fileSuffix(report: SalesReport): string {
  return report.scope === 'online' ? '-online' : report.scope === 'offline' ? '-dine-in-takeaway' : ''
}

const PAYMENT_LABELS_FOR_DEPOSIT: Record<string, string> = { cash: 'Tunai', qris: 'QRIS', transfer: 'Transfer', card: 'Kartu' }

/** Ringkasan saldo member untuk laporan Keseluruhan; null bila tak ada aktivitas saldo. */
async function depositReportFor(report: SalesReport): Promise<DepositReport | null> {
  if (report.scope !== 'all') return null
  const d = await buildDepositReport(report.range)
  return d.topUpTotal > 0 || d.usedTotal !== 0 || d.withdrawnTotal > 0 || d.outstanding !== 0 || d.giftCardSoldTotal > 0 || d.giftCardOutstanding !== 0 ? d : null
}

/** Kecepatan dapur & perputaran meja untuk laporan Keseluruhan (hanya jenis usaha ber-`proTools`, dan hanya bila ada datanya). */
async function serviceInsightsFor(report: SalesReport): Promise<{ speed: KitchenSpeed | null; turnover: TableTurnover | null }> {
  if (report.scope !== 'all') return { speed: null, turnover: null }
  const features = featuresForBusinessType((await getSettings()).businessType)
  if (!features.proTools) return { speed: null, turnover: null }
  const speed = features.kitchen ? await buildKitchenSpeedReport(report.range) : null
  const turnover = features.tables ? await buildTableTurnover(report.range) : null
  return { speed: speed && speed.overall.count > 0 ? speed : null, turnover: turnover && turnover.visits > 0 ? turnover : null }
}

/** Metode pembayaran laporan sesuai metode bayar yang tersedia di jenis usaha ini. */
async function reportPaymentMethods(report: SalesReport): Promise<SalesReport['byPaymentMethod']> {
  return paymentMethodRows(report, featuresForBusinessType((await getSettings()).businessType).paymentMethods)
}

export async function exportSalesReportCsv(report: SalesReport): Promise<void> {
  const lines: string[] = []
  lines.push(csvRow(reportTitle(report), `${formatDate(report.range.from)} - ${formatDate(report.range.to)}`))
  lines.push('')
  lines.push('Ringkasan')
  lines.push(csvRow('Omzet (total diterima)', report.revenue))
  lines.push(csvRow('Jumlah Transaksi', report.transactionCount))
  lines.push(csvRow('Rata-rata Transaksi', Math.round(report.averageTransaction)))
  lines.push(csvRow('Item Terjual', report.itemsSold))
  lines.push(csvRow('Tamu Dine-in', report.guestCount))
  lines.push(csvRow('Pembatalan', report.voidCount))
  lines.push('')
  lines.push('Laba-Rugi')
  lines.push(csvRow('Penjualan Kotor', report.grossSales))
  lines.push(csvRow('Diskon', -report.discountTotal))
  lines.push(csvRow('Retur', -report.returnTotal))
  lines.push(csvRow('Penjualan Bersih', report.netSales))
  lines.push(csvRow('HPP', -report.costOfGoodsSold))
  lines.push(csvRow('Laba Kotor', report.grossMargin))
  lines.push(csvRow('Margin Laba Kotor (%)', report.grossMarginPercent.toFixed(1)))
  if (report.scope !== 'offline') lines.push(csvRow('Komisi Platform (estimasi)', -report.onlineCommissionTotal))
  if (report.kolCommissionTotal > 0) lines.push(csvRow('Komisi KOL (estimasi)', -report.kolCommissionTotal))
  if (report.scope === 'all') {
    lines.push(csvRow('Pengeluaran', -report.expenseTotal))
    lines.push(csvRow('Laba Operasional', report.operatingProfit))
  } else if (report.scope === 'online') {
    lines.push(csvRow('Laba Setelah Komisi', report.operatingProfit))
  }
  lines.push(csvRow('Pajak', report.taxTotal))
  lines.push(csvRow('Service Charge', report.serviceChargeTotal))
  lines.push(csvRow('Pembulatan', report.roundingTotal))
  lines.push(csvRow('Tip (bukan omzet)', report.tipTotal))
  if (report.scope === 'all' && report.channelSplit.online.transactionCount > 0) {
    lines.push('')
    lines.push(csvRow('Kanal', 'Omzet', 'Jumlah Transaksi'))
    lines.push(csvRow(REPORT_SCOPE_LABELS.offline, report.channelSplit.offline.revenue, report.channelSplit.offline.transactionCount))
    lines.push(csvRow(REPORT_SCOPE_LABELS.online, report.channelSplit.online.revenue, report.channelSplit.online.transactionCount))
  }
  if (report.byPlatform.length > 0) {
    lines.push('')
    lines.push(csvRow('Platform', 'Jumlah Pesanan', 'Omzet', 'Komisi (estimasi)', 'Diterima Bersih'))
    for (const p of report.byPlatform) lines.push(csvRow(ONLINE_PLATFORM_LABELS[p.platform], p.transactionCount, p.revenue, p.commission, p.net))
  }
  if (report.byPromo.length > 0) {
    lines.push('')
    lines.push(csvRow('Promo / Voucher', 'Kode', 'Dipakai', 'Potongan', 'Omzet'))
    for (const p of report.byPromo) lines.push(csvRow(p.name, p.voucherCode ?? '', p.transactionCount, p.discount, p.revenue))
  }
  if (report.byKol.length > 0) {
    lines.push('')
    lines.push(csvRow('KOL', 'Jumlah Transaksi', 'Omzet', 'Potongan', 'Komisi (estimasi)'))
    for (const k of report.byKol) lines.push(csvRow(k.name, k.transactionCount, k.revenue, k.discount, k.commission))
  }
  if (report.pointsEarnedTotal > 0 || report.pointsRedeemedTotal > 0) {
    lines.push('')
    lines.push('Member')
    lines.push(csvRow('Transaksi Member', report.memberTransactionCount))
    lines.push(csvRow('Omzet Member', report.memberRevenue))
    lines.push(csvRow('Poin Diberikan', report.pointsEarnedTotal))
    lines.push(csvRow('Poin Ditukar', report.pointsRedeemedTotal))
    lines.push(csvRow('Nilai Poin Ditukar', report.pointsRedeemedValue))
  }
  const deposit = await depositReportFor(report)
  if (deposit) {
    lines.push('')
    lines.push('Saldo Member (titipan, bukan omzet)')
    lines.push(csvRow('Isi Saldo', deposit.topUpTotal))
    for (const m of deposit.topUpByMethod) lines.push(csvRow(`Isi Saldo — ${PAYMENT_LABELS_FOR_DEPOSIT[m.method] ?? m.method}`, m.amount))
    lines.push(csvRow('Saldo Dipakai Belanja', deposit.usedTotal))
    lines.push(csvRow('Saldo Ditarik', deposit.withdrawnTotal))
    lines.push(csvRow('Titipan Saldo Saat Ini', deposit.outstanding))
    lines.push(csvRow('Voucher Hadiah Terjual', deposit.giftCardSoldTotal))
    lines.push(csvRow('Voucher Hadiah Ditukar', deposit.giftCardUsedTotal))
    lines.push(csvRow('Voucher Hadiah Belum Ditukar', deposit.giftCardOutstanding))
  }
  lines.push('')
  lines.push(csvRow('Produk', 'Qty Terjual', 'Omzet', 'HPP', 'Laba'))
  for (const p of report.allProductSales) lines.push(csvRow(p.productName, p.qtySold, p.revenue, p.costTotal, p.revenue - p.costTotal))
  const menu = buildMenuEngineering(report.allProductSales)
  if (menu.rows.length >= 4) {
    lines.push('')
    lines.push(csvRow('Analisis Menu', 'Kelompok', 'Terjual', '% Porsi', 'Margin per Porsi', 'Total Margin', 'Saran'))
    for (const r of menu.rows) {
      lines.push(csvRow(r.productName, MENU_CLASS_INFO[r.menuClass].label, r.qtySold, r.mixPercent.toFixed(1), Math.round(r.marginPerUnit), Math.round(r.marginTotal), MENU_CLASS_INFO[r.menuClass].advice))
    }
  }
  lines.push('')
  lines.push(csvRow('Kategori', 'Omzet'))
  for (const c of report.byCategory) lines.push(csvRow(c.categoryName, c.revenue))
  lines.push('')
  lines.push(csvRow('Kasir', 'Omzet', 'Jumlah Transaksi'))
  for (const c of report.byCashier) lines.push(csvRow(c.cashierName, c.revenue, c.transactionCount))
  if (report.byWaiter.length > 0) {
    lines.push('')
    lines.push(csvRow('Pelayan', 'Omzet', 'Jumlah Transaksi', 'Tamu', 'Tip'))
    for (const w of report.byWaiter) lines.push(csvRow(w.waiterName, w.revenue, w.transactionCount, w.guestCount, w.tips))
  }
  lines.push('')
  lines.push(csvRow('Jenis Pesanan', 'Omzet', 'Jumlah Transaksi'))
  for (const t of report.byOrderType) lines.push(csvRow(ORDER_TYPE_LABELS[t.type] ?? t.type, t.revenue, t.transactionCount))
  lines.push('')
  lines.push(csvRow('Metode Pembayaran', 'Jumlah', 'Transaksi'))
  for (const m of await reportPaymentMethods(report)) lines.push(csvRow(PAYMENT_METHOD_LABELS[m.method] ?? m.method, m.amount, m.count))
  lines.push('')
  lines.push(csvRow('Tanggal', 'Omzet', 'Jumlah Transaksi'))
  for (const d of report.byDay) lines.push(csvRow(d.dateKey, d.revenue, d.transactionCount))
  lines.push('')
  lines.push(csvRow('Jam', 'Omzet', 'Jumlah Transaksi'))
  for (const h of report.byHour) if (h.transactionCount > 0) lines.push(csvRow(`${String(h.hour).padStart(2, '0')}:00`, h.revenue, h.transactionCount))
  const { speed, turnover } = await serviceInsightsFor(report)
  if (speed) {
    lines.push('')
    lines.push(`Kecepatan Dapur (batas ${speed.targetMinutes > 0 ? `${speed.targetMinutes} menit` : 'dimatikan'})`)
    lines.push(csvRow('Stasiun', 'Item Disiapkan', 'Rata-rata (menit)', 'Terlambat', '% Tepat Waktu'))
    lines.push(csvRow('Semua', speed.overall.count, speed.overall.avgMinutes, speed.overall.lateCount, speed.overall.onTimePercent))
    for (const s of speed.byStation) lines.push(csvRow(STATION_LABELS[s.key] ?? s.key, s.count, s.avgMinutes, s.lateCount, s.onTimePercent))
    if (speed.lateProducts.length > 0) {
      lines.push(csvRow('Menu Paling Sering Terlambat', 'Terlambat', 'Dari', 'Rata-rata (menit)'))
      for (const p of speed.lateProducts) lines.push(csvRow(p.key, p.lateCount, p.count, p.avgMinutes))
    }
  }
  if (turnover) {
    lines.push('')
    lines.push('Perputaran Meja')
    lines.push(csvRow('Kunjungan Meja', turnover.visits))
    lines.push(csvRow('Rata-rata Lama Duduk (menit)', turnover.avgMinutes))
    lines.push(csvRow('Perputaran per Meja per Hari', turnover.turnsPerTablePerDay))
    if (turnover.longStayMinutes > 0) lines.push(csvRow(`Duduk Lebih dari ${turnover.longStayMinutes} Menit`, turnover.longStayCount))
    lines.push(csvRow('Meja', 'Terisi', 'Tamu', 'Rata-rata Duduk (menit)', 'Omzet'))
    for (const r of turnover.rows) lines.push(csvRow(r.tableName, r.visits, r.guests, r.avgMinutes, r.revenue))
  }

  // BOM supaya Excel membaca UTF-8 dengan benar.
  await saveTextFile(`laporan-penjualan${fileSuffix(report)}-${formatDate(report.range.from)}.csv`, `\uFEFF${lines.join('\n')}`, 'text/csv')
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

export async function exportSalesReportPdf(
  report: SalesReport,
  opts: { businessName?: string; showService?: boolean } = {},
): Promise<void> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  let y = 18

  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(70, 40, 22)
  doc.text(reportTitle(report), PAGE_MARGIN, y)
  if (opts.businessName) {
    doc.setFontSize(11)
    doc.text(opts.businessName, PAGE_MARGIN + CONTENT_WIDTH, y, { align: 'right' })
  }
  y += 6
  doc.setFontSize(9.5)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 100, 100)
  doc.text(`Periode ${formatDate(report.range.from)} - ${formatDate(report.range.to)}  |  Dicetak ${formatDate(Date.now())}`, PAGE_MARGIN, y)
  doc.setTextColor(30, 30, 30)
  y += 9

  y = sectionTitle(doc, y, 'Ringkasan')
  const summaryPairs: [string, string][] = [
    ['Omzet', formatRupiah(report.revenue)],
    ['Jumlah Transaksi', String(report.transactionCount)],
    ['Rata-rata Transaksi', formatRupiah(report.averageTransaction)],
    ['Item Terjual', String(report.itemsSold)],
    ['Pembatalan', String(report.voidCount)],
    ...(report.guestCount > 0
      ? ([
          ['Tamu Dine-in', String(report.guestCount)],
          ['Rata-rata per Tamu', formatRupiah(Math.round(report.averagePerGuest))],
        ] as [string, string][])
      : []),
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

  y = sectionTitle(doc, y, 'Laba-Rugi')
  const minus = (n: number) => (n === 0 ? formatRupiah(0) : `-${formatRupiah(n)}`)
  y = drawTable(
    doc,
    y,
    [
      { header: 'Pos', width: 130 },
      { header: 'Jumlah', width: 50, align: 'right' },
    ],
    [
      ['Penjualan kotor', formatRupiah(report.grossSales)],
      ['Diskon', minus(report.discountTotal)],
      ['Retur', minus(report.returnTotal)],
      ['Penjualan bersih', formatRupiah(report.netSales)],
      ['HPP (harga pokok penjualan)', minus(report.costOfGoodsSold)],
      [`Laba kotor (${report.grossMarginPercent.toFixed(1)}%)`, formatRupiah(report.grossMargin)],
      ...(report.scope !== 'offline' && (report.onlineCommissionTotal > 0 || report.scope === 'online')
        ? [['Komisi platform (estimasi)', minus(report.onlineCommissionTotal)]]
        : []),
      ...(report.kolCommissionTotal > 0 ? [['Komisi KOL (estimasi)', minus(report.kolCommissionTotal)]] : []),
      ...(report.scope === 'all'
        ? [
            ['Pengeluaran', minus(report.expenseTotal)],
            ['Laba operasional (estimasi)', formatRupiah(report.operatingProfit)],
          ]
        : report.scope === 'online'
          ? [['Laba setelah komisi (estimasi)', formatRupiah(report.operatingProfit)]]
          : []),
      ['Pajak dipungut', formatRupiah(report.taxTotal)],
      ['Service charge dipungut', formatRupiah(report.serviceChargeTotal)],
      ...(report.tipTotal > 0 ? [['Tip diterima (bukan omzet)', formatRupiah(report.tipTotal)]] : []),
    ],
  )

  if (report.scope === 'all' && report.channelSplit.online.transactionCount > 0) {
    y = sectionTitle(doc, y, 'Kanal Penjualan')
    y = drawTable(
      doc,
      y,
      [
        { header: 'Kanal', width: 90 },
        { header: 'Transaksi', width: 40, align: 'right' },
        { header: 'Omzet', width: 50, align: 'right' },
      ],
      [
        [REPORT_SCOPE_LABELS.offline, String(report.channelSplit.offline.transactionCount), formatRupiah(report.channelSplit.offline.revenue)],
        [REPORT_SCOPE_LABELS.online, String(report.channelSplit.online.transactionCount), formatRupiah(report.channelSplit.online.revenue)],
      ],
    )
  }

  if (report.byPlatform.length > 0) {
    y = sectionTitle(doc, y, 'Rekap per Platform Online')
    y = drawTable(
      doc,
      y,
      [
        { header: 'Platform', width: 50 },
        { header: 'Pesanan', width: 25, align: 'right' },
        { header: 'Omzet', width: 35, align: 'right' },
        { header: 'Komisi (est.)', width: 35, align: 'right' },
        { header: 'Diterima Bersih', width: 35, align: 'right' },
      ],
      report.byPlatform.map((p) => [ONLINE_PLATFORM_LABELS[p.platform], String(p.transactionCount), formatRupiah(p.revenue), minus(p.commission), formatRupiah(p.net)]),
    )
  }

  if (report.byPromo.length > 0) {
    y = sectionTitle(doc, y, 'Kinerja Promo & Voucher')
    y = drawTable(
      doc,
      y,
      [
        { header: 'Promo', width: 80 },
        { header: 'Dipakai', width: 25, align: 'right' },
        { header: 'Potongan', width: 35, align: 'right' },
        { header: 'Omzet', width: 40, align: 'right' },
      ],
      report.byPromo.map((p) => [p.voucherCode ? `${p.name} (${p.voucherCode})` : p.name, String(p.transactionCount), minus(p.discount), formatRupiah(p.revenue)]),
    )
  }

  if (report.byKol.length > 0) {
    y = sectionTitle(doc, y, 'Penjualan lewat KOL')
    y = drawTable(
      doc,
      y,
      [
        { header: 'KOL', width: 60 },
        { header: 'Transaksi', width: 25, align: 'right' },
        { header: 'Omzet', width: 35, align: 'right' },
        { header: 'Potongan', width: 30, align: 'right' },
        { header: 'Komisi (est.)', width: 30, align: 'right' },
      ],
      report.byKol.map((k) => [k.name, String(k.transactionCount), formatRupiah(k.revenue), minus(k.discount), formatRupiah(k.commission)]),
    )
  }

  if (report.pointsEarnedTotal > 0 || report.pointsRedeemedTotal > 0) {
    y = sectionTitle(doc, y, 'Member & Poin')
    y = drawTable(
      doc,
      y,
      [
        { header: '', width: 45 },
        { header: '', width: 45, align: 'right' },
        { header: '', width: 45 },
        { header: '', width: 45, align: 'right' },
      ],
      [
        ['Transaksi Member', String(report.memberTransactionCount), 'Omzet Member', formatRupiah(report.memberRevenue)],
        ['Poin Diberikan', String(report.pointsEarnedTotal), 'Poin Ditukar', `${report.pointsRedeemedTotal} (${formatRupiah(report.pointsRedeemedValue)})`],
      ],
    )
  }

  const deposit = await depositReportFor(report)
  if (deposit) {
    y = sectionTitle(doc, y, 'Saldo Member (titipan, bukan omzet)')
    y = drawTable(
      doc,
      y,
      [
        { header: '', width: 45 },
        { header: '', width: 45, align: 'right' },
        { header: '', width: 45 },
        { header: '', width: 45, align: 'right' },
      ],
      [
        ['Isi Saldo', formatRupiah(deposit.topUpTotal), 'Dipakai Belanja', formatRupiah(deposit.usedTotal)],
        ['Saldo Ditarik', formatRupiah(deposit.withdrawnTotal), 'Titipan Saat Ini', formatRupiah(deposit.outstanding)],
        ['Voucher Hadiah Terjual', formatRupiah(deposit.giftCardSoldTotal), 'Voucher Ditukar', formatRupiah(deposit.giftCardUsedTotal)],
        ['Voucher Belum Ditukar', formatRupiah(deposit.giftCardOutstanding), '', ''],
      ],
    )
  }

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

  if (opts.showService !== false && report.byWaiter.length > 0) {
    y = sectionTitle(doc, y, 'Penjualan per Pelayan')
    y = drawTable(
      doc,
      y,
      [
        { header: 'Pelayan', width: 60 },
        { header: 'Transaksi', width: 25, align: 'right' },
        { header: 'Tamu', width: 20, align: 'right' },
        { header: 'Tip', width: 30, align: 'right' },
        { header: 'Omzet', width: 45, align: 'right' },
      ],
      report.byWaiter.map((w) => [w.waiterName, String(w.transactionCount), String(w.guestCount), formatRupiah(w.tips), formatRupiah(w.revenue)]),
    )
  }

  const { speed, turnover } = await serviceInsightsFor(report)
  if (speed) {
    const hasTarget = speed.targetMinutes > 0
    y = sectionTitle(doc, y, `Kecepatan Dapur${hasTarget ? ` (batas ${speed.targetMinutes} menit)` : ''}`)
    y = drawTable(
      doc,
      y,
      [
        { header: 'Stasiun', width: 60 },
        { header: 'Item', width: 30, align: 'right' },
        { header: 'Rata-rata', width: 30, align: 'right' },
        { header: 'Terlambat', width: 30, align: 'right' },
        { header: 'Tepat Waktu', width: 30, align: 'right' },
      ],
      [{ ...speed.overall, key: 'Semua' }, ...speed.byStation.map((s) => ({ ...s, key: STATION_LABELS[s.key] ?? s.key }))].map((s) => [
        s.key,
        String(s.count),
        `${s.avgMinutes} mnt`,
        hasTarget ? String(s.lateCount) : '-',
        hasTarget ? `${s.onTimePercent.toFixed(0)}%` : '-',
      ]),
    )
    if (speed.lateProducts.length > 0) {
      y = sectionTitle(doc, y, 'Menu Paling Sering Terlambat')
      y = drawTable(
        doc,
        y,
        [
          { header: 'Menu', width: 100 },
          { header: 'Terlambat', width: 40, align: 'right' },
          { header: 'Rata-rata', width: 40, align: 'right' },
        ],
        speed.lateProducts.map((p) => [p.key, `${p.lateCount} dari ${p.count}`, `${p.avgMinutes} mnt`]),
      )
    }
  }
  if (turnover) {
    y = sectionTitle(doc, y, 'Perputaran Meja')
    y = drawTable(
      doc,
      y,
      [
        { header: '', width: 55 },
        { header: '', width: 35, align: 'right' },
        { header: '', width: 55 },
        { header: '', width: 35, align: 'right' },
      ],
      [
        ['Kunjungan Meja', String(turnover.visits), 'Rata-rata Lama Duduk', `${turnover.avgMinutes} mnt`],
        ['Perputaran per Meja per Hari', `${turnover.turnsPerTablePerDay.toFixed(1)}x`, turnover.longStayMinutes > 0 ? `Lebih dari ${turnover.longStayMinutes} mnt` : '', turnover.longStayMinutes > 0 ? String(turnover.longStayCount) : ''],
      ],
    )
    y = drawTable(
      doc,
      y,
      [
        { header: 'Meja', width: 60 },
        { header: 'Terisi', width: 25, align: 'right' },
        { header: 'Tamu', width: 25, align: 'right' },
        { header: 'Rata-rata Duduk', width: 30, align: 'right' },
        { header: 'Omzet', width: 40, align: 'right' },
      ],
      turnover.rows.map((r) => [r.tableName, `${r.visits}x`, String(r.guests), `${r.avgMinutes} mnt`, formatRupiah(r.revenue)]),
    )
  }

  if (report.byOrderType.length > 1) {
    y = sectionTitle(doc, y, 'Jenis Pesanan')
    y = drawTable(
      doc,
      y,
      [
        { header: 'Jenis', width: 90 },
        { header: 'Transaksi', width: 40, align: 'right' },
        { header: 'Omzet', width: 50, align: 'right' },
      ],
      report.byOrderType.map((t) => [ORDER_TYPE_LABELS[t.type] ?? t.type, String(t.transactionCount), formatRupiah(t.revenue)]),
    )
  }

  y = sectionTitle(doc, y, 'Metode Pembayaran')
  y = drawTable(
    doc,
    y,
    [
      { header: 'Metode', width: 90 },
      { header: 'Transaksi', width: 40, align: 'right' },
      { header: 'Jumlah', width: 50, align: 'right' },
    ],
    (await reportPaymentMethods(report)).map((m) => [PAYMENT_METHOD_LABELS[m.method] ?? m.method, String(m.count), formatRupiah(m.amount)]),
  )

  if (report.byDay.length > 1) {
    y = sectionTitle(doc, y, 'Penjualan Harian')
    drawTable(
      doc,
      y,
      [
        { header: 'Tanggal', width: 90 },
        { header: 'Transaksi', width: 40, align: 'right' },
        { header: 'Omzet', width: 50, align: 'right' },
      ],
      report.byDay.map((d) => [d.dateKey, String(d.transactionCount), formatRupiah(d.revenue)]),
    )
  }

  addFooters(doc)

  await saveFile(`laporan-penjualan${fileSuffix(report)}-${formatDate(report.range.from)}.pdf`, doc.output('blob'))
}
