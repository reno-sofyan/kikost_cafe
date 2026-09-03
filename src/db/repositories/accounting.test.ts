import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { addOrderItem, startOrder } from './orders'
import { openShift } from './shifts'
import { updateSettings } from './settings'
import { finalizePayment, voidOrder } from './checkout'
import { ACCOUNTS, buildAccountingExport } from './accounting'
import type { Product } from '@/types/domain'

const RANGE = { from: 0, to: Date.now() + 86_400_000 }

async function seedProduct(id: string, price: number, cost: number): Promise<void> {
  await db.products.put({
    id, categoryId: 'c1', name: id, sku: id, barcode: null, price, costPrice: cost, unit: 'pcs',
    photoDataUrl: null, trackOwnStock: true, stockQty: 100, lowStockThreshold: 0, isFavorite: false,
    isAvailable: true, modifierGroupIds: [], createdAt: 1, updatedAt: 1,
  } as Product)
}

beforeEach(async () => {
  await resetLocalDb()
  await db.categories.put({ id: 'c1', name: 'U', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })
})

function bal(exp: Awaited<ReturnType<typeof buildAccountingExport>>, account: string) {
  const r = exp.trialBalance.find((x) => x.account === account)
  return { debit: r?.debit ?? 0, credit: r?.credit ?? 0 }
}

describe('buildAccountingExport', () => {
  it('penjualan tunai dengan pajak & SC: jurnal seimbang, akun benar', async () => {
    await updateSettings({ taxPercent: 10, serviceChargePercent: 5, roundingIncrement: 1 })
    await seedProduct('kopi', 20000, 6000)
    const shift = await openShift({ cashierId: 'u1', cashierName: 'K', openingCash: 0 })
    const order = await startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'K', shiftId: shift.id })
    await addOrderItem({ orderId: order.id, productId: 'kopi', productName: 'kopi', unitPrice: 20000, qty: 2, modifiers: [], notes: '' })
    const o = (await db.orders.get(order.id))!
    await finalizePayment({ orderId: o.id, payments: [{ method: 'cash', amount: o.grandTotal }], confirmedByUserId: 'u1' })

    const exp = await buildAccountingExport(RANGE)
    expect(exp.totals.balanced).toBe(true)
    expect(bal(exp, ACCOUNTS.SALES).credit).toBe(40000)
    expect(bal(exp, ACCOUNTS.SERVICE_CHARGE).credit).toBe(2000)
    expect(bal(exp, ACCOUNTS.TAX_PAYABLE).credit).toBe(4200)
    expect(bal(exp, ACCOUNTS.CASH).debit).toBe(o.grandTotal)
    expect(bal(exp, ACCOUNTS.COGS).debit).toBe(12000)
    expect(bal(exp, ACCOUNTS.INVENTORY).credit).toBe(12000)
  })

  it('diskon → akun potongan penjualan di sisi debit; tetap seimbang', async () => {
    await updateSettings({ taxPercent: 0, serviceChargePercent: 0, roundingIncrement: 1 })
    await seedProduct('kopi', 20000, 0)
    const shift = await openShift({ cashierId: 'u1', cashierName: 'K', openingCash: 0 })
    const order = await startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'K', shiftId: shift.id })
    await addOrderItem({ orderId: order.id, productId: 'kopi', productName: 'kopi', unitPrice: 20000, qty: 1, modifiers: [], notes: '' })
    await db.orders.update(order.id, { discountType: 'amount', discountValue: 5000 })
    const { recalcOrderTotals } = await import('./orders')
    await recalcOrderTotals(order.id)
    const o = (await db.orders.get(order.id))!
    await finalizePayment({ orderId: o.id, payments: [{ method: 'cash', amount: o.grandTotal }], confirmedByUserId: 'u1' })

    const exp = await buildAccountingExport(RANGE)
    expect(exp.totals.balanced).toBe(true)
    expect(bal(exp, ACCOUNTS.DISCOUNT).debit).toBe(5000)
    expect(bal(exp, ACCOUNTS.SALES).credit).toBe(20000)
    expect(bal(exp, ACCOUNTS.CASH).debit).toBe(15000)
  })

  it('refund void masuk akun retur & mengurangi kas; jurnal tetap seimbang', async () => {
    await updateSettings({ taxPercent: 0, serviceChargePercent: 0, roundingIncrement: 1 })
    await seedProduct('kopi', 20000, 5000)
    const shift = await openShift({ cashierId: 'u1', cashierName: 'K', openingCash: 0 })
    const order = await startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'K', shiftId: shift.id })
    await addOrderItem({ orderId: order.id, productId: 'kopi', productName: 'kopi', unitPrice: 20000, qty: 1, modifiers: [], notes: '' })
    await finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: 20000 }], confirmedByUserId: 'u1' })
    await voidOrder({ orderId: order.id, reason: 'x', approverUserId: 's1', approverName: 'S' })

    const exp = await buildAccountingExport(RANGE)
    expect(exp.totals.balanced).toBe(true)
    expect(bal(exp, ACCOUNTS.REFUND).debit).toBe(20000)
    // kas: +20000 dari jual, -20000 dari refund
    expect(bal(exp, ACCOUNTS.CASH).debit).toBe(20000)
    expect(bal(exp, ACCOUNTS.CASH).credit).toBe(20000)
  })

  it('beban operasional → OPEX debit, kas kredit', async () => {
    await db.expenses.put({ id: 'e1', category: 'Listrik', amount: 150000, note: 'PLN', photoDataUrl: null, shiftId: null, userId: 'u1', createdAt: Date.now() })
    const exp = await buildAccountingExport(RANGE)
    expect(bal(exp, ACCOUNTS.OPEX).debit).toBe(150000)
    expect(bal(exp, ACCOUNTS.CASH).credit).toBe(150000)
    expect(exp.totals.balanced).toBe(true)
  })
})
