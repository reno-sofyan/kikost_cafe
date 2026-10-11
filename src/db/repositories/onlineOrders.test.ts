import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { addOrderItem, startOrder } from './orders'
import { buildShiftSummary, openShift } from './shifts'
import { finalizePayment } from './checkout'
import { buildSalesReport } from './reports'
import { buildAccountingExport } from './accounting'
import { createExpense } from './expenses'
import { updateSettings } from './settings'
import { onlineChannelLabel, onlineCommissionOf, productPriceFor } from '@/lib/onlineOrders'
import type { OnlinePlatform, PaymentMethod, Product } from '@/types/domain'

const HOUR = 60 * 60 * 1000
const ALL_TIME = () => ({ from: 0, to: Date.now() + HOUR })

let shiftId: string

beforeEach(async () => {
  await resetLocalDb()
  await db.categories.put({ id: 'c1', name: 'U', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })
  await db.products.put({
    id: 'p1', categoryId: 'c1', name: 'Kopi', sku: 'K1', barcode: null,
    price: 20000, onlinePrice: 25000, costPrice: 5000, unit: 'pcs', photoDataUrl: null,
    trackOwnStock: true, stockQty: 100, lowStockThreshold: 0,
    isFavorite: false, isAvailable: true, modifierGroupIds: [], createdAt: 1, updatedAt: 1,
  } as Product)
  await updateSettings({ taxPercent: 10, serviceChargePercent: 5, roundingIncrement: 500, onlineCommissionPercent: { gofood: 20 } })
  shiftId = (await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 100000 })).id
})

/** Pesanan lunas: online memakai Harga Online & dibayar via aplikasi; offline tunai. */
async function paidOrder(opts: { platform?: OnlinePlatform; ref?: string; qty?: number; method?: PaymentMethod } = {}) {
  const online = !!opts.platform
  const product = (await db.products.get('p1'))!
  const order = await startOrder({
    type: online ? 'delivery' : 'takeaway',
    onlinePlatform: opts.platform,
    onlineOrderRef: opts.ref,
    cashierId: 'u1', cashierName: 'Kasir', shiftId,
  })
  await addOrderItem({
    orderId: order.id, productId: 'p1', productName: 'Kopi',
    unitPrice: productPriceFor(product, online), qty: opts.qty ?? 2, modifiers: [], notes: '',
  })
  const fresh = (await db.orders.get(order.id))!
  await finalizePayment({
    orderId: order.id,
    payments: [{ method: opts.method ?? (online ? 'platform' : 'cash'), amount: fresh.grandTotal }],
    confirmedByUserId: 'u1',
  })
  return (await db.orders.get(order.id))!
}

describe('Pesanan online — harga & total', () => {
  it('memakai Harga Online; kosong/0 kembali ke harga jual', () => {
    expect(productPriceFor({ price: 20000, onlinePrice: 25000 }, true)).toBe(25000)
    expect(productPriceFor({ price: 20000, onlinePrice: 25000 }, false)).toBe(20000)
    expect(productPriceFor({ price: 20000, onlinePrice: null }, true)).toBe(20000)
    expect(productPriceFor({ price: 20000, onlinePrice: 0 }, true)).toBe(20000)
  })

  it('total mengikuti aplikasi: tanpa pajak, service charge, & pembulatan; komisi di-snapshot', async () => {
    const order = await paidOrder({ platform: 'gofood', ref: ' F-123 ', qty: 2 })
    expect(order.subtotal).toBe(50000)
    expect(order.taxAmount).toBe(0)
    expect(order.serviceChargeAmount).toBe(0)
    expect(order.roundingAdjustment).toBe(0)
    expect(order.grandTotal).toBe(50000)
    expect(order.onlinePlatform).toBe('gofood')
    expect(order.onlineOrderRef).toBe('F-123')
    expect(order.onlineCommissionPercent).toBe(20)
    expect(onlineChannelLabel(order)).toBe('GoFood #F-123')
    expect(onlineCommissionOf(order)).toBe(10000)

    // Mengubah komisi di pengaturan tidak menggeser pesanan yang sudah tercatat.
    await updateSettings({ onlineCommissionPercent: { gofood: 30 } })
    expect(onlineCommissionOf((await db.orders.get(order.id))!)).toBe(10000)
  })

  it('pesanan toko tetap kena pajak & service charge dan tidak punya data platform', async () => {
    const order = await paidOrder({ qty: 2 })
    expect(order.subtotal).toBe(40000)
    expect(order.taxAmount).toBeGreaterThan(0)
    expect(order.serviceChargeAmount).toBeGreaterThan(0)
    expect(order.onlinePlatform ?? null).toBeNull()
    expect(onlineChannelLabel(order)).toBe('')
    expect(onlineCommissionOf(order)).toBe(0)
  })

  it('pesanan online tanpa platform dicatat sebagai "Online Lainnya" dengan komisi 0', async () => {
    const order = await startOrder({ type: 'delivery', cashierId: 'u1', cashierName: 'Kasir', shiftId })
    expect(order.onlinePlatform).toBe('other')
    expect(order.onlineCommissionPercent).toBe(0)
    expect(onlineChannelLabel(order)).toBe('Online Lainnya')
  })
})

