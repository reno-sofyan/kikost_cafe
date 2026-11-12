import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { ensureDefaultSettings, updateSettings } from './settings'
import { addOrderItem, clearOrderItems, isItemSentToKitchen, startOrder } from './orders'
import { openShift } from './shifts'

const actor = { userId: 'u1', userName: 'Kasir' }

beforeEach(async () => {
  await resetLocalDb()
  await ensureDefaultSettings()
  // Laundry (tanpa dapur): layanan langsung diserahkan, tak pernah antre di dapur.
  await updateSettings({ businessType: 'laundry' })
  await db.categories.put({ id: 'c1', name: 'Umum', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })
  await db.products.put({
    id: 'p1', categoryId: 'c1', name: 'Cuci Setrika', sku: 'L1', barcode: null, price: 9000, costPrice: 4000,
    unit: 'kg', photoDataUrl: null, trackOwnStock: false, stockQty: 0, lowStockThreshold: 0,
    isFavorite: false, isAvailable: true, modifierGroupIds: [], createdAt: 1, updatedAt: 1,
  })
})

describe('kosongkan keranjang: barang langsung saji', () => {
  it('bukan "sudah di dapur", dan ikut terhapus saat dikosongkan', async () => {
    const shift = await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 0 })
    const order = await startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'Kasir', shiftId: shift.id })
    await addOrderItem({ orderId: order.id, productId: 'p1', productName: 'Cuci Setrika', unitPrice: 9000, qty: 2, modifiers: [], notes: '' })
    const [item] = await db.orderItems.where('orderId').equals(order.id).toArray()
    expect(item!.kitchenStatus).toBe('done')
    expect(isItemSentToKitchen(item!)).toBe(false)

    const removed = await clearOrderItems(order.id, 'salah input', actor)
    expect(removed).toBe(1)
    expect((await db.orderItems.get(item!.id))?.removed).toBe(true)
  })
})
