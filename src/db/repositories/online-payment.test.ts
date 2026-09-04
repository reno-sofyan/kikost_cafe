import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { applyRemoteEntities } from '@/sync/applyRemote'
import { addOrderItem, startOrder } from './orders'
import { openShift } from './shifts'
import { implicitBillId } from './billing'
import type { OnlinePayment, Product } from '@/types/domain'

beforeEach(async () => {
  await resetLocalDb()
  await db.categories.put({ id: 'c1', name: 'U', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })
  await db.products.put({
    id: 'p1', categoryId: 'c1', name: 'Kopi', sku: 'k', barcode: null, price: 20000, costPrice: 5000,
    unit: 'pcs', photoDataUrl: null, trackOwnStock: true, stockQty: 10, lowStockThreshold: 0,
    isFavorite: false, isAvailable: true, modifierGroupIds: [], createdAt: 1, updatedAt: 1,
  } as Product)
})

async function confirmedOrder() {
  const shift = await openShift({ cashierId: 'u1', cashierName: 'K', openingCash: 0 })
  const order = await startOrder({ type: 'dine_in', cashierId: 'u1', cashierName: 'K', shiftId: shift.id })
  await addOrderItem({ orderId: order.id, productId: 'p1', productName: 'Kopi', unitPrice: 20000, qty: 2, modifiers: [], notes: '' })
  return (await db.orders.get(order.id))!
}

function op(orderId: string, over: Partial<OnlinePayment> = {}): OnlinePayment {
  return {
    id: 'ref-abc', orderId, billId: implicitBillId(orderId), amount: 40000, method: 'qris',
    reference: 'ref-abc', createdAt: Date.now(), ...over,
  }
}

describe('pembayaran online (webhook → applyRemote)', () => {
  it('melunasi bill, menyelesaikan order, memotong stok sekali', async () => {
    const order = await confirmedOrder()
    await applyRemoteEntities({ onlinePayments: [op(order.id)] })

    const bill = await db.bills.get(implicitBillId(order.id))
    expect(bill?.paymentStatus).toBe('PAID')
    expect(bill?.onlinePaymentRef).toBe('ref-abc')
    expect((await db.orders.get(order.id))?.lifecycleStatus).toBe('COMPLETED')
    expect((await db.products.get('p1'))?.stockQty).toBe(8)
    const pays = await db.payments.where('orderId').equals(order.id).toArray()
    expect(pays.filter((p) => p.method === 'qris' && p.amount === 40000)).toHaveLength(1)
  })

  it('idempoten — notifikasi yang sama diproses dua kali tak potong stok dua kali', async () => {
    const order = await confirmedOrder()
    await applyRemoteEntities({ onlinePayments: [op(order.id)] })
    await applyRemoteEntities({ onlinePayments: [op(order.id)] })
    expect((await db.products.get('p1'))?.stockQty).toBe(8)
    expect(await db.payments.where('orderId').equals(order.id).count()).toBe(1)
  })

  it('pesanan QR belum dikonfirmasi → ditunda (tak melunasi), lalu jalan setelah ada bill', async () => {
    const order = await confirmedOrder()
    await db.orders.update(order.id, { lifecycleStatus: 'PENDING_CONFIRMATION', status: 'open' })
    await applyRemoteEntities({ onlinePayments: [op(order.id)] })
    expect((await db.orders.get(order.id))?.lifecycleStatus).toBe('PENDING_CONFIRMATION')

    // kasir menerima → order CONFIRMED; siklus sync berikutnya menerapkan
    await db.orders.update(order.id, { lifecycleStatus: 'CONFIRMED' })
    await applyRemoteEntities({ onlinePayments: [op(order.id)] })
    expect((await db.orders.get(order.id))?.lifecycleStatus).toBe('COMPLETED')
  })

  it('membuat bill utama otomatis bila belum ada', async () => {
    const order = await confirmedOrder()
    expect(await db.bills.get(implicitBillId(order.id))).toBeUndefined()
    await applyRemoteEntities({ onlinePayments: [op(order.id)] })
    expect((await db.bills.get(implicitBillId(order.id)))?.paymentStatus).toBe('PAID')
  })

  it('menghormati split — melunasi hanya bill yang ditarget', async () => {
    const order = await confirmedOrder()
    await db.products.put({
      id: 'p2', categoryId: 'c1', name: 'Teh', sku: 't', barcode: null, price: 10000, costPrice: 2000,
      unit: 'pcs', photoDataUrl: null, trackOwnStock: true, stockQty: 10, lowStockThreshold: 0,
      isFavorite: false, isAvailable: true, modifierGroupIds: [], createdAt: 1, updatedAt: 1,
    } as Product)
    const teh = await addOrderItem({ orderId: order.id, productId: 'p2', productName: 'Teh', unitPrice: 10000, qty: 1, modifiers: [], notes: '' })
    const kopi = (await db.orderItems.where('orderId').equals(order.id).toArray()).find((i) => i.productId === 'p1')!
    const { splitBillByItems } = await import('./billing')
    const bills = await splitBillByItems(order.id, [[kopi.id], [teh.id]], ['A', 'B'])

    await applyRemoteEntities({ onlinePayments: [op(order.id, { billId: bills[0].id, amount: bills[0].grandTotal, reference: 'r1', id: 'r1' })] })
    expect((await db.bills.get(bills[0].id))?.paymentStatus).toBe('PAID')
    expect((await db.bills.get(bills[1].id))?.paymentStatus).toBe('UNPAID')
    expect((await db.orders.get(order.id))?.lifecycleStatus).not.toBe('COMPLETED')
  })
})