describe('Pesanan online — kas shift & jurnal', () => {
  it('bayar via aplikasi tak menyentuh kas; tercatat sebagai penjualan platform & piutang', async () => {
    await paidOrder({ platform: 'grabfood' })
    expect((await db.shifts.get(shiftId))?.expectedCash).toBe(100000)
    const summary = await buildShiftSummary(shiftId)
    expect(summary.cashSales).toBe(0)
    expect(summary.platformSales).toBe(50000)

    const journal = await buildAccountingExport(ALL_TIME())
    expect(journal.totals.balanced).toBe(true)
    const receivable = journal.trialBalance.find((a) => a.account.includes('Piutang Platform'))
    expect(receivable?.debit).toBe(50000)
  })
})

describe('Laporan per kanal: toko, online, keseluruhan', () => {
  beforeEach(async () => {
    await paidOrder({ qty: 2 }) // toko
    await paidOrder({ platform: 'gofood', qty: 2 }) // komisi 20% → 10.000
    await paidOrder({ platform: 'shopeefood', qty: 1 }) // komisi belum diatur → 0
    await createExpense({ category: 'Listrik', amount: 7000, note: '', shiftId, userId: 'u1' })
  })

  it('laporan online: hanya pesanan online, rekap per platform, tanpa pengeluaran', async () => {
    const r = await buildSalesReport(ALL_TIME(), 'online')
    expect(r.scope).toBe('online')
    expect(r.transactionCount).toBe(2)
    expect(r.revenue).toBe(75000)
    expect(r.byOrderType.map((t) => t.type)).toEqual(['delivery'])
    expect(r.byPaymentMethod).toEqual([{ method: 'platform', amount: 75000, count: 2 }])
    expect(r.byPlatform).toEqual([
      { platform: 'gofood', revenue: 50000, transactionCount: 1, commission: 10000, net: 40000 },
      { platform: 'shopeefood', revenue: 25000, transactionCount: 1, commission: 0, net: 25000 },
    ])
    expect(r.onlineCommissionTotal).toBe(10000)
    expect(r.onlineNetReceived).toBe(65000)
    expect(r.taxTotal).toBe(0)
    expect(r.expenseTotal).toBe(0)
    // 3 kopi × (25.000 − 5.000) − komisi 10.000
    expect(r.grossMargin).toBe(60000)
    expect(r.operatingProfit).toBe(50000)
  })

  it('laporan dine-in & takeaway: tanpa pesanan online, komisi, maupun pengeluaran', async () => {
    const r = await buildSalesReport(ALL_TIME(), 'offline')
    expect(r.transactionCount).toBe(1)
    expect(r.grossSales).toBe(40000)
    expect(r.byPlatform).toEqual([])
    expect(r.onlineCommissionTotal).toBe(0)
    expect(r.channelSplit.online).toEqual({ revenue: 0, transactionCount: 0 })
    expect(r.byPaymentMethod.map((m) => m.method)).toEqual(['cash'])
    expect(r.expenseTotal).toBe(0)
    expect(r.operatingProfit).toBe(r.grossMargin)
  })

  it('laporan keseluruhan = toko + online, dengan komisi & pengeluaran memotong laba operasional', async () => {
    const [all, offline, online] = await Promise.all([
      buildSalesReport(ALL_TIME()),
      buildSalesReport(ALL_TIME(), 'offline'),
      buildSalesReport(ALL_TIME(), 'online'),
    ])
    expect(all.scope).toBe('all')
    expect(all.transactionCount).toBe(3)
    expect(all.revenue).toBe(offline.revenue + online.revenue)
    expect(all.grossSales).toBe(offline.grossSales + online.grossSales)
    expect(all.grossMargin).toBe(offline.grossMargin + online.grossMargin)
    expect(all.channelSplit).toEqual({
      offline: { revenue: offline.revenue, transactionCount: 1 },
      online: { revenue: 75000, transactionCount: 2 },
    })
    expect(all.byPlatform).toEqual(online.byPlatform)
    expect(all.expenseTotal).toBe(7000)
    expect(all.operatingProfit).toBe(all.grossMargin - 10000 - 7000)
  })
})
