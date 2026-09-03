import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { setEscPosSender, resetEscPosSender } from '@/features/printing/printerDrivers'
import { confirmQrOrder, listPendingQrOrders, rejectQrOrder } from './qrOrders'
import { createTable, issueQrToken, listTables, setQrActive } from './tables'
import type { Order, OrderItem } from '@/types/domain'

const actor = { userId: 'u1', userName: 'Admin' }

beforeEach(async () => {
  await resetLocalDb()
  setEscPosSender(async () => {})
})
afterEach(() => resetEscPosSender())

async function seedQrOrder(over: Partial<Order> = {}): Promise<Order> {
  const now = Date.now()
  const order: Order = {
    id: 'qr-1',
    orderNumber: 'QR00001',
    type: 'dine_in',
    tableId: null,
    customerId: null,
    queueNumber: null,
    guestCount: null,
    status: 'open',
    lifecycleStatus: 'PENDING_CONFIRMATION',
    subtotal: 20000,
    discountType: null,
    discountValue: 0,
    discountAmount: 0,
    taxPercent: 0,
    taxAmount: 0,
    serviceChargePercent: 0,
    serviceChargeAmount: 0,
    roundingIncrementSnapshot: 100,
    roundingAdjustment: 0,
    grandTotal: 20000,
    shiftId: null,
    deviceId: 'qr-public',
    source: 'qr_table',
    cashierId: 'qr',
    cashierName: 'QR',
    notes: 'Budi',
    idempotencyKey: 'idem-1',
    parentOrderId: null,
    rejectedReason: null,
    voidReason: null,
    voidedBy: null,
    voidedAt: null,
    createdAt: now,
    updatedAt: now,
    paidAt: null,
    ...over,
  }
  await db.orders.put(order)
  const item: OrderItem = {
    id: 'qi-1',
    orderId: order.id,
    productId: 'p1',
    productName: 'Kopi',
    unitPrice: 20000,
    qty: 1,
    modifiers: [],
    notes: '',
    discountAmount: 0,
    lineTotal: 20000,
    kitchenStatus: 'new',
    removed: false,
    kitchenPrintedAt: null,
    ticketId: null,
    queuedAt: now,
    startedAt: null,
    readyAt: null,
    servedAt: null,
    voided: false,
    voidReason: null,
    createdAt: now,
    updatedAt: now,
  }
  await db.orderItems.put(item)
  return order
}

describe('QR order inbox', () => {
  it('listPendingQrOrders hanya pesanan QR PENDING_CONFIRMATION', async () => {
    await seedQrOrder({ id: 'qr-1' })
    await seedQrOrder({ id: 'qr-2', lifecycleStatus: 'CONFIRMED', status: 'open' })
    await seedQrOrder({ id: 'c-1', source: 'cashier' })
    const pending = await listPendingQrOrders()
    expect(pending.map((o) => o.id)).toEqual(['qr-1'])
  })

  it('confirm: beri nomor antrean, pindah ke CONFIRMED, kirim ke dapur', async () => {
    await db.categories.put({ id: 'cat', name: 'Kopi', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })
    await db.products.put({
      id: 'p1', categoryId: 'cat', name: 'Kopi', sku: 'p1', barcode: null, price: 20000, costPrice: 5000,
      unit: 'pcs', photoDataUrl: null, trackOwnStock: false, stockQty: 0, lowStockThreshold: 0,
      isFavorite: false, isAvailable: true, modifierGroupIds: [], createdAt: 1, updatedAt: 1,
    })
    await seedQrOrder()
    const { queueNumber } = await confirmQrOrder('qr-1', actor)
    expect(queueNumber).toBe(1)
    const o = await db.orders.get('qr-1')
    expect(o?.lifecycleStatus).toBe('CONFIRMED')
    expect(o?.status).toBe('open')
    expect(o?.queueNumber).toBe(1)
    expect(await db.kitchenTickets.where('orderId').equals('qr-1').count()).toBe(1)
    expect(await db.auditLogs.where('action').equals('qr.order.confirm').count()).toBe(1)
  })

  it('confirm dua kali → error, tidak dobel', async () => {
    await seedQrOrder()
    await confirmQrOrder('qr-1', actor)
    await expect(confirmQrOrder('qr-1', actor)).rejects.toThrow(/sudah diproses/i)
  })

  it('reject: wajib alasan, pindah ke REJECTED, bebaskan meja', async () => {
    await createTable({ name: 'Meja 1', area: '', capacity: 2 })
    const table = (await listTables())[0]
    await db.cafeTables.update(table.id, { status: 'occupied', currentOrderId: 'qr-1' })
    await seedQrOrder({ tableId: table.id })

    await expect(rejectQrOrder('qr-1', '   ', actor)).rejects.toThrow(/alasan/i)

    await rejectQrOrder('qr-1', 'Bahan habis', actor)
    const o = await db.orders.get('qr-1')
    expect(o?.lifecycleStatus).toBe('REJECTED')
    expect(o?.status).toBe('void')
    expect(o?.rejectedReason).toBe('Bahan habis')
    const freed = await db.cafeTables.get(table.id)
    expect(freed?.status).toBe('available')
    expect(freed?.currentOrderId).toBeNull()
  })
})

describe('QR token meja', () => {
  it('issueQrToken: token acak (bukan id meja), aktif, ber-audit', async () => {
    await createTable({ name: 'Meja 1', area: '', capacity: 2 })
    const table = (await listTables())[0]
    const token = await issueQrToken(table.id, actor)
    expect(token).not.toEqual(table.id)
    expect(token.length).toBeGreaterThanOrEqual(24)
    const updated = await db.cafeTables.get(table.id)
    expect(updated?.qrToken).toBe(token)
    expect(updated?.qrActive).toBe(true)
    expect(await db.auditLogs.where('action').equals('qr.token.issue').count()).toBe(1)
  })

  it('regenerate mengganti token & tercatat sebagai regenerate', async () => {
    await createTable({ name: 'Meja 1', area: '', capacity: 2 })
    const table = (await listTables())[0]
    const t1 = await issueQrToken(table.id, actor)
    const t2 = await issueQrToken(table.id, actor)
    expect(t2).not.toBe(t1)
    expect(await db.auditLogs.where('action').equals('qr.token.regenerate').count()).toBe(1)
  })

  it('setQrActive menonaktifkan tanpa menghapus token', async () => {
    await createTable({ name: 'Meja 1', area: '', capacity: 2 })
    const table = (await listTables())[0]
    const token = await issueQrToken(table.id, actor)
    await setQrActive(table.id, false, actor)
    const updated = await db.cafeTables.get(table.id)
    expect(updated?.qrActive).toBe(false)
    expect(updated?.qrToken).toBe(token)
  })

  it('semua perubahan meja/QR masuk antrean sync', async () => {
    await createTable({ name: 'Meja 1', area: '', capacity: 2 })
    const table = (await listTables())[0]
    await issueQrToken(table.id, actor)
    const queued = await db.syncQueue.where('entity').equals('cafeTables').count()
    expect(queued).toBeGreaterThanOrEqual(2)
  })
})
