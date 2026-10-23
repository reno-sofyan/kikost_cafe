import { describe, expect, it } from 'vitest'
import { printDocToEscPos, printDocToText, renderKOT, renderReceipt, rp, type PrintDoc, type PrintOrder } from './cafeTemplates'

// 23/10/2026 13:58 WIB = 06:58 UTC
const T = (hh: number, mm: number) => Date.UTC(2026, 9, 23, hh - 7, mm)

const SAMPLE_ORDER: PrintOrder = {
  outlet: {
    name: 'Kinara Cafe',
    address: 'Jl. Raya Dramaga No. 12, Bogor',
    phone: '0812-3456-7890',
    npwp: '01.234.567.8-901.000',
    instagram: 'kikostipb',
    qrUrl: 'https://kikost.com/ulasan',
  },
  orderId: 'TRX-00128',
  tableNumber: '5',
  queueNumber: 12,
  channel: 'dine_in',
  cashierName: 'Rina',
  orderedAt: T(13, 58),
  paidAt: T(14, 31),
  items: [
    { name: 'Es Kopi Susu Gula Aren', variant: 'Large', qty: 2, price: 27000, modifiers: [{ name: 'Extra Shot', price: 8000 }, { name: 'Less Sugar' }], note: 'es dipisah', station: 'bar', status: 'baru', sentAt: T(14, 0) },
    { name: 'Nasi Goreng Kampung', qty: 1, price: 32000, modifiers: [{ name: 'Telur Ceplok', price: 5000 }], note: 'tidak pedas', station: 'kitchen', status: 'baru', sentAt: T(14, 0) },
    { name: 'Croffle Cokelat', qty: 1, price: 25000, station: 'dessert', status: 'baru', sentAt: T(14, 0) },
    { name: 'Americano', variant: 'Hot', qty: 1, price: 20000, station: 'bar', status: 'tambahan', sentAt: T(14, 20) },
    { name: 'Lemon Tea', qty: 1, price: 15000, station: 'bar', status: 'batal', sentAt: T(14, 0), cancelReason: 'tamu ganti pesanan' },
  ],
  discount: { label: 'Diskon Member 10%', amount: 15200 },
  serviceCharge: { percent: 5, amount: 6840 },
  tax: { label: 'PB1', percent: 10, amount: 14364 },
  rounding: -4,
  total: 158000,
  payments: [{ method: 'Tunai', amount: 158000, paid: 200000, change: 42000 }],
  loyalty: { earned: 15, redeemed: 20, balance: 137 },
}

const text = (doc: PrintDoc) => printDocToText(doc)
const lines = (doc: PrintDoc) => text(doc).split('\n')

describe('format', () => {
  it('rupiah memakai spasi & titik ribuan', () => {
    expect(rp(25000)).toBe('Rp 25.000')
    expect(rp(-5000)).toBe('-Rp 5.000')
    expect(rp(1234567)).toBe('Rp 1.234.567')
  })
})

describe('renderReceipt', () => {
  for (const width of [58, 80] as const) {
    it(`${width}mm: tak ada baris melebihi lebar kertas`, () => {
      const cols = width === 58 ? 32 : 48
      for (const l of lines(renderReceipt(SAMPLE_ORDER, width))) expect(l.length).toBeLessThanOrEqual(cols)
    })
  }

  it('memuat header, info transaksi, item, total, pembayaran, poin, footer', () => {
    const t = text(renderReceipt(SAMPLE_ORDER, 80))
    for (const s of ['KINARA CAFE', 'NPWP 01.234.567.8-901.000', 'TRX-00128', '23/10/2026', '14:31', 'Rina', 'Meja', 'Antrian', 'Dine-in']) expect(t).toContain(s)
    expect(t).toMatch(/\n {2}2 x Rp 35\.000\s+Rp 70\.000\n/)
    expect(t).toContain('Rp 70.000')
    expect(t).toContain('+ Extra Shot (Rp 8.000)')
    expect(t).toMatch(/PB1 10%\s+Rp 14\.364/)
    expect(t).toMatch(/Kembalian\s+Rp 42\.000/)
    expect(t).toMatch(/Poin didapat\s+\+15/)
    expect(t).toContain('LUNAS')
    expect(t).toContain('IG @kikostipb')
    expect(t).not.toContain('Lemon Tea') // item batal tidak ditagihkan
  })

  it('subtotal dihitung dari item yang tidak batal', () => {
    // 2×35.000 + 1×37.000 + 25.000 + 20.000
    expect(text(renderReceipt(SAMPLE_ORDER, 58))).toMatch(/Subtotal\s+Rp 152\.000/)
  })

  it('belum dibayar: BILL / PRE-BILL tanpa LUNAS & tanpa pembayaran', () => {
    const t = text(renderReceipt({ ...SAMPLE_ORDER, paidAt: null }, 58))
    expect(t).toContain('BILL / PRE-BILL')
    expect(t).not.toContain('LUNAS')
    expect(t).not.toContain('Kembalian')
    expect(t).not.toContain('Poin didapat')
  })

  it('void & refund: tanda jelas + nomor referensi, tanpa LUNAS', () => {
    const v = text(renderReceipt({ ...SAMPLE_ORDER, void: { ref: 'VD-20261023-0007', reason: 'salah input' } }, 58))
    expect(v).toContain('*** VOID ***')
    expect(v).toContain('VD-20261023-0007')
    expect(v).not.toContain('LUNAS')
    const r = text(renderReceipt({ ...SAMPLE_ORDER, refund: { ref: 'RF-20261023-0003', amount: 35000 } }, 58))
    expect(r).toContain('*** REFUND ***')
    expect(r).toContain('RF-20261023-0003')
    expect(r).toMatch(/REFUND\s+-Rp 35\.000/)
  })
})

