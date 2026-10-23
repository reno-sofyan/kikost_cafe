/**
 * Template cetak kafe — struk pelanggan & tiket dapur (KOT) untuk printer thermal
 * 58mm (32 kolom) dan 80mm (48 kolom). Keduanya menerima objek `PrintOrder` yang
 * sama dan menghasilkan `PrintDoc` (baris + gaya), yang bisa diubah jadi teks
 * polos (`printDocToText`, fallback) atau byte ESC/POS (`printDocToEscPos`).
 */

export type PaperWidth = 58 | 80
export type OrderChannel = 'dine_in' | 'takeaway' | 'gofood' | 'grabfood' | 'shopeefood'
export type KotStation = 'kitchen' | 'bar' | 'dessert'
export type PrintItemStatus = 'baru' | 'tambahan' | 'batal'

export interface PrintOrderItem {
  name: string
  variant?: string | null
  qty: number
  /** Harga satuan (sudah termasuk varian), belum termasuk modifier. */
  price: number
  modifiers?: { name: string; price?: number }[]
  note?: string | null
  station: KotStation
  status: PrintItemStatus
  /** Waktu item dikirim ke dapur/bar (epoch ms) — jam pada tanda TAMBAHAN. */
  sentAt?: number | null
  cancelReason?: string | null
}

export interface PrintPayment {
  /** Label metode, mis. "Tunai", "QRIS", "Transfer". */
  method: string
  /** Bagian total yang dibayar dengan metode ini. */
  amount: number
  /** Uang yang diserahkan pelanggan (tunai). Kosong = sama dengan `amount`. */
  paid?: number | null
  change?: number | null
}

export interface PrintOutlet {
  name: string
  address?: string | null
  phone?: string | null
  /** NPWP apa adanya, mis. "01.234.567.8-901.000". */
  npwp?: string | null
  /** Tanpa "@". */
  instagram?: string | null
  /** Isi QR di kaki struk (mis. tautan menu/ulasan). */
  qrUrl?: string | null
  thanks?: string | null
}

export interface PrintOrder {
  outlet: PrintOutlet
  orderId: string
  tableNumber?: string | null
  queueNumber?: string | number | null
  channel: OrderChannel
  /** Nomor pesanan di aplikasi online, mis. "F-123". */
  channelRef?: string | null
  cashierName: string
  customerName?: string | null
  orderedAt: number
  /** Kosong = belum dibayar → struk dicetak sebagai BILL / PRE-BILL. */
  paidAt?: number | null
  items: PrintOrderItem[]
  discount?: { label?: string; amount: number } | null
  serviceCharge?: { percent: number; amount: number } | null
  /** Pajak restoran; label bawaan "PB1". */
  tax?: { label?: string; percent: number; amount: number } | null
  /** Selisih pembulatan (+/-). */
  rounding?: number
  total: number
  payments?: PrintPayment[]
  loyalty?: { earned?: number; redeemed?: number; balance?: number } | null
  void?: { ref: string; reason?: string | null; at?: number } | null
  refund?: { ref: string; amount: number; reason?: string | null; at?: number } | null
}

// ---- Dokumen cetak ----

/** `tall` = 2× tinggi, `wide` = 2× lebar, `big` = 2× lebar & tinggi. */
export type SpanSize = 'normal' | 'tall' | 'wide' | 'big'

export interface PrintSpan {
  text: string
  bold?: boolean
  size?: SpanSize
}

export type PrintBlock =
  | { kind: 'line'; spans: PrintSpan[]; align?: 'left' | 'center' | 'right'; invert?: boolean }
  | { kind: 'qr'; data: string }
  | { kind: 'cut' }

export interface PrintDoc {
  paperWidth: PaperWidth
  columns: number
  blocks: PrintBlock[]
}

const COLUMNS: Record<PaperWidth, number> = { 58: 32, 80: 48 }
const WIDE: SpanSize[] = ['wide', 'big']
const factor = (size: SpanSize = 'normal') => (WIDE.includes(size) ? 2 : 1)

const CHANNEL_LABELS: Record<OrderChannel, string> = {
  dine_in: 'Dine-in',
  takeaway: 'Take Away',
  gofood: 'GoFood',
  grabfood: 'GrabFood',
  shopeefood: 'ShopeeFood',
}
const ONLINE_CHANNELS: OrderChannel[] = ['gofood', 'grabfood', 'shopeefood']
const STATION_ORDER: KotStation[] = ['kitchen', 'bar', 'dessert']
const STATION_LABELS: Record<KotStation, string> = { kitchen: 'DAPUR', bar: 'BAR', dessert: 'DESSERT' }

