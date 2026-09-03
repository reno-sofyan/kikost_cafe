import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { addOrderItem, startOrder } from './orders'
import { openShift } from './shifts'
import { updateSettings } from './settings'
import { finalizePayment } from './checkout'
import { implicitBillId, InsufficientPaymentError, listOrderBills, payBill, splitBillByAmount } from './billing'
import type { Product } from '@/types/domain'

async function seedProduct(p: Partial<Product> = {}): Promise<void> {
  await db.products.put({
    id: p.id ?? 'p1', categoryId: 'c1', name: p.name ?? 'Kopi', sku: p.sku ?? 'K1', barcode: null,
    price: p.price ?? 20000, costPrice: 5000, unit: 'pcs', photoDataUrl: null,
    trackOwnStock: p.trackOwnStock ?? true, stockQty: p.stockQty ?? 100, lowStockThreshold: 0,
    isFavorite: false, isAvailable: true, modifierGroupIds: [], createdAt: 1, updatedAt: 1, ...p,
  })
}

async function orderOf(qty: number, price = 20000) {
  const shift = await openShift({ cashierId: 'u1', cashierName: 'K', openingCash: 100000 })
  const order = await startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'K', shiftId: shift.id })
  await addOrderItem({ orderId: order.id, productId: 'p1', productName: 'Kopi', unitPrice: price, qty, modifiers: [], notes: '' })
  return { shift, order: (await db.orders.get(order.id))! }
}

beforeEach(async () => {
  await resetLocalDb()
  await db.categories.put({ id: 'c1', name: 'U', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })
})

describe('Bill & pembayaran sebagian', () => {
  it('pembayaran sebulat: bill PAID, order COMPLETED, stok terpotong sekali', async () => {
    await seedProduct({ stockQty: 10 })
    const { order } = await orderOf(2) // grandTotal 40000
    await finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: 40000 }], confirmedByUserId: 'u1' })
    const bill = await db.bills.get(implicitBillId(order.id))
    expect(bill?.paymentStatus).toBe('PAID')
    expect((await db.orders.get(order.id))?.lifecycleStatus).toBe('COMPLETED')
    expect((await db.products.get('p1'))?.stockQty).toBe(8)
  })

  it('pembayaran sebagian ditolak bila setelan mati', async () => {
    await seedProduct()
    const { order } = await orderOf(2)
    await expect(
      finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: 20000 }], confirmedByUserId: 'u1', allowPartial: false }),
    ).rejects.toBeInstanceOf(InsufficientPaymentError)
  })

  it('pembayaran sebagian → PARTIALLY_PAID, order belum selesai, stok belum terpotong; pelunasan menyelesaikan', async () => {
    await updateSettings({ allowPartialPayment: true })
    await seedProduct({ stockQty: 10 })
    const { order } = await orderOf(3) // 60000

    await finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: 25000 }], confirmedByUserId: 'u1', allowPartial: true })
    let bill = await db.bills.get(implicitBillId(order.id))
    expect(bill?.paymentStatus).toBe('PARTIALLY_PAID')
    expect(bill?.amountPaid).toBe(25000)
    expect((await db.orders.get(order.id))?.lifecycleStatus).not.toBe('COMPLETED')
    expect((await db.products.get('p1'))?.stockQty).toBe(10) // belum

    await finalizePayment({ orderId: order.id, payments: [{ method: 'qris', amount: 35000 }], confirmedByUserId: 'u1' })
    bill = await db.bills.get(implicitBillId(order.id))
    expect(bill?.paymentStatus).toBe('PAID')
    expect((await db.orders.get(order.id))?.lifecycleStatus).toBe('COMPLETED')
    expect((await db.products.get('p1'))?.stockQty).toBe(7)
  })

  it('split by nominal: dua bill, order selesai hanya bila keduanya lunas', async () => {
    await seedProduct({ stockQty: 10 })
    const { order } = await orderOf(5) // 100000
    const portion = await splitBillByAmount(order.id, 30000, 'Teman A')
    const bills = await listOrderBills(order.id)
    expect(bills).toHaveLength(2)
    expect(bills.reduce((s, b) => s + b.grandTotal, 0)).toBe(100000)

    await payBill({ billId: portion.id, payments: [{ method: 'cash', amount: 30000 }], confirmedByUserId: 'u1' })
    expect((await db.orders.get(order.id))?.lifecycleStatus).not.toBe('COMPLETED')

    await payBill({ billId: implicitBillId(order.id), payments: [{ method: 'cash', amount: 70000 }], confirmedByUserId: 'u1' })
    expect((await db.orders.get(order.id))?.lifecycleStatus).toBe('COMPLETED')
    expect((await db.products.get('p1'))?.stockQty).toBe(5)
  })

  it('klik bayar dua kali tetap satu pembayaran (id per bill deterministik)', async () => {
    await seedProduct({ stockQty: 10 })
    const { order } = await orderOf(1)
    const pay = () => finalizePayment({ orderId: order.id, payments: [{ method: 'qris', amount: 20000 }], confirmedByUserId: 'u1' })
    await pay()
    await expect(pay()).rejects.toThrow()
    expect(await db.payments.where('orderId').equals(order.id).count()).toBe(1)
  })
})
