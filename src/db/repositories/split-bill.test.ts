import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { addOrderItem, startOrder } from './orders'
import { openShift } from './shifts'
import { updateSettings } from './settings'
import { payOrderBill } from './checkout'
import { implicitBillId, listOrderBills, splitBillByItems, unsplitBills } from './billing'
import type { Product } from '@/types/domain'

async function seedProduct(id: string, price: number): Promise<void> {
  await db.products.put({
    id, categoryId: 'c1', name: id, sku: id, barcode: null, price, costPrice: 0, unit: 'pcs',
    photoDataUrl: null, trackOwnStock: true, stockQty: 100, lowStockThreshold: 0, isFavorite: false,
    isAvailable: true, modifierGroupIds: [], createdAt: 1, updatedAt: 1,
  } as Product)
}

beforeEach(async () => {
  await resetLocalDb()
  await db.categories.put({ id: 'c1', name: 'U', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })
  await updateSettings({ taxPercent: 10, serviceChargePercent: 5, roundingIncrement: 1 })
})

async function threeItemOrder() {
  await seedProduct('a', 20000)
  await seedProduct('b', 30000)
  await seedProduct('c', 50000)
  const shift = await openShift({ cashierId: 'u1', cashierName: 'K', openingCash: 0 })
  const order = await startOrder({ type: 'dine_in', cashierId: 'u1', cashierName: 'K', shiftId: shift.id })
  const ia = await addOrderItem({ orderId: order.id, productId: 'a', productName: 'a', unitPrice: 20000, qty: 1, modifiers: [], notes: '' })
  const ib = await addOrderItem({ orderId: order.id, productId: 'b', productName: 'b', unitPrice: 30000, qty: 1, modifiers: [], notes: '' })
  const ic = await addOrderItem({ orderId: order.id, productId: 'c', productName: 'c', unitPrice: 50000, qty: 1, modifiers: [], notes: '' })
  return { order: (await db.orders.get(order.id))!, ia, ib, ic }
}

describe('splitBillByItems', () => {
  it('memecah per item; jumlah seluruh bill = grand total order persis', async () => {
    const { order, ia, ib, ic } = await threeItemOrder()
    const bills = await splitBillByItems(order.id, [[ia.id], [ib.id, ic.id]], ['Andi', 'Budi'])
    expect(bills).toHaveLength(2)
    expect(bills[0].subtotal).toBe(20000)
    expect(bills[1].subtotal).toBe(80000)
    const total = bills.reduce((s, b) => s + b.grandTotal, 0)
    expect(total).toBe(order.grandTotal)
    // bill pertama pakai id bill utama
    expect(bills[0].id).toBe(implicitBillId(order.id))
    expect(bills[0].itemIds).toEqual([ia.id])
    expect(bills[0].label).toBe('Andi')
  })

  it('menolak partisi tidak lengkap / item ganda', async () => {
    const { order, ia, ib } = await threeItemOrder()
    await expect(splitBillByItems(order.id, [[ia.id], [ib.id]])).rejects.toThrow(/semua item/i)
    await expect(splitBillByItems(order.id, [[ia.id, ia.id], [ib.id]])).rejects.toThrow() // grup jadi 1 item unik → partisi tak lengkap
  })

  it('bayar tiap bill terpisah → order COMPLETED hanya setelah semua lunas; stok sekali', async () => {
    const { order, ia, ib, ic } = await threeItemOrder()
    const bills = await splitBillByItems(order.id, [[ia.id], [ib.id, ic.id]])

    await payOrderBill({ billId: bills[0].id, payments: [{ method: 'cash', amount: bills[0].grandTotal }], confirmedByUserId: 'u1' })
    expect((await db.orders.get(order.id))?.lifecycleStatus).not.toBe('COMPLETED')
    expect((await db.products.get('a'))?.stockQty).toBe(100) // belum

    await payOrderBill({ billId: bills[1].id, payments: [{ method: 'qris', amount: bills[1].grandTotal }], confirmedByUserId: 'u1' })
    expect((await db.orders.get(order.id))?.lifecycleStatus).toBe('COMPLETED')
    expect((await db.products.get('a'))?.stockQty).toBe(99)
    expect((await db.products.get('b'))?.stockQty).toBe(99)
    expect((await db.products.get('c'))?.stockQty).toBe(99)
  })

  it('unsplit menggabungkan kembali bila belum ada pembayaran', async () => {
    const { order, ia, ib, ic } = await threeItemOrder()
    await splitBillByItems(order.id, [[ia.id], [ib.id, ic.id]])
    await unsplitBills(order.id)
    const bills = (await listOrderBills(order.id)).filter((b) => b.grandTotal > 0)
    expect(bills).toHaveLength(1)
    expect(bills[0].grandTotal).toBe(order.grandTotal)
    expect(bills[0].itemIds).toBe('all')
  })

  it('tak bisa memecah / menggabungkan setelah ada pembayaran', async () => {
    const { order, ia, ib, ic } = await threeItemOrder()
    const bills = await splitBillByItems(order.id, [[ia.id], [ib.id, ic.id]])
    await payOrderBill({ billId: bills[0].id, payments: [{ method: 'cash', amount: bills[0].grandTotal }], confirmedByUserId: 'u1' })
    await expect(unsplitBills(order.id)).rejects.toThrow(/pembayaran/i)
    await expect(splitBillByItems(order.id, [[ia.id, ib.id], [ic.id]])).rejects.toThrow(/pembayaran|dipecah/i)
  })
})