// ---- Format ----

/** "Rp 25.000" / "-Rp 5.000". */
export function rp(amount: number): string {
  const n = Math.round(amount)
  const digits = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${n < 0 ? '-' : ''}Rp ${digits}`
}

/** WIB (UTC+7, tanpa DST) — hasil sama di perangkat dengan zona waktu apa pun. */
function wib(ms: number): Date {
  return new Date(ms + 7 * 3600_000)
}
const pad2 = (n: number) => String(n).padStart(2, '0')
export function formatDateWib(ms: number): string {
  const d = wib(ms)
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}
export function formatTimeWib(ms: number): string {
  const d = wib(ms)
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
}

function channelText(order: PrintOrder): string {
  return CHANNEL_LABELS[order.channel] + (order.channelRef ? ` #${order.channelRef}` : '')
}

function unitPrice(item: PrintOrderItem): number {
  return item.price + (item.modifiers ?? []).reduce((s, m) => s + (m.price ?? 0), 0)
}

// ---- Penyusun baris ----

/** Pecah teks per kata agar muat `cols` kolom; kata yang terlalu panjang dipotong paksa. */
function wrap(text: string, cols: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word
    while (w.length > cols) {
      if (line) {
        out.push(line)
        line = ''
      }
      out.push(w.slice(0, cols))
      w = w.slice(cols)
    }
    if (!line) line = w
    else if (line.length + 1 + w.length <= cols) line += ` ${w}`
    else {
      out.push(line)
      line = w
    }
  }
  if (line || out.length === 0) out.push(line)
  return out
}

class DocBuilder {
  readonly blocks: PrintBlock[] = []
  constructor(readonly columns: number) {}

  /** Teks (dibungkus otomatis) dengan satu gaya. `indent` = spasi awal baris lanjutan juga. */
  text(value: string, opts: { bold?: boolean; size?: SpanSize; align?: 'left' | 'center' | 'right'; invert?: boolean; indent?: number } = {}): this {
    const f = factor(opts.size)
    const indent = opts.indent ?? 0
    for (const part of wrap(value, Math.floor((this.columns - indent * f) / f))) {
      this.blocks.push({
        kind: 'line',
        spans: [{ text: ' '.repeat(indent) + part, bold: opts.bold, size: opts.size }],
        align: opts.align,
        invert: opts.invert,
      })
    }
    return this
  }

  /** Kiri–kanan dalam satu baris; bila tak muat, teks kiri dibungkus dan nilai di baris terakhir. */
  pair(left: string, right: string, opts: { bold?: boolean; size?: 'normal' | 'tall' } = {}): this {
    const indent = left.match(/^ */)![0]
    const leftLines = wrap(left, Math.max(8, this.columns - right.length - 1 - indent.length)).map((l) => indent + l)
    leftLines.forEach((l, i) => {
      const last = i === leftLines.length - 1
      const text = last ? l + ' '.repeat(Math.max(1, this.columns - l.length - right.length)) + right : l
      this.blocks.push({ kind: 'line', spans: [{ text, bold: opts.bold, size: opts.size }] })
    })
    return this
  }

  /** "Label    : nilai" dengan label rata kiri selebar `labelWidth`. */
  field(label: string, value: string, labelWidth = 9): this {
    const prefix = `${label.padEnd(labelWidth)}: `
    wrap(value, this.columns - prefix.length).forEach((v, i) => {
      this.blocks.push({ kind: 'line', spans: [{ text: (i === 0 ? prefix : ' '.repeat(prefix.length)) + v }] })
    })
    return this
  }

  divider(char = '-'): this {
    this.blocks.push({ kind: 'line', spans: [{ text: char.repeat(this.columns) }] })
    return this
  }

  blank(): this {
    this.blocks.push({ kind: 'line', spans: [{ text: '' }] })
    return this
  }

  /** Item KOT: qty 2× lebar & tinggi (paling menonjol), nama 2× tinggi tebal. */
  kotItem(qty: number, name: string): this {
    const qtyText = `${qty}x `
    const qtyCols = qtyText.length * 2
    wrap(name, this.columns - qtyCols).forEach((part, i) => {
      this.blocks.push({
        kind: 'line',
        spans:
          i === 0
            ? [{ text: qtyText, bold: true, size: 'big' }, { text: part, bold: true, size: 'tall' }]
            : [{ text: ' '.repeat(qtyCols) + part, bold: true, size: 'tall' }],
      })
    })
    return this
  }

  qr(data: string): this {
    this.blocks.push({ kind: 'qr', data })
    return this
  }

