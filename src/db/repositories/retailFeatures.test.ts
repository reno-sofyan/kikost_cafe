import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { finalizePayment, returnOrderItems } from '@/db/repositories/checkout'
import { addOrderItem, getOrder, startOrder } from '@/db/repositories/orders'
import { openShift, getOpenShift } from '@/db/repositories/shifts'
import { updateSettings } from '@/db/repositories/settings'
import { createPurchase, createSupplierReturn, receivePurchase, recordPurchasePayment, saveSupplier } from '@/db/repositories/purchasing'
import { listHeldOrders, resolveScanCode, setRetailItemQty, stackableLine } from '@/db/repositories/retail'
import { buildRetailInsights } from '@/db/repositories/retailInsights'
import { adjustProductStock } from '@/db/repositories/stock'
import { buildSalesReport } from '@/db/repositories/reports'
import { ean13CheckDigit } from '@/lib/retailPricing'
import type { Product } from '@/types/domain'

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'mie',
    categoryId: 'c1',
    name: 'Mie Goreng',
    sku: 'MIE-1',
    barcode: '8990000000011',
    price: 3500,
    costPrice: 2800,
    unit: 'pcs',
    photoDataUrl: null,
    trackOwnStock: true,
    stockQty: 100,
    lowStockThreshold: 10,
    isFavorite: false,
    isAvailable: true,
    modifierGroupIds: [],
    sellUnits: [{ id: 'dus', name: 'Dus', qty: 40, price: 120_000, barcode: '8990000000028' }],
    tierPrices: [{ minQty: 10, price: 3200 }],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

let shiftId = ''
beforeEach(async () => {
  await resetLocalDb()
  await updateSettings({ businessType: 'minimarket' })
  await db.categories.put({ id: 'c1', name: 'Mie', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })
  await db.products.add(product())
  shiftId = (await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 100_000 })).id
})

async function newOrder() {
  return startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'Kasir', shiftId })
}

