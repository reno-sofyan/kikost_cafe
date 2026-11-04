import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { addOrderItem, setOrderDiscount, setOrderVoucher, startOrder } from './orders'
import { clearOrderHppPricing, previewHppPricing, setOrderHppPricing } from './hppPricing'
import { openShift } from './shifts'
import { finalizePayment } from './checkout'
import { buildSalesReport } from './reports'
import { updateSettings } from './settings'
import { saveKol, savePromo } from './promos'
import { HppPricingBlockedError } from '@/lib/hppPricing'
import type { Product } from '@/types/domain'

const ACTOR = { userId: 'u1', userName: 'Kasir' }
const HOUR = 60 * 60 * 1000
let shiftId: string

function product(id: string, name: string, price: number, costPrice: number, extra: Partial<Product> = {}): Product {
  return {
    id, categoryId: 'c1', name, sku: id, barcode: null, price, costPrice, unit: 'pcs', photoDataUrl: null,
    trackOwnStock: false, stockQty: 0, lowStockThreshold: 0, isFavorite: false, isAvailable: true, modifierGroupIds: [], createdAt: 1, updatedAt: 1,
    ...extra,
  } as Product
}

beforeEach(async () => {
  await resetLocalDb()
  await db.categories.put({ id: 'c1', name: 'Kopi', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })
  await db.products.bulkPut([
    product('latte', 'Cafe Latte', 25000, 9000),
    product('roti', 'Roti Bakar', 18000, 6000),
    product('air', 'Air Mineral', 5000, 0),
    product('paket', 'Paket Hemat', 40000, 0, { comboItems: [{ productId: 'latte', qty: 1 }, { productId: 'roti', qty: 1 }] }),
  ])
  await updateSettings({ businessType: 'cafe_resto', taxPercent: 10, serviceChargePercent: 5, roundingIncrement: 1 })
  shiftId = (await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 0 })).id
})

async function openOrder(lines: [string, number, number?][]) {
  const order = await startOrder({ type: 'dine_in', cashierId: 'u1', cashierName: 'Kasir', shiftId })
  for (const [productId, qty, extra] of lines) {
    const p = (await db.products.get(productId))!
    await addOrderItem({ orderId: order.id, productId, productName: p.name, unitPrice: p.price, qty, notes: '', modifiers: extra ? [{ groupId: 'g', groupName: 'Tambahan', optionId: 'o', optionName: 'Extra shot', priceDelta: extra }] : [] })
  }
  return order.id
}
const order = async (id: string) => (await db.orders.get(id))!
const items = async (id: string) => db.orderItems.where('orderId').equals(id).toArray()

