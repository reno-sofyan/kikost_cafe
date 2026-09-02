import { formatRupiah } from '@/lib/currency'
import type { ReceiptData } from '@/features/printing/receiptData'

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function renderReceiptBodyHtml(data: ReceiptData): string {
  const rows: string[] = []

  if (data.isVoided) {
    rows.push('<div class="voided">** TRANSAKSI DIBATALKAN **</div>')
  }
  if (data.logoDataUrl) {
    rows.push(`<img class="logo" src="${data.logoDataUrl}" alt="logo" />`)
  }
  rows.push(`<div class="center bold big">${escapeHtml(data.cafeName)}</div>`)
  if (data.address) rows.push(`<div class="center">${escapeHtml(data.address)}</div>`)
  if (data.phone) rows.push(`<div class="center">${escapeHtml(data.phone)}</div>`)
  rows.push('<hr />')
  rows.push(`<div>No: ${escapeHtml(data.orderNumber)}</div>`)
  rows.push(`<div>Kasir: ${escapeHtml(data.cashierName)}</div>`)
  rows.push(`<div>Waktu: ${escapeHtml(data.createdAtLabel)}</div>`)
  rows.push(`<div>Tipe: ${escapeHtml(data.orderTypeLabel)}${data.tableLabel ? ` (${escapeHtml(data.tableLabel)})` : ''}</div>`)
  if (data.queueLabel) rows.push(`<div>${escapeHtml(data.queueLabel)}</div>`)
  if (data.customerNote) rows.push(`<div>Pelanggan: ${escapeHtml(data.customerNote)}</div>`)
  rows.push('<hr />')

  for (const item of data.lines) {
    rows.push(`<div class="row"><span>${item.qty}x ${escapeHtml(item.name)}</span><span>${formatRupiah(item.lineTotal)}</span></div>`)
    for (const modLine of item.modifierLines) rows.push(`<div class="sub">${escapeHtml(modLine)}</div>`)
    if (item.note) rows.push(`<div class="sub">Catatan: ${escapeHtml(item.note)}</div>`)
  }
  rows.push('<hr />')

  rows.push(`<div class="row"><span>Subtotal</span><span>${formatRupiah(data.subtotal)}</span></div>`)
  if (data.discountAmount > 0) rows.push(`<div class="row"><span>Diskon</span><span>-${formatRupiah(data.discountAmount)}</span></div>`)
  if (data.serviceChargeAmount > 0) {
    rows.push(`<div class="row"><span>Service (${data.serviceChargePercent}%)</span><span>${formatRupiah(data.serviceChargeAmount)}</span></div>`)
  }
  if (data.taxAmount > 0) {
    rows.push(`<div class="row"><span>Pajak (${data.taxPercent}%)</span><span>${formatRupiah(data.taxAmount)}</span></div>`)
  }
  if (data.roundingAdjustment !== 0) {
    rows.push(`<div class="row"><span>Pembulatan</span><span>${formatRupiah(data.roundingAdjustment)}</span></div>`)
  }
  rows.push(`<div class="row bold big"><span>TOTAL</span><span>${formatRupiah(data.grandTotal)}</span></div>`)
  rows.push('<hr />')

  for (const payment of data.payments) {
    rows.push(`<div class="row"><span>${escapeHtml(payment.methodLabel)}</span><span>${formatRupiah(payment.amount)}</span></div>`)
    if (payment.receivedAmount != null) {
      rows.push(`<div class="row"><span>Bayar</span><span>${formatRupiah(payment.receivedAmount)}</span></div>`)
    }
    if (payment.changeAmount != null && payment.changeAmount > 0) {
      rows.push(`<div class="row"><span>Kembali</span><span>${formatRupiah(payment.changeAmount)}</span></div>`)
    }
  }
  rows.push('<hr />')
  if (data.footerNote) rows.push(`<div class="center">${escapeHtml(data.footerNote)}</div>`)

  return rows.join('\n')
}

export function renderReceiptDocument(data: ReceiptData): string {
  const widthMm = data.paperSize === '58mm' ? 58 : 80
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: ${widthMm}mm auto; margin: 2mm; }
  body { width: ${widthMm - 4}mm; font-family: 'Courier New', monospace; font-size: 11px; color: #000; margin: 0; }
  .center { text-align: center; }
  .bold { font-weight: 700; }
  .big { font-size: 13px; }
  .row { display: flex; justify-content: space-between; gap: 6px; }
  .sub { padding-left: 8px; font-size: 10px; color: #333; }
  .voided { text-align: center; font-weight: 700; border: 1px solid #000; padding: 2px; margin-bottom: 4px; }
  .logo { display: block; margin: 0 auto 4px; max-height: 48px; max-width: 100%; }
  hr { border: none; border-top: 1px dashed #000; margin: 4px 0; }
</style>
</head>
<body>${renderReceiptBodyHtml(data)}</body>
</html>`
}