  cut(): this {
    this.blocks.push({ kind: 'cut' })
    return this
  }
}

// ---- Template 1: struk pelanggan ----

export function renderReceipt(order: PrintOrder, paperWidth: PaperWidth): PrintDoc {
  const columns = COLUMNS[paperWidth]
  const b = new DocBuilder(columns)
  const { outlet } = order
  const isPaid = order.paidAt != null
  const isVoid = !!order.void
  const isRefund = !!order.refund

  // Header
  b.text(outlet.name.toUpperCase(), { bold: true, size: 'big', align: 'center' })
  if (outlet.address) b.text(outlet.address, { align: 'center' })
  if (outlet.phone) b.text(`Telp ${outlet.phone}`, { align: 'center' })
  if (outlet.npwp) b.text(`NPWP ${outlet.npwp}`, { align: 'center' })
  b.divider('=')

  // Tanda status
  if (isVoid) {
    b.text('*** VOID ***', { bold: true, size: 'big', align: 'center', invert: true })
    b.text('Transaksi dibatalkan', { align: 'center' })
    b.field('Ref', order.void!.ref)
    if (order.void!.at != null) b.field('Waktu', `${formatDateWib(order.void!.at)} ${formatTimeWib(order.void!.at)}`)
    if (order.void!.reason) b.field('Alasan', order.void!.reason)
    b.divider()
  } else if (isRefund) {
    b.text('*** REFUND ***', { bold: true, size: 'big', align: 'center', invert: true })
    b.field('Ref', order.refund!.ref)
    if (order.refund!.at != null) b.field('Waktu', `${formatDateWib(order.refund!.at)} ${formatTimeWib(order.refund!.at)}`)
    if (order.refund!.reason) b.field('Alasan', order.refund!.reason)
    b.divider()
  } else if (!isPaid) {
    b.text('BILL / PRE-BILL', { bold: true, size: paperWidth === 58 ? 'tall' : 'big', align: 'center' })
    b.text('Belum dibayar', { align: 'center' })
    b.divider()
  }

  // Info transaksi
  const at = order.paidAt ?? order.orderedAt
  b.field('No', order.orderId)
  b.field('Tanggal', formatDateWib(at))
  b.field('Jam', formatTimeWib(at))
  b.field('Kasir', order.cashierName)
  if (order.tableNumber) b.field('Meja', String(order.tableNumber))
  if (order.queueNumber != null && order.queueNumber !== '') b.field('Antrian', String(order.queueNumber))
  b.field('Channel', channelText(order))
  if (order.customerName) b.field('Pelanggan', order.customerName)
  b.divider()

  // Item (item batal tidak ditagihkan)
  const items = order.items.filter((i) => i.status !== 'batal')
  for (const item of items) {
    const unit = unitPrice(item)
    b.text(item.variant ? `${item.name} (${item.variant})` : item.name)
    b.pair(`  ${item.qty} x ${rp(unit)}`, rp(unit * item.qty))
    for (const m of item.modifiers ?? []) b.text(`+ ${m.name}${m.price ? ` (${rp(m.price)})` : ''}`, { indent: 2 })
    if (item.note) b.text(`Catatan: ${item.note}`, { indent: 2 })
  }
  b.divider()

  // Rincian total
  const subtotal = items.reduce((s, i) => s + unitPrice(i) * i.qty, 0)
  b.pair('Subtotal', rp(subtotal))
  if (order.discount && order.discount.amount > 0) b.pair(order.discount.label || 'Diskon', rp(-order.discount.amount))
  if (order.serviceCharge && order.serviceCharge.amount > 0) b.pair(`Service ${order.serviceCharge.percent}%`, rp(order.serviceCharge.amount))
  if (order.tax && order.tax.amount > 0) b.pair(`${order.tax.label || 'PB1'} ${order.tax.percent}%`, rp(order.tax.amount))
  if (order.rounding) b.pair('Pembulatan', rp(order.rounding))
  b.pair('TOTAL', rp(order.total), { bold: true, size: 'tall' })
  if (isRefund) b.pair('REFUND', rp(-order.refund!.amount), { bold: true })

  // Pembayaran
  if (isPaid && order.payments?.length) {
    b.divider()
    for (const p of order.payments) {
      b.pair(p.method, rp(p.paid ?? p.amount))
      if (p.change && p.change > 0) b.pair('Kembalian', rp(p.change))
    }
  }

  // Poin loyalty
  const loyalty = order.loyalty
  if (loyalty && (loyalty.earned || loyalty.redeemed)) {
    b.divider()
    if (loyalty.redeemed) b.pair('Poin terpakai', `-${loyalty.redeemed}`)
    if (loyalty.earned && isPaid && !isVoid) b.pair('Poin didapat', `+${loyalty.earned}`)
    if (loyalty.balance != null) b.pair('Sisa poin', String(loyalty.balance))
  }

  b.divider('=')
  if (isPaid && !isVoid && !isRefund) b.text('LUNAS', { bold: true, size: 'big', align: 'center' })
  if (!isPaid && !isVoid) b.text('Bukan bukti pembayaran', { align: 'center' })

  // Footer
  b.text(outlet.thanks || 'Terima kasih atas kunjungan Anda!', { align: 'center' })
  if (outlet.instagram) b.text(`IG @${outlet.instagram.replace(/^@/, '')}`, { align: 'center' })
  if (outlet.qrUrl) b.qr(outlet.qrUrl)
  b.cut()

  return { paperWidth, columns, blocks: b.blocks }
}