describe('renderKOT', () => {
  for (const width of [58, 80] as const) {
    it(`${width}mm: muat di kertas (huruf 2× lebar dihitung dua kolom)`, () => {
      const cols = width === 58 ? 32 : 48
      for (const block of renderKOT(SAMPLE_ORDER, width).blocks) {
        if (block.kind !== 'line') continue
        const visual = block.spans.reduce((n, s) => n + s.text.length * (s.size === 'big' || s.size === 'wide' ? 2 : 1), 0)
        expect(visual).toBeLessThanOrEqual(cols)
      }
    })
  }

  it('satu tiket per stasiun, urutan dapur → bar → dessert, dipisah potongan', () => {
    const doc = renderKOT(SAMPLE_ORDER, 58)
    const t = text(doc)
    expect(doc.blocks.filter((b) => b.kind === 'cut')).toHaveLength(3)
    expect(t.indexOf('DAPUR')).toBeLessThan(t.indexOf('BAR'))
    expect(t.indexOf('BAR')).toBeLessThan(t.indexOf('DESSERT'))
  })

  it('tanpa harga/total/pembayaran; qty paling menonjol; modifier & catatan tebal', () => {
    const doc = renderKOT(SAMPLE_ORDER, 80)
    expect(text(doc)).not.toMatch(/Rp|TOTAL|Tunai|Kembalian/)
    const qtySpan = doc.blocks.flatMap((b) => (b.kind === 'line' ? b.spans : [])).find((s) => s.text === '2x ')
    expect(qtySpan).toMatchObject({ bold: true, size: 'big' })
    const note = doc.blocks.find((b) => b.kind === 'line' && b.spans.some((s) => s.text.includes('!! es dipisah')))
    expect(note && note.kind === 'line' && note.spans[0].bold).toBe(true)
  })

  it('TAMBAHAN dengan jam, BATAL dengan alasan, jam kirim di kepala tiket', () => {
    const t = text(renderKOT(SAMPLE_ORDER, 58))
    expect(t).toContain('TAMBAHAN 14:20')
    expect(t).toContain('BATAL Lemon Tea')
    expect(t).toContain('Alasan: tamu ganti pesanan')
    expect(t).toContain('Kirim 14:20 | Pesan 13:58')
    // 58mm: "MEJA 5 / ANTRIAN 12" tak muat dalam huruf besar → dua baris utuh.
    expect(t).toContain('MEJA 5\nANTRIAN 12')
  })

  it('pesanan online ditandai mencolok', () => {
    const doc = renderKOT({ ...SAMPLE_ORDER, channel: 'gofood', channelRef: 'F-8812', tableNumber: null }, 58)
    const online = doc.blocks.find((b) => b.kind === 'line' && b.spans[0].text.includes('ONLINE: GOFOOD #F-8812'))
    expect(online).toMatchObject({ invert: true })
  })

  it('cetak ulang ditandai', () => {
    expect(text(renderKOT(SAMPLE_ORDER, 58, { reprintAt: T(15, 2) }))).toContain('CETAK ULANG 15:02')
  })
})

describe('printDocToEscPos', () => {
  it('ESC @ di awal, potong kertas, QR native atau fallback teks', () => {
    const doc = renderReceipt(SAMPLE_ORDER, 58)
    const withQr = printDocToEscPos(doc)
    expect([withQr[0], withQr[1]]).toEqual([0x1b, 0x40])
    expect(Array.from(withQr.slice(-3))).toEqual([0x1d, 0x56, 0x00])
    const decoded = new TextDecoder().decode(printDocToEscPos(doc, { supportsQr: false }))
    expect(decoded).toContain('https://kikost.com/ulasan')
    // Perintah simpan data QR (GS ( k … 31 50 30) hanya ada bila printer mendukung QR.
    const hasQrCmd = (b: Uint8Array) => b.some((v, i) => v === 0x1d && b[i + 1] === 0x28 && b[i + 2] === 0x6b && b[i + 5] === 0x31 && b[i + 6] === 0x50)
    expect(hasQrCmd(withQr)).toBe(true)
    expect(hasQrCmd(printDocToEscPos(doc, { supportsQr: false }))).toBe(false)
  })

  it('hanya byte ASCII untuk teks (aman di codepage printer)', () => {
    const bytes = printDocToEscPos(renderKOT({ ...SAMPLE_ORDER, items: [{ name: 'Café Latté', qty: 1, price: 0, station: 'bar', status: 'baru' }] }, 58))
    expect(bytes.every((v) => v < 0x80)).toBe(true)
    expect(new TextDecoder().decode(bytes)).toContain('Cafe Latte')
  })
})
