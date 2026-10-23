import { beforeEach, describe, expect, it } from 'vitest'
import { addOrderItem, startOrder, updateOrderItemNotes } from './orders'
import { sendOrderToKitchen } from './kitchenDispatch'
import { openShift } from './shifts'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'

beforeEach(async () => {
  await resetLocalDb()
})

async function itemInOpenOrder() {
  const shift = await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 0 })
  const order = await startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'Kasir', shiftId: shift.id })
  const item = await addOrderItem({ orderId: order.id, productId: 'p1', productName: 'Nasi Goreng', unitPrice: 20000, qty: 1, modifiers: [], notes: '' })
  return { order, item }
}

describe('updateOrderItemNotes (catatan per item di kasir)', () => {
  it('menyimpan catatan yang dirapikan & ikut antre sinkron', async () => {
    const { item } = await itemInOpenOrder()
    await updateOrderItemNotes(item.id, '  tidak pakai   saos ')
    expect((await db.orderItems.get(item.id))?.notes).toBe('tidak pakai saos')
    expect(await db.syncQueue.where('entityId').equals(item.id).count()).toBeGreaterThan(0)
  })

  it('catatan ikut tercetak di tiket dapur', async () => {
    const { order, item } = await itemInOpenOrder()
    await updateOrderItemNotes(item.id, 'Tanpa sambal')
    await sendOrderToKitchen(order.id, { userId: 'u1', userName: 'Kasir' })
    const job = await db.printJobs.where('orderId').equals(order.id).first()
    expect((job?.payload as { lines: { note: string }[] }).lines[0].note).toBe('Tanpa sambal')
  })

  it('item yang sudah dikirim ke dapur tak bisa diubah catatannya', async () => {
    const { order, item } = await itemInOpenOrder()
    await sendOrderToKitchen(order.id, { userId: 'u1', userName: 'Kasir' })
    await expect(updateOrderItemNotes(item.id, 'telat')).rejects.toThrow('sudah dikirim ke dapur')
  })
})
