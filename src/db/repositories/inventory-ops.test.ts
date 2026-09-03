import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { createPurchase, receivePurchase } from './purchasing'
import { createStockOpname, finalizeStockOpname, saveOpnameCounts } from './stockOpname'
import { finalizePayment } from './checkout'
import { addOrderItem, startOrder } from './orders'
import { openShift } from './shifts'
import type { Ingredient, Recipe } from '@/types/domain'

async function ingredient(p: Partial<Ingredient> = {}): Promise<Ingredient> {
  const i: Ingredient = {
    id: p.id ?? 'i1', name: p.name ?? 'Biji Kopi', unit: p.unit ?? 'g',
    stockQty: p.stockQty ?? 0, lowStockThreshold: 100, costPerUnit: p.costPerUnit ?? 100,
    createdAt: 1, updatedAt: 1, ...p,
  }
  await db.ingredients.put(i)
  return i
}

beforeEach(async () => {
  await resetLocalDb()
  await db.categories.put({ id: 'c1', name: 'Umum', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })
})

describe('Pembelian & penerimaan', () => {
  it('menerima pembelian memposting stok masuk + memperbarui biaya, dengan konversi satuan', async () => {
    await ingredient({ id: 'i1', unit: 'g', stockQty: 500, costPerUnit: 200 })
    const purchase = await createPurchase({
      supplierName: 'Toko Kopi', invoiceNo: 'INV-1', note: '', createdBy: 'u1',
      lines: [{ itemType: 'ingredient', itemId: 'i1', itemName: 'Biji Kopi', qty: 2, unit: 'kg', unitCost: 150000 }],
    })
    expect(purchase.status).toBe('draft')
    expect((await db.ingredients.get('i1'))?.stockQty).toBe(500) // belum berubah

    await receivePurchase({ purchaseId: purchase.id, receivedBy: 'u1', receivedByName: 'Admin' })
    // 2 kg = 2000 g ditambahkan
    expect((await db.ingredients.get('i1'))?.stockQty).toBe(2500)
    // biaya per g = 300000 / 2000 = 150
    expect((await db.ingredients.get('i1'))?.costPerUnit).toBe(150)
    const mv = await db.stockMovements.where('reason').equals('purchase_receipt').toArray()
    expect(mv).toHaveLength(1)
    expect(mv[0].qtyDelta).toBe(2000)
    expect(mv[0].refType).toBe('purchase')
    // idempoten
    await receivePurchase({ purchaseId: purchase.id, receivedBy: 'u1', receivedByName: 'Admin' })
    expect((await db.ingredients.get('i1'))?.stockQty).toBe(2500)
  })
})

describe('Stok opname', () => {
  it('finalisasi memposting selisih sebagai adjustment beralasan; wajib note', async () => {
    await ingredient({ id: 'i1', unit: 'g', stockQty: 1000 })
    await ingredient({ id: 'i2', name: 'Susu', unit: 'ml', stockQty: 500 })
    const opname = await createStockOpname({ createdBy: 'u1', note: '' })
    expect(opname.lines).toHaveLength(2)

    await saveOpnameCounts(opname.id, { i1: 940, i2: 500 })
    await expect(
      finalizeStockOpname({ opnameId: opname.id, finalizedBy: 'u1', finalizedByName: 'A', note: '' }),
    ).rejects.toThrow()

    const done = await finalizeStockOpname({ opnameId: opname.id, finalizedBy: 'u1', finalizedByName: 'A', note: 'susut penyimpanan' })
    expect(done.status).toBe('finalized')
    expect((await db.ingredients.get('i1'))?.stockQty).toBe(940)
    expect((await db.ingredients.get('i2'))?.stockQty).toBe(500) // tak berubah
    const mv = await db.stockMovements.where('reason').equals('stock_opname').toArray()
    expect(mv).toHaveLength(1)
    expect(mv[0].qtyDelta).toBe(-60)
    expect(mv[0].note).toBe('susut penyimpanan')
  })
})

describe('Konversi satuan di resep saat penjualan', () => {
  it('resep "0.02 kg" untuk bahan ber-satuan g memotong 20 g per unit', async () => {
    await ingredient({ id: 'i1', unit: 'g', stockQty: 1000 })
    await db.products.put({
      id: 'p1', categoryId: 'c1', name: 'Kopi', sku: 'K1', barcode: null, price: 20000, costPrice: 5000,
      unit: 'pcs', photoDataUrl: null, trackOwnStock: false, stockQty: 0, lowStockThreshold: 0,
      isFavorite: false, isAvailable: true, modifierGroupIds: [], createdAt: 1, updatedAt: 1,
    })
    const recipe: Recipe = { id: 'r1', productId: 'p1', items: [{ ingredientId: 'i1', qty: 0.02, unit: 'kg' }], updatedAt: 1 }
    await db.recipes.put(recipe)

    const shift = await openShift({ cashierId: 'u1', cashierName: 'K', openingCash: 0 })
    const order = await startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'K', shiftId: shift.id })
    await addOrderItem({ orderId: order.id, productId: 'p1', productName: 'Kopi', unitPrice: 20000, qty: 3, modifiers: [], notes: '' })
    await finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: 60000 }], confirmedByUserId: 'u1' })

    expect((await db.ingredients.get('i1'))?.stockQty).toBe(940) // 1000 - 3 × 20 g
  })
})
