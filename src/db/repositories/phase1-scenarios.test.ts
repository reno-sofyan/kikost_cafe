import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { addOrderItem, NoActiveShiftError, removeOrderItem, startOrder, voidOrderItem } from './orders'
import { finalizePayment, InsufficientStockError, returnOrderItems, voidOrder } from './checkout'
import { closeShift, CashVarianceApprovalRequiredError, openShift } from './shifts'
import { updateSettings } from './settings'
import type { Product, Recipe } from '@/types/domain'

async function seedProduct(p: Partial<Product> = {}): Promise<Product> {
  const product: Product = {
    id: p.id ?? 'p1', categoryId: 'c1', name: p.name ?? 'Es Kopi', sku: p.sku ?? 'SKU1', barcode: null,
    price: p.price ?? 20000, costPrice: p.costPrice ?? 8000, unit: 'pcs', photoDataUrl: null,
    trackOwnStock: p.trackOwnStock ?? true, stockQty: p.stockQty ?? 100, lowStockThreshold: 2,
    isFavorite: false, isAvailable: true, modifierGroupIds: [], createdAt: 1, updatedAt: 1, ...p,
  }
  await db.products.put(product)
  return product
}

async function newOrderWithShift() {
  const shift = await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 100000 })
  const order = await startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'Kasir', shiftId: shift.id })
  return { shift, order }
}

beforeEach(async () => {
  await resetLocalDb()
  await db.categories.put({ id: 'c1', name: 'Umum', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })
})

