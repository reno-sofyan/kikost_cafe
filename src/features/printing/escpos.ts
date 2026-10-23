import { formatRupiah } from '@/lib/currency'
import type { ReceiptData } from '@/features/printing/receiptData'
import { escPosRasterCommand, type MonoBitmap } from '@/features/printing/logoRaster'
import type { KitchenTicketPayload } from '@/types/domain'

const ESC = 0x1b
const GS = 0x1d

const CHARS_PER_LINE: Record<'58mm' | '80mm', number> = { '58mm': 32, '80mm': 48 }

class EscPosBuilder {
  private bytes: number[] = []

  raw(...values: number[]): this {
    this.bytes.push(...values)
    return this
  }

  text(value: string): this {
    this.bytes.push(...Array.from(new TextEncoder().encode(value)))
    return this
  }

  line(value = ''): this {
    return this.text(value).raw(0x0a)
  }

  init(): this {
    return this.raw(ESC, 0x40)
  }

  align(mode: 'left' | 'center' | 'right'): this {
    const code = mode === 'left' ? 0 : mode === 'center' ? 1 : 2
    return this.raw(ESC, 0x61, code)
  }

  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0)
  }

  doubleHeight(on: boolean): this {
    return this.raw(GS, 0x21, on ? 0x11 : 0x00)
  }

  cut(): this {
    return this.raw(GS, 0x56, 0x00)
  }

  feed(lines: number): this {
    return this.raw(ESC, 0x64, lines)
  }

  /** QR model 2 (`GS ( k`). Printer yang tak mendukung mengabaikannya — URL tetap dicetak sebagai teks. */
  qr(data: string, moduleSize: number): this {
    const bytes = Array.from(new TextEncoder().encode(data))
    const len = bytes.length + 3
    this.raw(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00)
    this.raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, moduleSize)
    this.raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31)
    this.raw(GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...bytes)
    return this.raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30)
  }

  bytesRaw(values: Uint8Array): this {
    for (const v of values) this.bytes.push(v)
    return this
  }

  toBytes(): Uint8Array {
    return new Uint8Array(this.bytes)
  }
}

function divider(width: number): string {
  return '-'.repeat(width)
}

function twoColumns(left: string, right: string, width: number): string {
  const space = Math.max(1, width - left.length - right.length)
  return `${left}${' '.repeat(space)}${right}`
}

