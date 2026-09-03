import { formatRupiah } from '@/lib/currency'
import type { ReceiptData } from '@/features/printing/receiptData'

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

export function buildEscPosReceipt(data: ReceiptData): Uint8Array {
  const width = CHARS_PER_LINE[data.paperSize]
  const b = new EscPosBuilder().init()

  b.align('center')
  if (data.isVoided) {
    b.bold(true).line('** TRANSAKSI DIBATALKAN **').bold(false)
  }
  b.doubleHeight(true).bold(true).line(data.cafeName).bold(false).doubleHeight(false)
  if (data.address) b.line(data.address)
  if (data.phone) b.line(data.phone)
  b.line(divider(width))

  b.align('left')
  b.line(`No: ${data.orderNumber}`)
  b.line(`Kasir: ${data.cashierName}`)
  b.line(`Waktu: ${data.createdAtLabel}`)
  b.line(`Tipe: ${data.orderTypeLabel}${data.tableLabel ? ` (${data.tableLabel})` : ''}`)
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
  if (data.discountAmount > 0) b.line(twoColumns('Diskon', `-${formatRupiah(data.discountAmount)}`, width))
  if (data.serviceChargeAmount > 0) {
    b.line(twoColumns(`Service (${data.serviceChargePercent}%)`, formatRupiah(data.serviceChargeAmount), width))
  }
  if (data.taxAmount > 0) b.line(twoColumns(`Pajak (${data.taxPercent}%)`, formatRupiah(data.taxAmount), width))
  if (data.roundingAdjustment !== 0) b.line(twoColumns('Pembulatan', formatRupiah(data.roundingAdjustment), width))
  b.bold(true).line(twoColumns('TOTAL', formatRupiah(data.grandTotal), width)).bold(false)
  b.line(divider(width))

  for (const payment of data.payments) {
    b.line(twoColumns(payment.methodLabel, formatRupiah(payment.amount), width))
    if (payment.receivedAmount != null) b.line(twoColumns('Bayar', formatRupiah(payment.receivedAmount), width))
    if (payment.changeAmount != null && payment.changeAmount > 0) {
      b.line(twoColumns('Kembali', formatRupiah(payment.changeAmount), width))
    }
  }
  b.line(divider(width))

  b.align('center')
  if (data.footerNote) b.line(data.footerNote)
  b.feed(3).cut()

  return b.toBytes()
}
