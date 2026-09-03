import { describe, expect, it } from 'vitest'
import { buildMenu, priceOrder, PublicOrderError, sanitizeNote, type Catalog } from '../src/lib/publicOrders.js'

function catalog(over: Partial<Catalog> = {}): Catalog {
  return {
    settings: { cafeName: 'Kikost', address: '', phone: '', taxPercent: 10, serviceChargePercent: 5, roundingIncrement: 100 },
    categories: [
      { id: 'c1', name: 'Kopi', sortOrder: 0, active: true },
      { id: 'c2', name: 'Nonaktif', sortOrder: 1, active: false },
    ],
    products: [
      { id: 'p1', categoryId: 'c1', name: 'Latte', price: 25000, photoDataUrl: null, isAvailable: true, modifierGroupIds: ['g1'] },
      { id: 'p2', categoryId: 'c1', name: 'Habis', price: 20000, photoDataUrl: null, isAvailable: false, modifierGroupIds: [] },
      { id: 'p3', categoryId: 'c2', name: 'Tersembunyi', price: 10000, photoDataUrl: null, isAvailable: true, modifierGroupIds: [] },
    ],
    modifierGroups: [{ id: 'g1', name: 'Ukuran', required: true, multiSelect: false, sortOrder: 0 }],
    modifierOptions: [
      { id: 'o1', groupId: 'g1', name: 'Reguler', priceDelta: 0, sortOrder: 0 },
      { id: 'o2', groupId: 'g1', name: 'Large', priceDelta: 5000, sortOrder: 1 },
    ],
    ...over,
  }
}

describe('sanitizeNote', () => {
  it('buang karakter kontrol, tag, dan potong panjang', () => {
    expect(sanitizeNote('  halo\n\tdunia  ')).toBe('halo dunia')
    expect(sanitizeNote('<script>xss</script>')).toBe('scriptxss/script')
    expect(sanitizeNote('a'.repeat(500)).length).toBe(180)
    expect(sanitizeNote(42)).toBe('')
  })
})

describe('priceOrder — total dihitung server', () => {
  it('hitung subtotal + SC + pajak + pembulatan dari katalog', () => {
    const q = priceOrder(catalog(), [{ productId: 'p1', qty: 2, modifierOptionIds: ['o2'], note: '' }])
    // (25000 + 5000) * 2 = 60000
    expect(q.subtotal).toBe(60000)
    expect(q.serviceChargeAmount).toBe(3000) // 5%
    expect(q.taxAmount).toBe(6300) // 10% of 63000
    expect(q.grandTotal).toBe(69300)
    expect(q.items[0].modifiers[0]).toMatchObject({ optionName: 'Large', priceDelta: 5000, groupName: 'Ukuran' })
  })

  it('tolak produk tak tersedia / kategori nonaktif', () => {
    expect(() => priceOrder(catalog(), [{ productId: 'p2', qty: 1, modifierOptionIds: [], note: '' }])).toThrow(PublicOrderError)
    expect(() => priceOrder(catalog(), [{ productId: 'p3', qty: 1, modifierOptionIds: [], note: '' }])).toThrow(/tidak tersedia/i)
  })

  it('tolak opsi modifier yang bukan milik produk', () => {
    expect(() =>
      priceOrder(catalog(), [{ productId: 'p1', qty: 1, modifierOptionIds: ['tidak-ada'], note: '' }]),
    ).toThrow(/varian tidak valid/i)
  })

  it('tolak qty & jumlah item di luar batas', () => {
    expect(() => priceOrder(catalog(), [{ productId: 'p1', qty: 0, modifierOptionIds: [], note: '' }])).toThrow(/jumlah/i)
    const many = Array.from({ length: 41 }, () => ({ productId: 'p1', qty: 1, modifierOptionIds: [], note: '' }))
    expect(() => priceOrder(catalog(), many)).toThrow(/Maksimal/i)
    expect(() => priceOrder(catalog(), [])).toThrow(/kosong/i)
  })

  it('harga pakai katalog server, bukan angka dari klien', () => {
    // klien tidak mengirim harga sama sekali — server yang menentukan
    const q = priceOrder(catalog(), [{ productId: 'p1', qty: 1, modifierOptionIds: ['o1'], note: 'tanpa gula' }])
    expect(q.items[0].unitPrice).toBe(25000)
    expect(q.items[0].notes).toBe('tanpa gula')
  })
})

describe('buildMenu', () => {
  it('hanya produk tersedia di kategori aktif, dengan modifier', () => {
    const menu = buildMenu(catalog(), { tableId: 't1', tableName: 'Meja 1' })
    expect(menu.items.map((i) => i.id)).toEqual(['p1'])
    expect(menu.categories).toEqual([{ id: 'c1', name: 'Kopi' }])
    expect(menu.items[0].modifierGroups[0].options.map((o) => o.name)).toEqual(['Reguler', 'Large'])
    expect(menu.fiscal).toEqual({ taxPercent: 10, serviceChargePercent: 5 })
    expect(menu.table).toEqual({ id: 't1', name: 'Meja 1' })
  })
})