// ---- Template 2: tiket dapur (KOT) ----

export interface KotOptions {
  /** Tandai sebagai cetak ulang, dengan jam cetak ulang. */
  reprintAt?: number | null
}

/**
 * Satu tiket per stasiun (dapur, bar, dessert) yang punya item — dipisah potongan
 * kertas. Item `baru` lebih dulu, lalu `tambahan` per jam kirim, lalu `batal`.
 * Tanpa harga, total, maupun data pembayaran.
 */
export function renderKOT(order: PrintOrder, paperWidth: PaperWidth, opts: KotOptions = {}): PrintDoc {
  const columns = COLUMNS[paperWidth]
  const b = new DocBuilder(columns)
  const online = ONLINE_CHANNELS.includes(order.channel)

  for (const station of STATION_ORDER) {
    const items = order.items.filter((i) => i.station === station)
    if (items.length === 0) continue
    const fresh = items.filter((i) => i.status === 'baru')
    const added = items.filter((i) => i.status === 'tambahan')
    const cancelled = items.filter((i) => i.status === 'batal')
    const sentTimes = items.map((i) => i.sentAt).filter((t): t is number => t != null)
    const sentAt = sentTimes.length ? Math.max(...sentTimes) : order.orderedAt

    b.divider('=')
    b.text(STATION_LABELS[station], { bold: true, size: 'big', align: 'center' })
    if (opts.reprintAt != null) b.text(`CETAK ULANG ${formatTimeWib(opts.reprintAt)}`, { bold: true, align: 'center', invert: true })
    b.divider('=')

    b.text(order.orderId, { bold: true, size: order.orderId.length * 2 <= columns ? 'big' : 'tall' })
    const where = [order.tableNumber ? `MEJA ${order.tableNumber}` : '', order.queueNumber != null && order.queueNumber !== '' ? `ANTRIAN ${order.queueNumber}` : ''].filter(Boolean)
    // Satu baris bila muat dalam huruf besar; kalau tidak, meja & antrean di baris masing-masing.
    if (where.join(' / ').length * 2 <= columns) b.text(where.join(' / '), { bold: true, size: 'big' })
    else for (const w of where) b.text(w, { bold: true, size: 'big' })
    if (online) b.text(`ONLINE: ${channelText(order).toUpperCase()}`, { bold: true, size: 'tall', align: 'center', invert: true })
    else b.text(channelText(order).toUpperCase(), { bold: true })
    if (order.customerName) b.text(`Pelanggan: ${order.customerName}`)
    b.text(`Kirim ${formatTimeWib(sentAt)} | Pesan ${formatTimeWib(order.orderedAt)}`)
    b.text(`Kasir ${order.cashierName}`)
    b.divider()

    const itemLines = (item: PrintOrderItem) => {
      b.kotItem(item.qty, item.name)
      if (item.variant) b.text(`> ${item.variant}`, { bold: true, indent: 4 })
      for (const m of item.modifiers ?? []) b.text(`> ${m.name}`, { bold: true, indent: 4 })
      if (item.note) b.text(`!! ${item.note}`, { bold: true, indent: 4 })
    }

    for (const item of fresh) itemLines(item)

    // Tambahan dikelompokkan per jam kirim.
    const byTime = new Map<number, PrintOrderItem[]>()
    for (const item of added) {
      const t = item.sentAt ?? sentAt
      byTime.set(t, [...(byTime.get(t) ?? []), item])
    }
    for (const [t, group] of [...byTime.entries()].sort((x, y) => x[0] - y[0])) {
      if (fresh.length > 0 || t !== [...byTime.keys()][0]) b.divider()
      b.text(`TAMBAHAN ${formatTimeWib(t)}`, { bold: true, size: 'tall', invert: true })
      for (const item of group) itemLines(item)
    }

    if (cancelled.length > 0) {
      if (fresh.length + added.length > 0) b.divider()
      b.text('BATAL', { bold: true, size: 'big', invert: true })
      for (const item of cancelled) {
        b.kotItem(item.qty, `BATAL ${item.name}`)
        if (item.variant) b.text(`> ${item.variant}`, { bold: true, indent: 4 })
        if (item.cancelReason) b.text(`Alasan: ${item.cancelReason}`, { indent: 4 })
      }
    }

    b.divider()
    const totalQty = [...fresh, ...added].reduce((s, i) => s + i.qty, 0)
    b.text(`${totalQty} item dibuat${cancelled.length ? ` | ${cancelled.reduce((s, i) => s + i.qty, 0)} batal` : ''}`)
    b.cut()
  }

  return { paperWidth, columns, blocks: b.blocks }
}

