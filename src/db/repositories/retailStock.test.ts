import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { adjustProductStock, deductSaleStock } from '@/db/repositories/stock'
import { createPurchase, receivePurchase } from '@/db/repositories/purchasing'
import { updateProduct } from '@/db/repositories/products'
import { findProductByCode, suggestedRestockQty } from '@/db/repositories/retail'
import { qtyAfterScan } from '@/features/retail/retailHelpers'
import type { Product } from '@/types/domain'

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    categoryId: 'c1',
    name: 'Susu UHT 250ml',
    sku: 'MM-500',
    barcode: '8999909000',
    price: 6000,
    costPrice: 4500,
    unit: 'pcs',
    photoDataUrl: null,
    trackOwnStock: true,
    stockQty: 0,
    lowStockThreshold: 12,
    isFavorite: false,
    isAvailable: false,
    modifierGroupIds: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const batchesOf = async (id = 'p1') => (await db.products.get(id))!.expiryBatches?.map((b) => [b.expiryDate, b.qty])

beforeEach(async () => {
  await resetLocalDb()
  await db.products.add(product())
})

describe('stok minimarket — kedaluwarsa per penerimaan', () => {
  it('stok masuk bertanggal membuat batch; penjualan memotong FEFO', async () => {
    await adjustProductStock({ productId: 'p1', qtyDelta: 10, reason: 'stock_in', userId: 'u', expiryDate: '2027-02-01', restoreAvailability: true })
    await adjustProductStock({ productId: 'p1', qtyDelta: 5, reason: 'stock_in', userId: 'u', expiryDate: '2026-12-01' })
    await db.transaction('rw', [db.products, db.ingredients, db.stockMovements, db.syncQueue, db.recipes], async () => {
      await deductSaleStock([{ productId: 'p1', qty: 7 }], 'o1', 'u')
    })
    const p = (await db.products.get('p1'))!
    expect(p.stockQty).toBe(8)
    expect(p.isAvailable).toBe(true)
    expect(await batchesOf()).toEqual([['2027-02-01', 8]])
  })

  it('waste batch tertentu memotong batch itu', async () => {
    await adjustProductStock({ productId: 'p1', qtyDelta: 4, reason: 'stock_in', userId: 'u', expiryDate: '2026-11-01' })
    await adjustProductStock({ productId: 'p1', qtyDelta: 6, reason: 'stock_in', userId: 'u', expiryDate: '2027-01-01' })
    const expired = (await db.products.get('p1'))!.expiryBatches!.find((b) => b.expiryDate === '2026-11-01')!
    await adjustProductStock({ productId: 'p1', qtyDelta: -4, reason: 'waste', userId: 'u', batchId: expired.id })
    expect(await batchesOf()).toEqual([['2027-01-01', 6]])
  })

  it('stok diubah manual di form produk memangkas batch', async () => {
    await adjustProductStock({ productId: 'p1', qtyDelta: 10, reason: 'stock_in', userId: 'u', expiryDate: '2027-01-01' })
    await updateProduct('p1', { stockQty: 3 })
    expect(await batchesOf()).toEqual([['2027-01-01', 3]])
  })

  it('produk tanpa batch tidak mendapat field batch kosong', async () => {
    await adjustProductStock({ productId: 'p1', qtyDelta: 5, reason: 'stock_in', userId: 'u' })
    expect((await db.products.get('p1'))!.expiryBatches).toBeUndefined()
  })

  it('tanpa restoreAvailability produk yang habis tetap tersembunyi (perilaku kafe lama)', async () => {
    await adjustProductStock({ productId: 'p1', qtyDelta: 5, reason: 'stock_in', userId: 'u' })
    expect((await db.products.get('p1'))!.isAvailable).toBe(false)
  })
})

describe('penerimaan pembelian minimarket', () => {
  it('jumlah diterima & tanggal kedaluwarsa per baris', async () => {
    const po = await createPurchase({
      supplierName: 'PT Susu',
      invoiceNo: 'F-1',
      note: '',
      createdBy: 'u',
      lines: [{ itemType: 'product', itemId: 'p1', itemName: 'Susu UHT 250ml', qty: 24, unit: 'pcs', unitCost: 4000 }],
    })
    const received = await receivePurchase({ purchaseId: po.id, receivedBy: 'u', receivedByName: 'U', receivedQtys: { 0: 20 }, expiryDates: { 0: '2027-03-01' }, restoreAvailability: true })
    expect(received.lines[0]).toMatchObject({ qty: 20, lineCost: 80000, expiryDate: '2027-03-01' })
    expect(received.totalCost).toBe(80000)
    const p = (await db.products.get('p1'))!
    expect(p).toMatchObject({ stockQty: 20, costPrice: 4000, isAvailable: true })
    expect(await batchesOf()).toEqual([['2027-03-01', 20]])
  })

  it('harga beli kosong tidak menimpa HPP produk', async () => {
    const po = await createPurchase({ supplierName: '', invoiceNo: '', note: '', createdBy: 'u', lines: [{ itemType: 'product', itemId: 'p1', itemName: 'Susu', qty: 2, unit: 'pcs', unitCost: 0 }] })
    await receivePurchase({ purchaseId: po.id, receivedBy: 'u', receivedByName: 'U' })
    expect((await db.products.get('p1'))!.costPrice).toBe(4500)
  })
})

describe('helper ritel', () => {
  it('cari produk lewat barcode / SKU, abaikan yang diarsipkan', async () => {
    expect((await findProductByCode('8999909000'))?.id).toBe('p1')
    expect((await findProductByCode('mm-500'))?.id).toBe('p1')
    await db.products.update('p1', { archived: true })
    expect(await findProductByCode('8999909000')).toBeUndefined()
  })

  it('saran beli dibulatkan per dus', () => {
    expect(suggestedRestockQty({ stockQty: 6, lowStockThreshold: 24, packSize: 24 })).toBe(48)
    expect(suggestedRestockQty({ stockQty: 0, lowStockThreshold: 5, packSize: null })).toBe(10)
  })

  it('pindaian barcode di kolom jumlah = +1', () => {
    expect(qtyAfterScan('508999909000', '8999909000')).toEqual({ qty: 51, scanned: true })
    expect(qtyAfterScan('8999909000', '8999909000')).toEqual({ qty: 1, scanned: true })
    expect(qtyAfterScan('12', '8999909000')).toEqual({ qty: 12, scanned: false })
  })
})