describe('kasir ritel: satuan jual, grosir, timbangan', () => {
  it('pindai barcode dus → satuan Dus; stok dipotong isi × qty; laporan pakai satuan dasar', async () => {
    const match = (await resolveScanCode('8990000000028'))!
    expect(match.sellUnit?.name).toBe('Dus')
    const order = await newOrder()
    await addOrderItem({ orderId: order.id, productId: 'mie', productName: 'Mie Goreng · Dus (40)', unitPrice: 120_000, qty: 2, modifiers: [], notes: '', sellUnit: { id: 'dus', name: 'Dus', qty: 40 } })
    expect((await getOrder(order.id))!.grandTotal).toBe(240_000)
    await finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: 240_000, receivedAmount: 240_000 }], confirmedByUserId: 'u1' })
    expect((await db.products.get('mie'))!.stockQty).toBe(20)
    const report = await buildSalesReport({ from: 0, to: Date.now() + 1000 })
    expect(report.allProductSales[0]).toMatchObject({ qtySold: 80, costTotal: 80 * 2800 })
  })

  it('retur item dus mengembalikan stok sebanyak isinya', async () => {
    const order = await newOrder()
    const item = await addOrderItem({ orderId: order.id, productId: 'mie', productName: 'Mie · Dus', unitPrice: 120_000, qty: 1, modifiers: [], notes: '', sellUnit: { id: 'dus', name: 'Dus', qty: 40 } })
    await finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: 120_000, receivedAmount: 120_000 }], confirmedByUserId: 'u1' })
    expect((await db.products.get('mie'))!.stockQty).toBe(60)
    await returnOrderItems({ orderId: order.id, orderItemIds: [item.id], reason: 'rusak', restock: true, approverUserId: 'u1', approverName: 'Pemilik' })
    expect((await db.products.get('mie'))!.stockQty).toBe(100)
  })

  it('harga grosir naik-turun mengikuti qty baris', async () => {
    const order = await newOrder()
    const item = await addOrderItem({ orderId: order.id, productId: 'mie', productName: 'Mie Goreng', unitPrice: 3500, qty: 1, modifiers: [], notes: '' })
    await setRetailItemQty(item.id, 10)
    let row = (await db.orderItems.get(item.id))!
    expect([row.unitPrice, row.lineTotal, row.tierApplied]).toEqual([3200, 32_000, true])
    await setRetailItemQty(item.id, 9)
    row = (await db.orderItems.get(item.id))!
    expect([row.unitPrice, row.lineTotal, row.tierApplied]).toEqual([3500, 31_500, false])
    expect((await getOrder(order.id))!.grandTotal).toBe(31_500)
    expect(stackableLine([row], 'mie', null)?.id).toBe(item.id)
    expect(stackableLine([row], 'mie', 'dus')).toBeUndefined()
  })

  it('barcode timbangan: PLU + berat → qty kg, total dibulatkan rupiah', async () => {
    await db.products.add(product({ id: 'tomat', name: 'Tomat', sku: 'TMT', barcode: null, unit: 'kg', price: 18_000, sellUnits: [], tierPrices: [], scaleCode: '123', stockQty: 10 }))
    const first12 = '200012300354'
    const code = first12 + ean13CheckDigit(first12)
    expect(await resolveScanCode(code)).toBeUndefined() // belum diaktifkan
    await updateSettings({ scaleBarcode: { enabled: true, prefix: '2', flagLength: 2, pluLength: 5, valueKind: 'weight' } })
    const match = (await resolveScanCode(code))!
    expect(match).toMatchObject({ qty: 0.354, weighed: true })
    expect(match.product.id).toBe('tomat')
    const order = await newOrder()
    const item = await addOrderItem({ orderId: order.id, productId: 'tomat', productName: 'Tomat', unitPrice: 18_000, qty: match.qty, modifiers: [], notes: '' })
    expect(item.lineTotal).toBe(6372)
    // Total pesanan bisa terkena pembulatan toko — bayar sebesar tagihan.
    const due = (await getOrder(order.id))!.grandTotal
    await finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: due, receivedAmount: 10_000 }], confirmedByUserId: 'u1' })
    expect((await db.products.get('tomat'))!.stockQty).toBe(9.646)
  })

  it('transaksi ditahan tampil di daftar, yang kosong tidak', async () => {
    const held = await newOrder()
    await addOrderItem({ orderId: held.id, productId: 'mie', productName: 'Mie', unitPrice: 3500, qty: 1, modifiers: [], notes: '' })
    const empty = await newOrder()
    const current = await newOrder()
    const list = await listHeldOrders(shiftId, current.id)
    expect(list.map((o) => o.id)).toEqual([held.id])
    expect(list.map((o) => o.id)).not.toContain(empty.id)
  })

  it('bayar campur tunai + QRIS', async () => {
    const order = await newOrder()
    await addOrderItem({ orderId: order.id, productId: 'mie', productName: 'Mie', unitPrice: 3500, qty: 4, modifiers: [], notes: '' })
    await finalizePayment({
      orderId: order.id,
      payments: [
        { method: 'cash', amount: 10_000, receivedAmount: 10_000 },
        { method: 'qris', amount: 4000 },
      ],
      confirmedByUserId: 'u1',
    })
    expect((await getOrder(order.id))!.status).not.toBe('open')
    const pays = await db.payments.where('orderId').equals(order.id).toArray()
    expect(pays.map((p) => [p.method, p.amount]).sort()).toEqual([
      ['cash', 10_000],
      ['qris', 4000],
    ])
  })
})

describe('promo & member aktif untuk minimarket', () => {
  it('promo harga paket terpasang otomatis di pesanan', async () => {
    await updateSettings({
      promos: [{ id: 'pk', name: '3 mie 10rb', active: true, kind: 'bundle', value: 10_000, buyQty: 3, scope: 'product', targetIds: ['mie'], orderTypes: ['takeaway'], createdAt: 1, updatedAt: 1 }],
    })
    const order = await newOrder()
    await addOrderItem({ orderId: order.id, productId: 'mie', productName: 'Mie', unitPrice: 3500, qty: 3, modifiers: [], notes: '' })
    const o = (await getOrder(order.id))!
    expect(o.appliedPromos?.[0]).toMatchObject({ promoId: 'pk', amount: 500 })
    expect(o.grandTotal).toBe(10_000)
  })
})

