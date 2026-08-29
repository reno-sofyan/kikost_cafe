import { formatRupiah } from '@/lib/currency'
import { formatDateTime } from '@/lib/datetime'
import type { ShiftSummary } from '@/db/repositories/shifts'

export function printShiftReport(summary: ShiftSummary): void {
  const { shift } = summary
  const row = (label: string, value: string) => `<div class="row"><span>${label}</span><span>${value}</span></div>`

  const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  @page { size: 80mm auto; margin: 2mm; }
  body { width: 76mm; font-family: 'Courier New', monospace; font-size: 11px; margin: 0; }
  .center { text-align: center; }
  .bold { font-weight: 700; }
  .row { display: flex; justify-content: space-between; gap: 6px; padding: 1px 0; }
  hr { border: none; border-top: 1px dashed #000; margin: 4px 0; }
</style></head>
<body>
  <div class="center bold">LAPORAN TUTUP SHIFT</div>
  <div class="center">${shift.cashierName}</div>
  <hr />
  ${row('Dibuka', formatDateTime(shift.openedAt))}
  ${row('Ditutup', shift.closedAt ? formatDateTime(shift.closedAt) : '-')}
  <hr />
  ${row('Modal Awal', formatRupiah(shift.openingCash))}
  ${row('Penjualan Tunai', formatRupiah(summary.cashSales))}
  ${row('Penjualan Non-Tunai', formatRupiah(summary.nonCashSales))}
  ${row('Total Penjualan', formatRupiah(summary.totalSales))}
  ${row('Jumlah Transaksi', String(summary.transactionCount))}
  <hr />
  ${row('Kas Masuk', formatRupiah(summary.cashIn))}
  ${row('Kas Keluar', formatRupiah(summary.cashOut))}
  ${row('Pengeluaran', formatRupiah(summary.totalExpenses))}
  <hr />
  ${row('Diskon', formatRupiah(summary.discountTotal))}
  ${row('Pajak', formatRupiah(summary.taxTotal))}
  ${row('Service Charge', formatRupiah(summary.serviceChargeTotal))}
  ${row('Retur', formatRupiah(summary.returnTotal))}
  ${row('Pembatalan', String(summary.voidCount))}
  <hr />
  <div class="row bold"><span>Kas Seharusnya</span><span>${formatRupiah(shift.expectedCash)}</span></div>
  <div class="row bold"><span>Kas Aktual</span><span>${formatRupiah(shift.closingCashActual ?? 0)}</span></div>
  <div class="row bold"><span>Selisih</span><span>${formatRupiah(shift.variance ?? 0)}</span></div>
</body></html>`

  const frame = document.createElement('iframe')
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  document.body.appendChild(frame)
  const doc = frame.contentWindow?.document
  if (!doc) return
  doc.open()
  doc.write(html)
  doc.close()
  setTimeout(() => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    setTimeout(() => document.body.removeChild(frame), 2000)
  }, 200)
}