// ---- Keluaran ----

/** Teks polos — fallback untuk printer tanpa dukungan gaya/QR, juga untuk pratinjau. */
export function printDocToText(doc: PrintDoc): string {
  const out: string[] = []
  for (const block of doc.blocks) {
    if (block.kind === 'cut') {
      out.push('- - - - - - - - (potong) - - - - - - - -'.slice(0, doc.columns))
      continue
    }
    if (block.kind === 'qr') {
      out.push(...wrap(`[QR] ${block.data}`, doc.columns).map((l) => centerText(l, doc.columns)))
      continue
    }
    // Di teks polos huruf besar tetap selebar satu kolom — rata tengah memakai panjang aslinya.
    const text = block.spans.map((s) => s.text).join('')
    if (block.align === 'center') out.push(centerText(text, doc.columns))
    else if (block.align === 'right') out.push(' '.repeat(Math.max(0, doc.columns - text.length)) + text)
    else out.push(text)
  }
  return out.map((l) => l.replace(/\s+$/, '')).join('\n')
}

function centerText(text: string, columns: number): string {
  return ' '.repeat(Math.max(0, Math.floor((columns - text.length) / 2))) + text
}

const ESC = 0x1b
const GS = 0x1d
const SIZE_BYTE: Record<SpanSize, number> = { normal: 0x00, tall: 0x01, wide: 0x10, big: 0x11 }

/** Printer thermal umumnya memakai codepage PC437 — huruf beraksen diturunkan ke ASCII. */
function toAscii(text: string): number[] {
  const ascii = text.normalize('NFD').replace(/[̀-ͯ]/g, '')
  return Array.from(ascii, (ch) => {
    const code = ch.charCodeAt(0)
    return code >= 0x20 && code < 0x7f ? code : 0x3f // '?'
  })
}

/**
 * Byte ESC/POS. `supportsQr: false` (printer lama tanpa perintah QR) → isi QR
 * dicetak sebagai teks.
 */
export function printDocToEscPos(doc: PrintDoc, opts: { supportsQr?: boolean } = {}): Uint8Array {
  const out: number[] = [ESC, 0x40]
  const supportsQr = opts.supportsQr ?? true
  for (const block of doc.blocks) {
    if (block.kind === 'cut') {
      out.push(ESC, 0x64, 3, GS, 0x56, 0x00)
      continue
    }
    if (block.kind === 'qr') {
      out.push(ESC, 0x61, 1)
      if (supportsQr) {
        const data = toAscii(block.data)
        const len = data.length + 3
        out.push(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00) // model 2
        out.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, doc.paperWidth === 58 ? 5 : 7) // ukuran modul
        out.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31) // koreksi galat M
        out.push(GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...data)
        out.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30) // cetak
        out.push(0x0a)
      } else {
        for (const l of wrap(block.data, doc.columns)) out.push(...toAscii(l), 0x0a)
      }
      out.push(ESC, 0x61, 0)
      continue
    }
    out.push(ESC, 0x61, block.align === 'center' ? 1 : block.align === 'right' ? 2 : 0)
    if (block.invert) out.push(GS, 0x42, 1)
    for (const span of block.spans) {
      out.push(GS, 0x21, SIZE_BYTE[span.size ?? 'normal'], ESC, 0x45, span.bold ? 1 : 0, ...toAscii(span.text))
    }
    out.push(GS, 0x21, 0, ESC, 0x45, 0)
    if (block.invert) out.push(GS, 0x42, 0)
    out.push(0x0a)
  }
  const last = doc.blocks[doc.blocks.length - 1]
  if (!last || last.kind !== 'cut') out.push(ESC, 0x64, 3, GS, 0x56, 0x00)
  return new Uint8Array(out)
}