describe('pembelian: HPP rata-rata, hutang, retur', () => {
  it('HPP rata-rata tertimbang saat terima barang', async () => {
    // stok 100 @2.800 + 100 @3.200 → 3.000
    const po = await createPurchase({ supplierName: 'PT A', invoiceNo: '', note: '', createdBy: 'u1', lines: [{ itemType: 'product', itemId: 'mie', itemName: 'Mie', qty: 100, unit: 'pcs', unitCost: 3200 }] })
    await receivePurchase({ purchaseId: po.id, receivedBy: 'u1', receivedByName: 'A' })
    expect((await db.products.get('mie'))!).toMatchObject({ stockQty: 200, costPrice: 3000 })
  })

  it('tempo → hutang; bayar dari laci kas mengurangi kas seharusnya', async () => {
    const s = await saveSupplier({ name: 'PT Sumber', phone: '', address: '', termDays: 14, note: '', active: true })
    const po = await createPurchase({ supplierName: s.name, supplierId: s.id, invoiceNo: 'F-1', note: '', createdBy: 'u1', lines: [{ itemType: 'product', itemId: 'mie', itemName: 'Mie', qty: 10, unit: 'pcs', unitCost: 3000 }] })
    const received = await receivePurchase({ purchaseId: po.id, receivedBy: 'u1', receivedByName: 'A', termDays: 14 })
    expect(received.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const before = (await getOpenShift())!.expectedCash
    await recordPurchasePayment({ purchaseId: po.id, amount: 10_000, method: 'cash', fromDrawer: true, note: '', actor: { userId: 'u1', userName: 'A' } })
    expect((await getOpenShift())!.expectedCash).toBe(before - 10_000)
    await expect(recordPurchasePayment({ purchaseId: po.id, amount: 50_000, method: 'transfer', fromDrawer: false, note: '', actor: { userId: 'u1', userName: 'A' } })).rejects.toThrow(/Melebihi/)
    const paid = await recordPurchasePayment({ purchaseId: po.id, amount: 20_000, method: 'transfer', fromDrawer: false, note: '', actor: { userId: 'u1', userName: 'A' } })
    expect(paid.payments).toHaveLength(2)
    await expect(recordPurchasePayment({ purchaseId: po.id, amount: 1, method: 'transfer', fromDrawer: false, note: '', actor: { userId: 'u1', userName: 'A' } })).rejects.toThrow(/tidak punya sisa/)
  })

  it('nama pemasok ganda ditolak', async () => {
    await saveSupplier({ name: 'PT Sumber', phone: '', address: '', termDays: 0, note: '', active: true })
    await expect(saveSupplier({ name: 'pt sumber', phone: '', address: '', termDays: 0, note: '', active: true })).rejects.toThrow(/sudah ada/)
  })

  it('retur ke pemasok: stok keluar dari batch yang dipilih, tak boleh melebihi stok', async () => {
    await adjustProductStock({ productId: 'mie', qtyDelta: 5, reason: 'stock_in', userId: 'u1', expiryDate: '2026-11-05' })
    const batch = (await db.products.get('mie'))!.expiryBatches!.find((b) => b.expiryDate === '2026-11-05')!
    const doc = await createSupplierReturn({ supplierName: 'PT A', settlement: 'debt', note: 'exp', lines: [{ productId: 'mie', qty: 5, unitCost: 2800, batchId: batch.id }], actor: { userId: 'u1', userName: 'A' } })
    expect(doc).toMatchObject({ docType: 'return', status: 'received', totalCost: 14_000 })
    const p = (await db.products.get('mie'))!
    expect(p.stockQty).toBe(100)
    expect(p.expiryBatches?.some((b) => b.expiryDate === '2026-11-05')).toBeFalsy()
    const mv = await db.stockMovements.filter((m) => m.refId === doc.id).first()
    expect(mv?.reason).toBe('supplier_return')
    await expect(createSupplierReturn({ supplierName: 'PT A', settlement: 'refund', note: '', lines: [{ productId: 'mie', qty: 999, unitCost: 1 }], actor: { userId: 'u1', userName: 'A' } })).rejects.toThrow(/hanya/)
  })
})

describe('analisis toko', () => {
  it('ABC, margin, stok mati, dan kontrol kasir', async () => {
    await db.products.add(product({ id: 'diam', name: 'Barang Diam', sku: 'D', barcode: null, sellUnits: [], tierPrices: [], stockQty: 7, costPrice: 1000 }))
    const order = await newOrder()
    await addOrderItem({ orderId: order.id, productId: 'mie', productName: 'Mie', unitPrice: 3500, qty: 2, modifiers: [], notes: '' })
    await finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: 7000, receivedAmount: 7000 }], confirmedByUserId: 'u1' })
    const r = await buildRetailInsights({ from: 0, to: Date.now() + 1000 })
    expect(r.products[0]).toMatchObject({ productId: 'mie', abc: 'A', qty: 2, revenue: 7000, cost: 5600, profit: 1400, marginPercent: 20 })
    expect(r.categories[0]).toMatchObject({ name: 'Mie', marginPercent: 20 })
    expect(r.deadStock.map((d) => d.productId)).toEqual(['diam'])
    expect(r.deadStockValue).toBe(7000)
    expect(r.cashiers[0]).toMatchObject({ name: 'Kasir', transactions: 1, revenue: 7000 })
  })
})