export function buildEscPosReceipt(data: ReceiptData, logo?: MonoBitmap | null): Uint8Array {
  const width = CHARS_PER_LINE[data.paperSize]
  const b = new EscPosBuilder().init()

  b.align('center')
  if (logo) b.bytesRaw(escPosRasterCommand(logo)).feed(1)
  if (data.isVoided) {
    b.bold(true).line('** TRANSAKSI DIBATALKAN **').bold(false)
  }
  if (data.isPreBill) {
    b.bold(true).line('TAGIHAN SEMENTARA').line('BELUM DIBAYAR').bold(false)
  }
  b.doubleHeight(true).bold(true).line(data.businessName).bold(false).doubleHeight(false)
  if (data.address) b.line(data.address)
  if (data.phone) b.line(data.phone)
  b.line(divider(width))

  b.align('left')
  b.line(`No: ${data.orderNumber}`)
  b.line(`Kasir: ${data.cashierName}`)
  if (data.waiterName) b.line(`Pelayan: ${data.waiterName}`)
  b.line(`Waktu: ${data.createdAtLabel}`)
  if (data.orderTypeLabel) b.line(`Tipe: ${data.orderTypeLabel}${data.tableLabel ? ` (${data.tableLabel})` : ''}`)
  if (data.onlineChannel) b.line(`Kanal: ${data.onlineChannel}`)
  if (data.guestCount) b.line(`Tamu: ${data.guestCount} orang`)
  if (data.queueLabel) b.line(data.queueLabel)
  if (data.customerNote) b.line(`Pelanggan: ${data.customerNote}`)
  if (data.isReprint) b.line('*** CETAK ULANG ***')
  b.line(divider(width))

  for (const item of data.lines) {
    b.line(`${item.qty}x ${item.name}`)
    for (const modLine of item.modifierLines) b.line(modLine)
    if (item.note) b.line(`  Catatan: ${item.note}`)
    b.line(twoColumns('', formatRupiah(item.lineTotal), width))
  }
  b.line(divider(width))

  b.line(twoColumns('Subtotal', formatRupiah(data.subtotal), width))
  if (data.discountAmount > 0) {
    for (const d of data.discountLines?.length ? data.discountLines : [{ label: 'Diskon', amount: data.discountAmount }]) {
      b.line(twoColumns(d.label, `-${formatRupiah(d.amount)}`, width))
    }
  }
  if (data.serviceChargeAmount > 0) {
    b.line(twoColumns(`Service (${data.serviceChargePercent}%)`, formatRupiah(data.serviceChargeAmount), width))
  }
  if (data.taxAmount > 0) b.line(twoColumns(`Pajak (${data.taxPercent}%)`, formatRupiah(data.taxAmount), width))
  if (data.roundingAdjustment !== 0) b.line(twoColumns('Pembulatan', formatRupiah(data.roundingAdjustment), width))
  b.bold(true).line(twoColumns('TOTAL', formatRupiah(data.grandTotal), width)).bold(false)
  b.line(divider(width))

  if (data.isPreBill) {
    if (data.payments.length > 0) {
      const paid = data.payments.reduce((s, p) => s + p.amount, 0)
      b.line(twoColumns('Sudah dibayar', formatRupiah(paid), width))
      b.bold(true).line(twoColumns('SISA TAGIHAN', formatRupiah(Math.max(0, data.grandTotal - paid)), width)).bold(false)
      b.line(divider(width))
    }
  } else {
    for (const payment of data.payments) {
      b.line(twoColumns(payment.methodLabel, formatRupiah(payment.amount), width))
      if (payment.receivedAmount != null) b.line(twoColumns('Bayar', formatRupiah(payment.receivedAmount), width))
      if (payment.changeAmount != null && payment.changeAmount > 0) {
        b.line(twoColumns('Kembali', formatRupiah(payment.changeAmount), width))
      }
    }
    if (data.tipTotal && data.tipTotal > 0) b.line(twoColumns('Tip', formatRupiah(data.tipTotal), width))
    b.line(divider(width))
  }

  b.align('center')
  if (data.isPreBill) b.line('Bukan bukti pembayaran.').line('Silakan bayar di kasir.')
  if (data.pointsEarned && data.pointsEarned > 0) b.line(`Anda mendapat ${data.pointsEarned} poin member`)
  if (data.depositBalance != null) b.line(`Sisa saldo member ${formatRupiah(data.depositBalance)}`)
  for (const g of data.giftCardBalances ?? []) b.line(`Sisa voucher ${g.code} ${formatRupiah(g.balance)}`)
  if (data.footerNote) b.line(data.footerNote)
  if (data.reviewUrl) {
    b.line().bold(true).line('Beri ulasan untuk kami').bold(false)
    b.qr(data.reviewUrl, data.paperSize === '58mm' ? 4 : 6).line()
  }
  b.feed(3).cut()

  return b.toBytes()
}

/**
 * Pulsa pembuka laci kasir (cash drawer RJ11 yang dicolok ke printer struk):
 * `ESC p m t1 t2` — t1=25 (50 ms nyala), t2=250 (500 ms jeda). Dikirim ke pin 2
 * lalu pin 5, karena laci berbeda merek memakai pin berbeda; pulsa ke pin yang
 * tak tersambung diabaikan printer. Tidak mencetak/menggulung kertas.
 */
export function buildEscPosDrawerKick(): Uint8Array {
  return new EscPosBuilder().raw(ESC, 0x70, 0x00, 25, 250).raw(ESC, 0x70, 0x01, 25, 250).toBytes()
}

/** Tiket dapur/bar ESC/POS — hanya item pada tiket ini (tak mencetak ulang pesanan lama). */
export function buildEscPosKitchenTicket(p: KitchenTicketPayload): Uint8Array {
  const width = CHARS_PER_LINE[p.paperSize]
  const b = new EscPosBuilder().init()

  b.align('center')
  b.doubleHeight(true).bold(true).line(p.ticketLabel || 'ORDER DAPUR').bold(false).doubleHeight(false)
  if (p.outletName) b.line(p.outletName)
  b.line(divider(width))

  b.align('left')
  b.bold(true).line(`No: ${p.orderNumber}`).bold(false)
  if (p.tableOrQueue) b.line(p.tableOrQueue)
  if (p.customerName) b.line(`Pelanggan: ${p.customerName}`)
  b.line(`Waktu: ${p.orderedAtLabel}`)
  b.line(`Oleh: ${p.cashierName}${p.source ? ` (${p.source})` : ''}`)
  b.line(divider(width))

  for (const line of p.lines) {
    b.bold(true).doubleHeight(true).line(`${line.qty}x ${line.name}`).doubleHeight(false).bold(false)
    for (const m of line.modifiers) b.line(`  - ${m}`)
    if (line.note) b.line(`  * ${line.note}`)
  }
  b.line(divider(width))
  b.feed(3).cut()
  return b.toBytes()
}
