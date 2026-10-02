import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { roleHasPermission } from '@/lib/permissions'
import { applyRemoteDeletions } from '@/sync/applyRemote'
import { clearOrderHistory, deleteOrder } from './orderDeletion'
import { finalizePayment } from './checkout'
import { addOrderItem, startOrder } from './orders'
import { openShift } from './shifts'
import type { Order } from '@/types/domain'

const actor = { userId: 'u1', userName: 'Admin' }

beforeEach(async () => {
  await resetLocalDb()
  await db.categories.put({ id: 'c1', name: 'Umum', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })
  await db.products.put({
    id: 'p1', categoryId: 'c1', name: 'Kopi', sku: 'K1', barcode: null, price: 20000, costPrice: 5000,
    unit: 'pcs', photoDataUrl: null, trackOwnStock: true, stockQty: 50, lowStockThreshold: 0,
    isFavorite: false, isAvailable: true, modifierGroupIds: [], createdAt: 1, updatedAt: 1,
  })
})

async function openOrder(): Promise<Order> {
  const shift = (await db.shifts.toArray())[0] ?? (await openShift({ cashierId: 'u1', cashierName: 'K', openingCash: 0 }))
  const order = await startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'K', shiftId: shift.id })
  await addOrderItem({ orderId: order.id, productId: 'p1', productName: 'Kopi', unitPrice: 20000, qty: 2, modifiers: [], notes: '' })
  return order
}

async function paidOrder(): Promise<Order> {
  const order = await openOrder()
  await finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: 40000 }], confirmedByUserId: 'u1' })
  return (await db.orders.get(order.id))!
}

const queuedDeletes = async () =>
  (await db.syncQueue.toArray()).filter((e) => e.operation === 'delete').map((e) => `${e.entity}:${e.entityId}`)

describe('izin hapus transaksi', () => {
  it('hanya pemilik & administrator', () => {
    expect(roleHasPermission('pemilik', 'order.delete')).toBe(true)
    expect(roleHasPermission('administrator', 'order.delete')).toBe(true)
    for (const role of ['supervisor', 'kasir', 'pramusaji', 'dapur'] as const) {
      expect(roleHasPermission(role, 'order.delete')).toBe(false)
    }
  })
})

describe('deleteOrder', () => {
  it('menghapus pesanan lunas beserta item & pembayaran, mengantre tombstone, dan mencatat audit log', async () => {
    const order = await paidOrder()
    const itemIds = (await db.orderItems.where('orderId').equals(order.id).primaryKeys()) as string[]
    const paymentIds = (await db.payments.where('orderId').equals(order.id).primaryKeys()) as string[]
    expect(paymentIds.length).toBeGreaterThan(0)
    const stockBefore = (await db.products.get('p1'))!.stockQty

    await deleteOrder(order.id, actor, 'transaksi uji coba')

    expect(await db.orders.get(order.id)).toBeUndefined()
    expect(await db.orderItems.where('orderId').equals(order.id).count()).toBe(0)
    expect(await db.payments.where('orderId').equals(order.id).count()).toBe(0)
    expect(await db.bills.where('orderId').equals(order.id).count()).toBe(0)
    expect((await db.products.get('p1'))!.stockQty).toBe(stockBefore) // stok tak berubah

    const deletes = await queuedDeletes()
    expect(deletes).toContain(`orders:${order.id}`)
    for (const id of itemIds) expect(deletes).toContain(`orderItems:${id}`)
    for (const id of paymentIds) expect(deletes).toContain(`payments:${id}`)

    const log = (await db.auditLogs.toArray()).find((l) => l.action === 'order.deleted')
    expect(log?.details).toContain(order.orderNumber)
    expect(log?.details).toContain('transaksi uji coba')
  })

  it('menolak pesanan yang masih terbuka', async () => {
    const order = await openOrder()
    await expect(deleteOrder(order.id, actor, 'x')).rejects.toThrow('masih terbuka')
    expect(await db.orders.get(order.id)).toBeDefined()
    expect(await queuedDeletes()).toHaveLength(0)
  })

  it('alasan wajib diisi', async () => {
    const order = await paidOrder()
    await expect(deleteOrder(order.id, actor, '   ')).rejects.toThrow('Alasan')
    expect(await db.orders.get(order.id)).toBeDefined()
  })
})

describe('clearOrderHistory', () => {
  it('menghapus semua transaksi selesai, melewati yang masih terbuka', async () => {
    await paidOrder()
    await paidOrder()
    const stillOpen = await openOrder()

    const result = await clearOrderHistory(actor)

    expect(result).toEqual({ deleted: 2, skippedOpen: 1, total: 80000 })
    expect((await db.orders.toArray()).map((o) => o.id)).toEqual([stillOpen.id])
    expect(await db.payments.count()).toBe(0)
    expect((await db.auditLogs.toArray()).some((l) => l.action === 'order.history_cleared')).toBe(true)
  })
})

describe('penghapusan transaksi dari perangkat lain', () => {
  it('applyRemoteDeletions menghapus pesanan & turunannya yang dikirim server', async () => {
    const order = await paidOrder()
    const itemIds = (await db.orderItems.where('orderId').equals(order.id).primaryKeys()) as string[]
    const paymentIds = (await db.payments.where('orderId').equals(order.id).primaryKeys()) as string[]

    await applyRemoteDeletions({ orders: [order.id], orderItems: itemIds, payments: paymentIds })

    expect(await db.orders.get(order.id)).toBeUndefined()
    expect(await db.orderItems.count()).toBe(0)
    expect(await db.payments.count()).toBe(0)
  })
})
