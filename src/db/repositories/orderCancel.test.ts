import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { addOrderItem, CancelNeedsApprovalError, cancelUnsentOrder, startOrder } from './orders'
import { openShift } from './shifts'

const actor = { userId: 'u1', userName: 'Kasir' }

beforeEach(async () => {
  await resetLocalDb()
  await db.categories.put({ id: 'c1', name: 'Umum', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })
  await db.products.put({
    id: 'p1', categoryId: 'c1', name: 'Nasi Goreng', sku: 'N1', barcode: null, price: 15000, costPrice: 5000,
    unit: 'pcs', photoDataUrl: null, trackOwnStock: false, stockQty: 0, lowStockThreshold: 0,
    isFavorite: false, isAvailable: true, modifierGroupIds: [], createdAt: 1, updatedAt: 1,
  })
})

async function orderWithItem() {
  const shift = await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 0 })
  const order = await startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'Kasir', shiftId: shift.id })
  await addOrderItem({ orderId: order.id, productId: 'p1', productName: 'Nasi Goreng', unitPrice: 15000, qty: 1, modifiers: [], notes: '' })
  return order
}

describe('cancelUnsentOrder (kasir, tanpa persetujuan)', () => {
  it('membatalkan pesanan belum dibayar & belum ke dapur, alasan tercatat di log', async () => {
    const order = await orderWithItem()
    await cancelUnsentOrder(order.id, ' Salah input ', actor)
    const after = await db.orders.get(order.id)
    expect(after).toMatchObject({ status: 'void', lifecycleStatus: 'VOIDED', voidReason: 'Salah input', voidedBy: 'u1' })
    const log = (await db.auditLogs.toArray()).find((l) => l.action === 'order.cancel')
    expect(log?.details).toContain('Salah input')
  })

  it('alasan wajib', async () => {
    const order = await orderWithItem()
    await expect(cancelUnsentOrder(order.id, '  ', actor)).rejects.toThrow('Alasan')
    expect((await db.orders.get(order.id))?.status).toBe('open')
  })

  it('menolak bila ada item yang sudah diteruskan ke dapur', async () => {
    const order = await orderWithItem()
    const [item] = await db.orderItems.where('orderId').equals(order.id).toArray()
    await db.orderItems.update(item.id, { kitchenPrintedAt: 123 })
    await expect(cancelUnsentOrder(order.id, 'Salah input', actor)).rejects.toThrow(CancelNeedsApprovalError)
    expect((await db.orders.get(order.id))?.status).toBe('open')
  })
})
