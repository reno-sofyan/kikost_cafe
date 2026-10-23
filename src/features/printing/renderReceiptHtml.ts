import { formatRupiah } from '@/lib/currency'
import type { ReceiptData } from '@/features/printing/receiptData'
import QRCode from 'qrcode'

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function renderReceiptBodyHtml(data: ReceiptData): string {
  const rows: string[] = []

  if (data.isVoided) {
    rows.push('<div class="voided">** TRANSAKSI DIBATALKAN **</div>')
  }
  if (data.isPreBill) {
    rows.push(`<div class="voided">${data.additions ? 'TAGIHAN TAMBAHAN' : 'TAGIHAN SEMENTARA'}<br />BELUM DIBAYAR</div>`)
  }
  if (data.isReprint) {
    rows.push('<div class="center bold">*** CETAK ULANG ***</div>')
  }
  if (data.logoDataUrl) {
    rows.push(`<img class="logo" src="${data.logoDataUrl}" alt="logo" />`)
  }
  rows.push(`<div class="center bold big">${escapeHtml(data.businessName)}</div>`)
  if (data.address) rows.push(`<div class="center">${escapeHtml(data.address)}</div>`)
  if (data.phone) rows.push(`<div class="center">${escapeHtml(data.phone)}</div>`)
  rows.push('<hr />')
  rows.push(`<div>No: ${escapeHtml(data.orderNumber)}</div>`)
  rows.push(`<div>Kasir: ${escapeHtml(data.cashierName)}</div>`)
  if (data.waiterName) rows.push(`<div>Pelayan: ${escapeHtml(data.waiterName)}</div>`)
  rows.push(`<div>Waktu: ${escapeHtml(data.createdAtLabel)}</div>`)
  if (data.orderTypeLabel) {
    rows.push(`<div>Tipe: ${escapeHtml(data.orderTypeLabel)}${data.tableLabel ? ` (${escapeHtml(data.tableLabel)})` : ''}</div>`)
  }
  if (data.onlineChannel) rows.push(`<div>Kanal: ${escapeHtml(data.onlineChannel)}</div>`)
  if (data.guestCount) rows.push(`<div>Tamu: ${data.guestCount} orang</div>`)
  if (data.queueLabel) rows.push(`<div>${escapeHtml(data.queueLabel)}</div>`)
  if (data.customerNote) rows.push(`<div>Pelanggan: ${escapeHtml(data.customerNote)}</div>`)
  rows.push('<hr />')

  for (const item of data.lines) {
    rows.push(`<div class="row"><span>${item.qty}x ${escapeHtml(item.name)}</span><span>${formatRupiah(item.lineTotal)}</span></div>`)
    for (const modLine of item.modifierLines) rows.push(`<div class="sub">${escapeHtml(modLine)}</div>`)
    if (item.note) rows.push(`<div class="sub">Catatan: ${escapeHtml(item.note)}</div>`)
  }
  rows.push('<hr />')

  if (data.additions) {
    rows.push(`<div class="row"><span>Subtotal tambahan</span><span>${formatRupiah(data.additions.subtotal)}</span></div>`)
    rows.push('<hr />')
    rows.push(`<div class="row bold big"><span>TOTAL KESELURUHAN</span><span>${formatRupiah(data.grandTotal)}</span></div>`)
    if (data.taxAmount > 0 || data.serviceChargeAmount > 0) rows.push('<div class="sub">(termasuk pajak &amp; service)</div>')
  } else {
    rows.push(`<div class="row"><span>Subtotal</span><span>${formatRupiah(data.subtotal)}</span></div>`)
    if (data.discountAmount > 0) {
      for (const d of data.discountLines?.length ? data.discountLines : [{ label: 'Diskon', amount: data.discountAmount }]) {
        rows.push(`<div class="row"><span>${escapeHtml(d.label)}</span><span>-${formatRupiah(d.amount)}</span></div>`)
      }
    }
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
  }
  rows.push('<hr />')

  if (data.isPreBill && data.payments.length > 0) {
    const paid = data.payments.reduce((s, p) => s + p.amount, 0)
    rows.push(`<div class="row"><span>Sudah dibayar</span><span>${formatRupiah(paid)}</span></div>`)
    rows.push(`<div class="row bold"><span>SISA TAGIHAN</span><span>${formatRupiah(Math.max(0, data.grandTotal - paid))}</span></div>`)
    rows.push('<hr />')
  }
  if (!data.isPreBill) {
    for (const payment of data.payments) {
      rows.push(`<div class="row"><span>${escapeHtml(payment.methodLabel)}</span><span>${formatRupiah(payment.amount)}</span></div>`)
      if (payment.receivedAmount != null) {
        rows.push(`<div class="row"><span>Bayar</span><span>${formatRupiah(payment.receivedAmount)}</span></div>`)
      }
      if (payment.changeAmount != null && payment.changeAmount > 0) {
        rows.push(`<div class="row"><span>Kembali</span><span>${formatRupiah(payment.changeAmount)}</span></div>`)
      }
    }
    if (data.tipTotal && data.tipTotal > 0) {
      rows.push(`<div class="row"><span>Tip (terima kasih!)</span><span>${formatRupiah(data.tipTotal)}</span></div>`)
    }
    rows.push('<hr />')
  }
  if (data.isPreBill) rows.push('<div class="center">Bukan bukti pembayaran.<br />Silakan bayar di kasir.</div>')
  if (data.pointsEarned && data.pointsEarned > 0) rows.push(`<div class="center">Anda mendapat ${data.pointsEarned} poin member</div>`)
  if (data.depositBalance != null) rows.push(`<div class="center">Sisa saldo member ${formatRupiah(data.depositBalance)}</div>`)
  for (const g of data.giftCardBalances ?? []) rows.push(`<div class="center">Sisa voucher ${escapeHtml(g.code)} ${formatRupiah(g.balance)}</div>`)
  if (data.footerNote) rows.push(`<div class="center">${escapeHtml(data.footerNote)}</div>`)
  if (data.reviewUrl) {
    rows.push('<div class="center bold review">Beri ulasan untuk kami</div>')
    rows.push(`<div class="center">${qrSvg(data.reviewUrl)}</div>`)
  }

  return rows.join('\n')
}

/** QR sebagai SVG sinkron (tanpa canvas) — dipakai pratinjau & cetak lewat dialog sistem. */
function qrSvg(text: string): string {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const n = modules.size
  let path = ''
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (modules.get(y, x)) path += `M${x + 2} ${y + 2}h1v1h-1z`
  return `<svg class="qr" width="120" height="120" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`
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
  .review { margin-top: 6px; }
  .qr { display: block; margin: 2px auto 0; width: 28mm; height: 28mm; }
  hr { border: none; border-top: 1px dashed #000; margin: 4px 0; }
</style>
</head>
<body>${renderReceiptBodyHtml(data)}</body>
</html>`
}
