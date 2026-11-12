import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { ensureDefaultSettings, updateSettings } from './settings'
import { addOrderItem, markOrderPayLater, setOrderDiscount, setOrderMarketingBill, startOrder } from './orders'
import { listCustomers, listMarketingSales, saveMarketingSales, searchCustomers } from './customers'
import { setOrderHppPricing } from './hppPricing'
import { buildMarketingBillReport } from './marketingBills'
import { buildSalesReport } from './reports'
import { closeShift, openShift } from './shifts'
import { finalizePayment } from './checkout'

const actor = { userId: 'u1', userName: 'Kasir' }
const ALL_TIME = { from: 0, to: Date.now() + 86_400_000 }

beforeEach(async () => {
  await resetLocalDb()
  localStorage.clear()
  await ensureDefaultSettings()
  await updateSettings({ businessType: 'cafe_resto' })
  await db.categories.put({ id: 'c1', name: 'Kopi', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })
  await db.products.put({
    id: 'p1', categoryId: 'c1', name: 'Americano', sku: 'A1', barcode: null, price: 20000, costPrice: 6000,
    unit: 'pcs', photoDataUrl: null, trackOwnStock: false, stockQty: 0, lowStockThreshold: 0,
    isFavorite: false, isAvailable: true, modifierGroupIds: [], createdAt: 1, updatedAt: 1,
  })
})

async function newSales(name: string, active = true) {
  return saveMarketingSales(null, { name, phone: '0812', note: '', division: 'Marketing Korporat', photoDataUrl: null, active })
}

async function marketingOrder(salesId: string, shiftId: string) {
  const order = await startOrder({ type: 'dine_in', cashierId: 'u1', cashierName: 'Kasir', shiftId })
  await setOrderMarketingBill(order.id, { salesId, clientName: ' PT Maju ', purpose: 'meeting proyek' }, actor)
  await addOrderItem({ orderId: order.id, productId: 'p1', productName: 'Americano', unitPrice: 20000, qty: 2, modifiers: [], notes: '' })
  return order
}

describe('Tim Marketing (Pelanggan)', () => {
  it('sales tidak tampil sebagai pelanggan, nonaktif tak bisa dipilih', async () => {
    const budi = await newSales('Budi')
    const ani = await newSales('Ani', false)
    expect(await listCustomers()).toEqual([])
    expect(await searchCustomers('bud')).toEqual([])
    expect((await listMarketingSales()).map((s) => s.name)).toEqual(['Ani', 'Budi'])
    expect((await listMarketingSales(true)).map((s) => s.id)).toEqual([budi.id])
    expect(await db.syncQueue.where('entity').equals('customers').count()).toBeGreaterThan(0)

    const shift = await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 0 })
    const order = await startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'Kasir', shiftId: shift.id })
    await expect(setOrderMarketingBill(order.id, { salesId: ani.id, clientName: '', purpose: '' }, actor)).rejects.toThrow('nonaktif')
  })
})

describe('Tagihan Marketing', () => {
  it('harga normal + diskon, disimpan sebagai tagihan tertunda atas nama sales, dilaporkan terpisah', async () => {
    const budi = await newSales('Budi')
    const shift = await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 0 })
    const order = await marketingOrder(budi.id, shift.id)
    await setOrderDiscount(order.id, 'amount', 2000, { reason: 'klien langganan', actor })
    await markOrderPayLater(order.id, { name: '', note: '', shiftId: shift.id }, actor)

    const saved = (await db.orders.get(order.id))!
    expect(saved.payLater?.name).toBe('Budi')
    expect(saved.marketingBill).toMatchObject({ salesName: 'Budi', salesDivision: 'Marketing Korporat', clientName: 'PT Maju', purpose: 'meeting proyek' })
    // Tak menghalangi tutup shift; masuk omzet sebagai piutang.
    await closeShift({ shiftId: shift.id, closingCashActual: 0, notes: '' })
    const sales = await buildSalesReport(ALL_TIME)
    expect(sales.receivableTotal).toBe(saved.grandTotal)

    let report = await buildMarketingBillReport(ALL_TIME)
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]).toMatchObject({ salesName: 'Budi', clientName: 'PT Maju', status: 'unpaid', discountAmount: 2000, itemsLabel: '2× Americano' })
    expect(report.outstanding).toBe(saved.grandTotal)
    expect(report.bySales).toEqual([expect.objectContaining({ salesId: budi.id, count: 1, outstanding: saved.grandTotal })])

    await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 0 })
    await finalizePayment({ orderId: order.id, payments: [{ method: 'transfer', amount: saved.grandTotal }], confirmedByUserId: 'u1' })
    report = await buildMarketingBillReport(ALL_TIME)
    expect(report.rows[0].status).toBe('settled')
    expect(report.outstanding).toBe(0)
  })

  it('pesanan marketing yang belum disimpan belum diakui; dibayar langsung tercatat terpisah', async () => {
    const budi = await newSales('Budi')
    const shift = await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 0 })
    const order = await marketingOrder(budi.id, shift.id)
    expect((await buildMarketingBillReport(ALL_TIME)).rows).toHaveLength(0)
    const total = (await db.orders.get(order.id))!.grandTotal
    await finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: total }], confirmedByUserId: 'u1' })
    expect((await buildMarketingBillReport(ALL_TIME)).rows[0].status).toBe('direct')
  })
})

describe('Kalibrasi', () => {
  it('dihargai HPP atas nama kasir bila nama kosong', async () => {
    const shift = await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 0 })
    const order = await startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'Kasir', shiftId: shift.id })
    await setOrderHppPricing(order.id, { kind: 'calibration', kolId: null, name: '', reason: 'kalibrasi espresso' }, actor)
    await addOrderItem({ orderId: order.id, productId: 'p1', productName: 'Americano', unitPrice: 20000, qty: 1, modifiers: [], notes: '' })
    const saved = (await db.orders.get(order.id))!
    expect(saved.hppPricing).toMatchObject({ kind: 'calibration', name: 'Kasir', reason: 'kalibrasi espresso' })
    expect(saved.grandTotal).toBe(6000)
  })
})
