import { describe, expect, it } from 'vitest'
import { barcodeVariants, cleanRetailPricing, ean13CheckDigit, sameBarcode, isValidEan13, parseQtyMultiplier, parseScaleBarcode, samePlu, scaleQty, tierUnitPrice } from '@/lib/retailPricing'
import { barRuns, CODE128_PATTERNS, encodeBarcode, encodeCode128, encodeEan13 } from '@/lib/barcodeEncode'
import { abcClassify, addDaysToKey, purchaseBalance, stockCoverDays, supplierDebts, weightedAverageCost } from '@/lib/retailAnalysis'
import { promoDiscountFor } from '@/lib/promos'
import type { Promo, Purchase, ScaleBarcodeConfig } from '@/types/domain'

describe('pengali qty kasir', () => {
  it('12* lalu kode', () => {
    expect(parseQtyMultiplier('12*8991234567')).toEqual({ qty: 12, code: '8991234567' })
    expect(parseQtyMultiplier('3x indomie')).toEqual({ qty: 3, code: 'indomie' })
    expect(parseQtyMultiplier('12*')).toEqual({ qty: 12, code: '' })
  })
  it('tanpa bintang = qty 1, angka biasa tetap kode', () => {
    expect(parseQtyMultiplier('8991234567')).toEqual({ qty: 1, code: '8991234567' })
    expect(parseQtyMultiplier('0*abc').qty).toBe(1)
  })
})

describe('harga grosir', () => {
  const p = { price: 3500, tierPrices: [{ minQty: 24, price: 3000 }, { minQty: 12, price: 3200 }] }
  it('tingkat tertinggi yang tercapai', () => {
    expect(tierUnitPrice(p, 11)).toBe(3500)
    expect(tierUnitPrice(p, 12)).toBe(3200)
    expect(tierUnitPrice(p, 30)).toBe(3000)
  })
  it('validasi isian form', () => {
    expect(() => cleanRetailPricing([], [{ minQty: 12, price: 4000 }], 3500)).toThrow(/lebih murah/)
    expect(() => cleanRetailPricing([{ id: 'u', name: 'Dus', qty: 1, price: 100 }], [], 3500)).toThrow(/Satuan jual/)
    expect(cleanRetailPricing([{ id: 'u', name: ' Dus ', qty: 40, price: 120000 }], [{ minQty: 0, price: 0 }], 3500)).toEqual({
      sellUnits: [{ id: 'u', name: 'Dus', qty: 40, price: 120000 }],
      tierPrices: [],
    })
  })
})

describe('EAN-13 & barcode timbangan', () => {
  it('digit cek', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1)
    expect(ean13CheckDigit('899100100011')).toBe(Number(String(10 - ((8 + 9 * 3 + 9 + 1 * 3 + 0 + 0 + 1 + 0 + 0 + 0 + 1 + 1 * 3) % 10)).slice(-1)))
    expect(isValidEan13('4006381333931')).toBe(true)
    expect(isValidEan13('4006381333932')).toBe(false)
  })
  const config: ScaleBarcodeConfig = { enabled: true, prefix: '2', flagLength: 2, pluLength: 5, valueKind: 'weight' }
  const code = (first12: string) => first12 + ean13CheckDigit(first12)
  it('PLU & berat dari barcode', () => {
    expect(parseScaleBarcode(code('200012300354'), config)).toEqual({ plu: '00123', value: 354 })
    expect(parseScaleBarcode(code('800012300354'), config)).toBeNull()
    expect(parseScaleBarcode('2000123003540', config)).toBeNull() // digit cek salah
    expect(parseScaleBarcode(code('200012300354'), { ...config, enabled: false })).toBeNull()
  })
  it('berat → kg, harga → qty', () => {
    expect(scaleQty({ price: 40000, unit: 'kg' }, { plu: '123', value: 354 }, config)).toBe(0.354)
    expect(scaleQty({ price: 40000, unit: 'kg' }, { plu: '123', value: 10000 }, { ...config, valueKind: 'price' })).toBe(0.25)
    expect(samePlu('123', '00123')).toBe(true)
    expect(samePlu(null, '00123')).toBe(false)
  })
})

describe('encoder barcode label', () => {
  it('EAN-13: 95 modul, guard di awal/tengah/akhir', () => {
    const m = encodeEan13('4006381333931')
    expect(m).toHaveLength(95)
    const bits = m.map((b) => (b ? '1' : '0')).join('')
    expect(bits.slice(0, 3)).toBe('101')
    expect(bits.slice(45, 50)).toBe('01010')
    expect(bits.slice(-3)).toBe('101')
    // Digit 4 (paritas LGLLGG) → digit ke-2 '0' di set L: 0001101
    expect(bits.slice(3, 10)).toBe('0001101')
    expect(encodeEan13('400638133393')).toEqual(m)
  })
  it('tabel Code 128 sahih: 11 modul, jumlah batang genap, unik', () => {
    expect(CODE128_PATTERNS).toHaveLength(107)
    const patterns = CODE128_PATTERNS.slice(0, 106)
    for (const p of patterns) {
      const widths = [...p].map(Number)
      expect(widths.reduce((s, w) => s + w, 0)).toBe(11)
      expect((widths[0]! + widths[2]! + widths[4]!) % 2).toBe(0)
    }
    expect(new Set(patterns).size).toBe(106)
    expect([...CODE128_PATTERNS[106]!].map(Number).reduce((s, w) => s + w, 0)).toBe(13)
  })
  it('Code 128-B: panjang = 11 × (start + n + cek) + stop', () => {
    expect(encodeCode128('MM-500')).toHaveLength(11 * (1 + 6 + 1) + 13)
    expect(encodeBarcode('MM-500').kind).toBe('code128')
    expect(encodeBarcode('4006381333931').kind).toBe('ean13')
    expect(() => encodeCode128('é')).toThrow()
  })
  it('barRuns menggabung modul hitam berurutan', () => {
    expect(barRuns([true, true, false, true, false, false, true])).toEqual([
      [0, 2],
      [3, 1],
      [6, 1],
    ])
  })
})

