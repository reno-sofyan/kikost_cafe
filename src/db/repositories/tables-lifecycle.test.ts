import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { addOrderItem, startOrder } from './orders'
import { openShift } from './shifts'
import { finalizePayment } from './checkout'
import { createTable, markAvailable, markAwaitingPayment } from './tables'
import type { Product } from '@/types/domain'

async function seedProduct(): Promise<void> {
  await db.products.put({
    id: 'p1', categoryId: 'c1', name: 'Kopi', sku: 'K1', barcode: null,
    price: 20000, costPrice: 5000, unit: 'pcs', photoDataUrl: null,
    trackOwnStock: true, stockQty: 100, lowStockThreshold: 0,
    isFavorite: false, isAvailable: true, modifierGroupIds: [], createdAt: 1, updatedAt: 1,
  } as Product)
}

beforeEach(async () => {
  await resetLocalDb()
  await db.categories.put({ id: 'c1', name: 'U', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })
  await seedProduct()
})

describe('Siklus status meja dine-in', () => {
  it('pesanan dine-in dengan meja → meja terisi; bayar lunas → perlu dibersihkan; tandai tersedia → tersedia', async () => {
    const table = await createTable({ name: 'Meja 1', area: '', capacity: 2 })
    const shift = await openShift({ cashierId: 'u1', cashierName: 'K', openingCash: 100000 })
    const order = await startOrder({
      type: 'dine_in', tableId: table.id, guestCount: 3,
      cashierId: 'u1', cashierName: 'K', shiftId: shift.id,
    })

    let t = (await db.cafeTables.get(table.id))!
    expect(t.status).toBe('occupied')
    expect(t.currentOrderId).toBe(order.id)
    expect(t.guestCount).toBe(3)
    expect(t.occupiedSince).toBeTruthy()

    await markAwaitingPayment(table.id)
    expect((await db.cafeTables.get(table.id))?.status).toBe('awaiting_payment')

    await addOrderItem({ orderId: order.id, productId: 'p1', productName: 'Kopi', unitPrice: 20000, qty: 1, modifiers: [], notes: '' })
    await finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: 20000 }], confirmedByUserId: 'u1' })

    t = (await db.cafeTables.get(table.id))!
    expect(t.status).toBe('needs_cleaning')
    expect(t.currentOrderId).toBeNull()
    expect(t.occupiedSince).toBeNull()
    expect(t.guestCount).toBeNull()
    // perubahan meja ikut diantre untuk sinkronisasi
    expect(await db.syncQueue.where('entity').equals('cafeTables').count()).toBeGreaterThan(0)

    await markAvailable(table.id)
    expect((await db.cafeTables.get(table.id))?.status).toBe('available')
  })

  it('markAwaitingPayment hanya berlaku bila meja sedang terisi', async () => {
    const table = await createTable({ name: 'Meja 2', area: '', capacity: 2 })
    // masih "available"
    await markAwaitingPayment(table.id)
    expect((await db.cafeTables.get(table.id))?.status).toBe('available')
  })
})