describe('Skenario wajib — Fase 1', () => {
  it('kasir tidak dapat membuat pesanan tanpa shift aktif', async () => {
    await expect(
      startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'Kasir', shiftId: 'tidak-ada' }),
    ).rejects.toBeInstanceOf(NoActiveShiftError)
  })

  it('klik bayar dua kali menghasilkan satu pembayaran (id deterministik)', async () => {
    await seedProduct({ stockQty: 10 })
    const { order } = await newOrderWithShift()
    await addOrderItem({ orderId: order.id, productId: 'p1', productName: 'Es Kopi', unitPrice: 20000, qty: 1, modifiers: [], notes: '' })
    const pay = () => finalizePayment({ orderId: order.id, payments: [{ method: 'qris', amount: 20000 }], confirmedByUserId: 'u1' })
    await pay()
    await expect(pay()).rejects.toThrow()
    expect(await db.payments.where('orderId').equals(order.id).count()).toBe(1)
  })

  it('menghapus item yang belum ke dapur = soft-delete (removed), bukan hard delete', async () => {
    await seedProduct({ stockQty: 10 })
    const { order } = await newOrderWithShift()
    const item = await addOrderItem({ orderId: order.id, productId: 'p1', productName: 'Es Kopi', unitPrice: 20000, qty: 1, modifiers: [], notes: '' })
    await removeOrderItem(item.id)
    const stored = await db.orderItems.get(item.id)
    expect(stored).toBeDefined()
    expect(stored?.removed).toBe(true)
    expect((await db.orders.get(order.id))?.subtotal).toBe(0)
  })

  it('membatalkan item yang sudah ke dapur butuh approver + menulis audit log tersinkron', async () => {
    await seedProduct({ stockQty: 10 })
    const { order } = await newOrderWithShift()
    const item = await addOrderItem({ orderId: order.id, productId: 'p1', productName: 'Es Kopi', unitPrice: 20000, qty: 1, modifiers: [], notes: '' })
    await db.orderItems.update(item.id, { kitchenStatus: 'in_progress' })

    await expect(voidOrderItem(item.id, 'salah pesan')).rejects.toThrow()
    await voidOrderItem(item.id, 'salah pesan', { userId: 'sup1', userName: 'Supervisor' })

    expect((await db.orderItems.get(item.id))?.voided).toBe(true)
    const audit = await db.auditLogs.where('action').equals('orderItem.void').toArray()
    expect(audit).toHaveLength(1)
    // C1 — audit log ikut antre sinkronisasi
    const q = await db.syncQueue.where('entity').equals('auditLogs').toArray()
    expect(q.some((e) => e.entityId === audit[0].id)).toBe(true)
  })

  it('pembayaran diblokir bila stok tidak cukup; lolos dengan approval supervisor', async () => {
    await seedProduct({ id: 'p-recipe', trackOwnStock: false })
    await db.ingredients.put({ id: 'i1', name: 'Susu', unit: 'ml', stockQty: 100, lowStockThreshold: 10, costPerUnit: 20, createdAt: 1, updatedAt: 1 })
    const recipe: Recipe = { id: 'r1', productId: 'p-recipe', items: [{ ingredientId: 'i1', qty: 150 }], updatedAt: 1 }
    await db.recipes.put(recipe)
    const { order } = await newOrderWithShift()
    await addOrderItem({ orderId: order.id, productId: 'p-recipe', productName: 'Latte', unitPrice: 20000, qty: 1, modifiers: [], notes: '' })

    await expect(
      finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: 20000 }], confirmedByUserId: 'u1' }),
    ).rejects.toBeInstanceOf(InsufficientStockError)

    await finalizePayment({
      orderId: order.id,
      payments: [{ method: 'cash', amount: 20000 }],
      confirmedByUserId: 'u1',
      allowNegativeStock: { approverUserId: 'sup1', approverName: 'Supervisor' },
    })
    expect((await db.ingredients.get('i1'))?.stockQty).toBe(-50)
    expect(await db.auditLogs.where('action').equals('stock.negative.override').count()).toBe(1)
  })

  it('refund kumulatif tidak melebihi nilai transaksi asli', async () => {
    await seedProduct({ stockQty: 10, price: 10000 })
    const { order } = await newOrderWithShift()
    await addOrderItem({ orderId: order.id, productId: 'p1', productName: 'Es Kopi', unitPrice: 10000, qty: 2, modifiers: [], notes: '' })
    await finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: 20000 }], confirmedByUserId: 'u1' })
    const items = await db.orderItems.where('orderId').equals(order.id).toArray()

    await returnOrderItems({ orderId: order.id, orderItemIds: [items[0].id], reason: 'r1', restock: false, approverUserId: 'sup1', approverName: 'Sup' })
    // item kedua tak ada — retur ulang item pertama sudah voided → ditolak
    await expect(
      returnOrderItems({ orderId: order.id, orderItemIds: [items[0].id], reason: 'r2', restock: false, approverUserId: 'sup1', approverName: 'Sup' }),
    ).rejects.toThrow()
    const refunds = (await db.payments.where('orderId').equals(order.id).toArray()).filter((p) => p.amount < 0)
    expect(refunds.reduce((s, p) => s + Math.abs(p.amount), 0)).toBeLessThanOrEqual(20000)
  })

  it('perubahan resep tidak mengubah histori transaksi lama', async () => {
    await seedProduct({ id: 'p-recipe', trackOwnStock: false, price: 18000 })
    await db.ingredients.put({ id: 'i1', name: 'Susu', unit: 'ml', stockQty: 1000, lowStockThreshold: 10, costPerUnit: 20, createdAt: 1, updatedAt: 1 })
    await db.recipes.put({ id: 'r1', productId: 'p-recipe', items: [{ ingredientId: 'i1', qty: 100 }], updatedAt: 1 })
    const { order } = await newOrderWithShift()
    const item = await addOrderItem({ orderId: order.id, productId: 'p-recipe', productName: 'Latte', unitPrice: 18000, qty: 1, modifiers: [], notes: '' })
    await finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: 18000 }], confirmedByUserId: 'u1' })
    const before = await db.orderItems.get(item.id)

    // ubah resep & harga master
    await db.recipes.put({ id: 'r1', productId: 'p-recipe', items: [{ ingredientId: 'i1', qty: 999 }], updatedAt: 2 })
    await db.products.update('p-recipe', { price: 25000 })

    const after = await db.orderItems.get(item.id)
    expect(after?.unitPrice).toBe(before?.unitPrice)
    expect(after?.lineTotal).toBe(before?.lineTotal)
    expect((await db.orders.get(order.id))?.grandTotal).toBe(18000)
  })

  it('tutup shift: expected cash & variance benar; selisih > toleransi butuh approval', async () => {
    await updateSettings({ cashVarianceTolerance: 1000 })
    await seedProduct({ stockQty: 10, price: 30000 })
    const { shift, order } = await newOrderWithShift()
    await addOrderItem({ orderId: order.id, productId: 'p1', productName: 'Es Kopi', unitPrice: 30000, qty: 1, modifiers: [], notes: '' })
    await finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: 30000, receivedAmount: 30000 }], confirmedByUserId: 'u1' })

    const reloaded = await db.shifts.get(shift.id)
    expect(reloaded?.expectedCash).toBe(130000) // modal 100k + tunai 30k

    await expect(
      closeShift({ shiftId: shift.id, closingCashActual: 125000, notes: '' }),
    ).rejects.toBeInstanceOf(CashVarianceApprovalRequiredError)

    const closed = await closeShift({
      shiftId: shift.id,
      closingCashActual: 125000,
      notes: '',
      varianceApprover: { userId: 'sup1', userName: 'Sup' },
    })
    expect(closed.variance).toBe(-5000)
    expect(closed.varianceApprovedBy).toBe('sup1')
  })

  it('void order dibayar membuat transaksi pembalik; stok tidak kembali tanpa restock', async () => {
    await seedProduct({ stockQty: 10 })
    const { order } = await newOrderWithShift()
    await addOrderItem({ orderId: order.id, productId: 'p1', productName: 'Es Kopi', unitPrice: 20000, qty: 3, modifiers: [], notes: '' })
    await finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: 60000, receivedAmount: 60000 }], confirmedByUserId: 'u1' })
    await voidOrder({ orderId: order.id, reason: 'komplain', approverUserId: 'sup1', approverName: 'Sup' })

    expect((await db.orders.get(order.id))?.lifecycleStatus).toBe('VOIDED')
    expect((await db.products.get('p1'))?.stockQty).toBe(7) // tetap terpotong
    const pays = await db.payments.where('orderId').equals(order.id).toArray()
    expect(pays.find((p) => p.amount === -60000)).toBeDefined()
  })

  it('nilai uang berurutan bebas fraksi (subtotal→diskon→service→pajak→bulat)', async () => {
    await updateSettings({ taxPercent: 11, serviceChargePercent: 5, roundingIncrement: 100 })
    await seedProduct({ stockQty: 10, price: 13333 })
    const { order } = await newOrderWithShift()
    await addOrderItem({ orderId: order.id, productId: 'p1', productName: 'Es Kopi', unitPrice: 13333, qty: 3, modifiers: [], notes: '' })
    const o = await db.orders.get(order.id)
    for (const v of [o!.subtotal, o!.discountAmount, o!.serviceChargeAmount, o!.taxAmount, o!.grandTotal]) {
      expect(Number.isInteger(v)).toBe(true)
    }
    expect(o!.grandTotal % 100).toBe(0)
  })
})