describe('Pesanan KOL / Compliment (harga HPP)', () => {
  it('semua item jadi HPP (modifier & pajak/service dinolkan), item baru ikut HPP, dan bisa dikembalikan ke harga jual', async () => {
    const id = await openOrder([['latte', 2, 5000], ['roti', 1]])
    const before = await order(id)
    expect(before.subtotal).toBe(78000)
    expect(before.grandTotal).toBeGreaterThan(78000) // pajak 10% + service 5%

    expect(await previewHppPricing(id)).toMatchObject({ hppTotal: 24000, missingHpp: [] })
    await setOrderHppPricing(id, { kind: 'compliment', kolId: null, name: 'Pak RT', reason: 'Tamu kehormatan' }, ACTOR)
    const o = await order(id)
    expect(o.hppPricing).toMatchObject({ kind: 'compliment', name: 'Pak RT', approvedByName: 'Kasir', requestedByName: 'Kasir' })
    expect(o).toMatchObject({ subtotal: 24000, taxPercent: 0, serviceChargePercent: 0, grandTotal: 24000 })
    const latte = (await items(id)).find((i) => i.productId === 'latte')!
    expect(latte).toMatchObject({ unitPrice: 9000, lineTotal: 18000, normalPrice: { unitPrice: 25000, modifierDeltas: [5000], discountAmount: 0 } })

    // Item yang ditambahkan setelahnya langsung HPP; paket tanpa HPP sendiri = HPP isinya.
    await addOrderItem({ orderId: id, productId: 'paket', productName: 'Paket Hemat', unitPrice: 40000, qty: 1, modifiers: [], notes: '' })
    expect((await order(id)).grandTotal).toBe(24000 + 15000)

    await clearOrderHppPricing(id, ACTOR)
    const back = await order(id)
    expect(back.hppPricing).toBeNull()
    expect(back).toMatchObject({ subtotal: 78000 + 40000, taxPercent: 10, serviceChargePercent: 5 })
    expect((await items(id)).find((i) => i.productId === 'latte')).toMatchObject({ unitPrice: 25000, lineTotal: 60000, normalPrice: null })
    const actions = (await db.auditLogs.toArray()).map((l) => l.action)
    expect(actions).toEqual(expect.arrayContaining(['order.hpp_pricing', 'order.hpp_pricing_remove']))
  })

  it('KOL dipilih dari daftar menu KOL; menu tanpa HPP dihargai Rp0 dan dilaporkan', async () => {
    await saveKol({ name: 'Dina Kuliner', platform: 'Instagram', handle: '@dina', phone: '', commissionPercent: 0, active: true, note: '' }, ACTOR)
    const kol = (await db.settings.get('singleton'))!.kols![0]
    const id = await openOrder([['latte', 1], ['air', 2]])
    expect((await previewHppPricing(id)).missingHpp).toEqual(['Air Mineral'])
    await setOrderHppPricing(id, { kind: 'kol', kolId: kol.id, name: '', reason: '' }, ACTOR)
    expect((await order(id)).hppPricing).toMatchObject({ kind: 'kol', kolId: kol.id, name: 'Dina Kuliner' })
    expect((await order(id)).grandTotal).toBe(9000)
  })

  it('tanpa PIN, tapi nama penerima & alasan compliment wajib, dan tak bisa setelah ada pembayaran', async () => {
    const id = await openOrder([['latte', 1]])
    await expect(setOrderHppPricing(id, { kind: 'compliment', kolId: null, name: 'X', reason: '' }, ACTOR)).rejects.toThrow(/alasan/)
    await expect(setOrderHppPricing(id, { kind: 'kol', kolId: null, name: ' ', reason: '' }, ACTOR)).rejects.toThrow(/KOL/)

    const paidId = await openOrder([['roti', 1]])
    await finalizePayment({ orderId: paidId, payments: [{ method: 'cash', amount: (await order(paidId)).grandTotal }], confirmedByUserId: 'u1' })
    await expect(setOrderHppPricing(paidId, { kind: 'compliment', kolId: null, name: 'X', reason: 'Tamu' }, ACTOR)).rejects.toThrow()
  })

  it('diskon, voucher & promo otomatis tidak berlaku pada pesanan HPP', async () => {
    await savePromo({ active: true, kind: 'percent', value: 50, scope: 'order', targetIds: [], name: 'Diskon 50%' }, ACTOR)
    await savePromo({ active: true, kind: 'percent', value: 10, scope: 'order', targetIds: [], name: 'Voucher', voucherCode: 'HEMAT' }, ACTOR)
    const id = await openOrder([['latte', 1]])
    expect((await order(id)).appliedPromos?.length).toBeGreaterThan(0)
    await setOrderHppPricing(id, { kind: 'compliment', kolId: null, name: 'Tamu', reason: 'Event' }, ACTOR)
    expect(await order(id)).toMatchObject({ appliedPromos: [], grandTotal: 9000 })
    await expect(setOrderDiscount(id, 'percent', 10)).rejects.toThrow(HppPricingBlockedError)
    await expect(setOrderVoucher(id, 'HEMAT')).rejects.toThrow(HppPricingBlockedError)
  })

  it('laporan penjualan memisahkan pesanan KOL/Compliment: dibayar (HPP) vs nilai jual', async () => {
    const id = await openOrder([['latte', 2], ['roti', 1]])
    await setOrderHppPricing(id, { kind: 'compliment', kolId: null, name: 'Tamu', reason: 'Event' }, ACTOR)
    await finalizePayment({ orderId: id, payments: [{ method: 'cash', amount: 24000 }], confirmedByUserId: 'u1' })
    const normal = await openOrder([['roti', 1]])
    await finalizePayment({ orderId: normal, payments: [{ method: 'cash', amount: (await order(normal)).grandTotal }], confirmedByUserId: 'u1' })
    const report = await buildSalesReport({ from: 0, to: Date.now() + HOUR })
    expect(report.hppPricing).toMatchObject({ count: 1, paid: 24000, normalValue: 68000 })
    expect(report.hppPricing.byKind).toEqual([expect.objectContaining({ kind: 'compliment', count: 1, paid: 24000, normalValue: 68000 })])
  })
})