describe('HPP rata-rata tertimbang', () => {
  it('menimbang stok lama & barang masuk', () => {
    expect(weightedAverageCost(10, 4000, 30, 5000)).toBe(4750)
    expect(weightedAverageCost(0, 4000, 30, 5000)).toBe(5000)
    expect(weightedAverageCost(-3, 4000, 30, 5000)).toBe(5000)
    expect(weightedAverageCost(10, 0, 30, 5000)).toBe(5000)
    expect(weightedAverageCost(10, 4000, 30, 0)).toBe(4000)
  })
})

describe('analisis ABC & laku', () => {
  it('A ±80%, B 15%, C sisanya; produk tanpa omzet dibuang', () => {
    const rows = abcClassify([
      { id: 'a', revenue: 700 },
      { id: 'b', revenue: 150 },
      { id: 'c', revenue: 100 },
      { id: 'd', revenue: 50 },
      { id: 'e', revenue: 0 },
    ])
    expect(rows.map((r) => [r.id, r.abc])).toEqual([
      ['a', 'A'],
      ['b', 'A'],
      ['c', 'B'],
      ['d', 'C'],
    ])
  })
  it('hari stok cukup', () => {
    expect(stockCoverDays(30, 70, 7)).toBe(3)
    expect(stockCoverDays(30, 0, 7)).toBeNull()
  })
})

describe('hutang pemasok', () => {
  const base: Purchase = {
    id: 'x',
    supplierName: 'PT Sumber',
    supplierId: 's1',
    invoiceNo: '',
    lines: [],
    totalCost: 1_000_000,
    status: 'received',
    note: '',
    createdBy: 'u',
    receivedBy: 'u',
    receivedAt: 1,
    dueDate: '2026-11-01',
    createdAt: 1,
    updatedAt: 1,
  }
  it('sisa = total − pembayaran; tunai/draf/retur tanpa hutang', () => {
    expect(purchaseBalance({ ...base, payments: [{ id: 'p', amount: 400_000, method: 'cash', fromDrawer: false, note: '', byName: 'a', at: 1 }] })).toBe(600_000)
    expect(purchaseBalance({ ...base, dueDate: null })).toBe(0)
    expect(purchaseBalance({ ...base, status: 'draft' })).toBe(0)
    expect(purchaseBalance({ ...base, docType: 'return' })).toBe(0)
  })
  it('per pemasok: retur potong hutang & lewat jatuh tempo', () => {
    const debts = supplierDebts(
      [
        base,
        { ...base, id: 'y', totalCost: 500_000, dueDate: '2026-12-01' },
        { ...base, id: 'r', docType: 'return', returnSettlement: 'debt', totalCost: 200_000, dueDate: null },
        { ...base, id: 'r2', docType: 'return', returnSettlement: 'refund', totalCost: 999, dueDate: null },
      ],
      '2026-11-10',
    )
    expect(debts).toHaveLength(1)
    expect(debts[0]).toMatchObject({ billed: 1_500_000, returnCredit: 200_000, outstanding: 1_300_000, overdue: 1_000_000, nextDue: '2026-11-01' })
  })
  it('tanggal + hari', () => {
    expect(addDaysToKey('2026-11-20', 14)).toBe('2026-12-04')
  })
})

describe('promo harga paket', () => {
  const promo: Promo = { id: 'b', name: '2 item 10rb', active: true, kind: 'bundle', value: 10_000, buyQty: 2, scope: 'product', targetIds: ['p1', 'p2'] } as Promo
  const item = (productId: string, qty: number, unit: number) => ({ productId, categoryId: null, qty, lineTotal: qty * unit, voided: false, removed: false })
  it('tiap 2 unit dibayar 10.000, unit termahal dipaketkan dulu', () => {
    // 3×6.000 + 1×7.000: paket (7.000+6.000) & (6.000+6.000) → normal 25.000 − 20.000 = 5.000
    expect(promoDiscountFor(promo, [item('p1', 3, 6000), item('p2', 1, 7000)])).toBe(5000)
  })
  it('sisa ganjil tetap harga normal; harga paket ≥ normal = 0', () => {
    expect(promoDiscountFor(promo, [item('p1', 3, 6000)])).toBe(2000)
    expect(promoDiscountFor(promo, [item('p1', 2, 4000)])).toBe(0)
    expect(promoDiscountFor(promo, [item('p3', 4, 6000)])).toBe(0)
  })
})

describe('UPC-A 12 digit ≡ EAN-13 berawalan 0', () => {
  it('barcode Indofood dari pemindai (12 digit) cocok dengan data 13 digit', () => {
    expect(barcodeVariants('089686010015')).toEqual(['089686010015', '0089686010015'])
    expect(barcodeVariants('0089686010015')).toEqual(['0089686010015', '089686010015'])
    expect(sameBarcode('089686010015', '0089686010015')).toBe(true)
    expect(sameBarcode('089686010016', '0089686010015')).toBe(false)
    expect(barcodeVariants('8990000000109')).toEqual(['8990000000109'])
    expect(sameBarcode('MM-500', 'mm-500')).toBe(true)
  })
  it('label: UPC-A dicetak sebagai EAN-13 berawalan 0', () => {
    expect(encodeEan13('089686010015')).toEqual(encodeEan13('0089686010015'))
  })
})
