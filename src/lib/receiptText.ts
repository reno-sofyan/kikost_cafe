import { formatRupiah } from '@/lib/currency'
import type { ReceiptData } from '@/features/printing/receiptData'

/**
 * Struk sebagai teks polos untuk dikirim lewat WhatsApp. `*…*` = tebal di WhatsApp.
 * Isinya mengikuti struk cetak: item, potongan, pajak, total, pembayaran, poin/saldo.
 */
export function receiptToText(data: ReceiptData): string {
  const out: string[] = []
  out.push(`*${data.businessName}*`)
  if (data.address) out.push(data.address)
  if (data.phone) out.push(data.phone)
  out.push('')
  out.push(`${data.additions ? 'Tagihan tambahan' : data.isPreBill ? 'Tagihan sementara' : 'Struk'} ${data.orderNumber}`)
  out.push(data.createdAtLabel)
  const where = [data.orderTypeLabel, data.tableLabel, data.queueLabel, data.onlineChannel].filter(Boolean).join(' • ')
  if (where) out.push(where)
  if (data.isVoided) out.push('*TRANSAKSI DIBATALKAN*')
  out.push('')
  for (const line of data.lines) {
    out.push(`${line.qty}× ${line.name} — ${formatRupiah(line.lineTotal)}`)
    for (const m of line.modifierLines) out.push(`   ${m}`)
    if (line.note) out.push(`   Catatan: ${line.note}`)
  }
  out.push('')
  if (data.additions) {
    out.push(`Subtotal tambahan: ${formatRupiah(data.additions.subtotal)}`)
    out.push(`*Total keseluruhan: ${formatRupiah(data.grandTotal)}*`)
    return out.join('\n')
  }
  out.push(`Subtotal: ${formatRupiah(data.subtotal)}`)
  if (data.discountLines?.length) for (const d of data.discountLines) out.push(`${d.label}: -${formatRupiah(d.amount)}`)
  else if (data.discountAmount > 0) out.push(`Diskon: -${formatRupiah(data.discountAmount)}`)
  if (data.serviceChargeAmount > 0) out.push(`Service ${data.serviceChargePercent}%: ${formatRupiah(data.serviceChargeAmount)}`)
  if (data.taxAmount > 0) out.push(`Pajak ${data.taxPercent}%: ${formatRupiah(data.taxAmount)}`)
  if (data.roundingAdjustment !== 0) out.push(`Pembulatan: ${formatRupiah(data.roundingAdjustment)}`)
  out.push(`*Total: ${formatRupiah(data.grandTotal)}*`)
  if (!data.isPreBill && data.payments.length) {
    out.push('')
    for (const p of data.payments) {
      out.push(`${p.methodLabel}: ${formatRupiah(p.receivedAmount ?? p.amount)}`)
      if (p.changeAmount) out.push(`Kembalian: ${formatRupiah(p.changeAmount)}`)
    }
    if (data.tipTotal) out.push(`Tip: ${formatRupiah(data.tipTotal)}`)
  }
  if (data.pointsEarned) out.push(`Poin didapat: +${data.pointsEarned}`)
  if (data.depositBalance != null) out.push(`Sisa saldo member: ${formatRupiah(data.depositBalance)}`)
  for (const g of data.giftCardBalances ?? []) out.push(`Sisa voucher ${g.code}: ${formatRupiah(g.balance)}`)
  if (data.footerNote) {
    out.push('')
    out.push(data.footerNote)
  }
  if (data.reviewUrl) {
    out.push('')
    out.push(`Beri ulasan untuk kami: ${data.reviewUrl}`)
  }
  return out.join('\n')
}
