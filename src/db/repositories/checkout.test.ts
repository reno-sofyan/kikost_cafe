import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { finalizePayment, OrderAlreadyFinalizedError, returnOrderItems, voidOrder } from './checkout'
import { addOrderItem, startOrder } from './orders'
import { openShift } from './shifts'
import { resetLocalDb } from '@/test/db'
import type { Ingredient, Product, Recipe } from '@/types/domain'

async function seedProduct(partial: Partial<Product>): Promise<Product> {
  const p: Product = {
    id: partial.id ?? 'p-own',
    categoryId: 'c1',
    name: partial.name ?? 'Produk',
    sku: partial.sku ?? 'SKU1',
    barcode: null,
    price: partial.price ?? 20000,
    costPrice: partial.costPrice ?? 8000,
    unit: 'pcs',
    photoDataUrl: null,
    trackOwnStock: partial.trackOwnStock ?? true,
    stockQty: partial.stockQty ?? 10,
    lowStockThreshold: 2,
    isFavorite: false,
    isAvailable: true,
    modifierGroupIds: [],
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
  await db.products.put(p)
  return p
}

beforeEach(async () => {
  await resetLocalDb()
  await db.categories.put({ id: 'c1', name: 'Umum', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })
})

async function buildOpenOrder(productId: string, qty: number) {
  const shift = await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 100000 })
  const order = await startOrder({
    type: 'takeaway',
    cashierId: 'u1',
    cashierName: 'Kasir',
    shiftId: shift.id,
  })
  const product = await db.products.get(productId)
  await addOrderItem({
    orderId: order.id,
    productId,
    productName: product?.name ?? 'Produk',
    unitPrice: product?.price ?? 20000,
    qty,
    modifiers: [],
    notes: '',
  })
  return { shift, order }
}

describe('finalizePayment', () => {
  it('mengurangi stok produk tepat satu kali & menandai pesanan paid', async () => {
    await seedProduct({ id: 'p-own', stockQty: 10, price: 20000 })
    const { order } = await buildOpenOrder('p-own', 3)

    const result = await finalizePayment({
      orderId: order.id,
      payments: [{ method: 'cash', amount: 60000, receivedAmount: 100000 }],
      confirmedByUserId: 'u1',
    })

    expect(result.order.status).toBe('paid')
    expect(result.payments[0].changeAmount).toBe(40000)
    expect((await db.products.get('p-own'))?.stockQty).toBe(7)
    const movements = await db.stockMovements.where('reason').equals('sale').toArray()
    expect(movements).toHaveLength(1)
    expect(movements[0].qtyDelta).toBe(-3)
  })

  it('menolak pembayaran ganda pada order yang sama (cegah klik ganda) — stok tidak berkurang dua kali', async () => {
    await seedProduct({ id: 'p-own', stockQty: 10 })
    const { order } = await buildOpenOrder('p-own', 2)
    const pay = () =>
      finalizePayment({
        orderId: order.id,
        payments: [{ method: 'qris', amount: 40000 }],
        confirmedByUserId: 'u1',
      })

    await pay()
    await expect(pay()).rejects.toBeInstanceOf(OrderAlreadyFinalizedError)
    expect((await db.products.get('p-own'))?.stockQty).toBe(8)
  })

  it('menolak bila pembayaran kurang dari total', async () => {
    await seedProduct({ id: 'p-own', stockQty: 5, price: 20000 })
    const { order } = await buildOpenOrder('p-own', 1)
    await expect(
      finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: 15000 }], confirmedByUserId: 'u1' }),
    ).rejects.toThrow()
  })

  it('split payment: jumlah beberapa metode menutup total', async () => {
    await seedProduct({ id: 'p-own', stockQty: 5, price: 50000 })
    const { order } = await buildOpenOrder('p-own', 1)
    const res = await finalizePayment({
      orderId: order.id,
      payments: [
        { method: 'cash', amount: 20000, receivedAmount: 20000 },
        { method: 'qris', amount: 30000 },
      ],
      confirmedByUserId: 'u1',
    })
    expect(res.order.status).toBe('paid')
    expect(res.payments).toHaveLength(2)
  })

  it('mengurangi bahan baku sesuai resep untuk produk tanpa stok sendiri', async () => {
    await seedProduct({ id: 'p-recipe', trackOwnStock: false, price: 18000 })
    const ing: Ingredient = {
      id: 'ing-milk',
      name: 'Susu',
      unit: 'ml',
      stockQty: 1000,
      lowStockThreshold: 100,
      costPerUnit: 20,
      createdAt: 1,
      updatedAt: 1,
    }
    await db.ingredients.put(ing)
    const recipe: Recipe = { id: 'r1', productId: 'p-recipe', items: [{ ingredientId: 'ing-milk', qty: 150 }], updatedAt: 1 }
    await db.recipes.put(recipe)

    const { order } = await buildOpenOrder('p-recipe', 2)
    await finalizePayment({
      orderId: order.id,
      payments: [{ method: 'cash', amount: 36000, receivedAmount: 36000 }],
      confirmedByUserId: 'u1',
    })
    expect((await db.ingredients.get('ing-milk'))?.stockQty).toBe(700)
  })
})

describe('voidOrder & returnOrderItems', () => {
  it('void pesanan yang sudah dibayar mengembalikan stok', async () => {
    await seedProduct({ id: 'p-own', stockQty: 10 })
    const { order } = await buildOpenOrder('p-own', 4)
    await finalizePayment({
      orderId: order.id,
      payments: [{ method: 'cash', amount: 80000, receivedAmount: 80000 }],
      confirmedByUserId: 'u1',
    })
    expect((await db.products.get('p-own'))?.stockQty).toBe(6)

    await voidOrder({ orderId: order.id, reason: 'salah input', approverUserId: 'sup1', approverName: 'Supervisor' })
    expect((await db.orders.get(order.id))?.status).toBe('void')
    expect((await db.products.get('p-own'))?.stockQty).toBe(10)
    const audit = await db.auditLogs.toArray()
    expect(audit.some((a) => a.action === 'order.void')).toBe(true)
  })

  it('retur sebagian mengembalikan stok item yang diretur saja', async () => {
    const prod = await seedProduct({ id: 'p-own', stockQty: 10, price: 10000 })
    const { order } = await buildOpenOrder('p-own', 5)
    await finalizePayment({
      orderId: order.id,
      payments: [{ method: 'cash', amount: 50000, receivedAmount: 50000 }],
      confirmedByUserId: 'u1',
    })
    const items = await db.orderItems.where('orderId').equals(order.id).toArray()
    void prod

    const record = await returnOrderItems({
      orderId: order.id,
      orderItemIds: [items[0].id],
      reason: 'rusak',
      restock: true,
      approverUserId: 'sup1',
      approverName: 'Supervisor',
    })
    expect(record.refundAmount).toBe(50000)
    expect((await db.products.get('p-own'))?.stockQty).toBe(10)
    expect((await db.orderItems.get(items[0].id))?.voided).toBe(true)
  })
})
