import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId, newIdempotencyKey } from '@/lib/id'
import { computeLineTotal, computeOrderTotals } from '@/lib/orderTotals'
import { getSettings, nextTransactionNumber } from '@/db/repositories/settings'
import { occupyTable } from '@/db/repositories/tables'
import { jakartaDateKey } from '@/lib/datetime'
import type {
  DiscountType,
  Order,
  OrderItem,
  OrderItemModifierSnapshot,
  OrderType,
} from '@/types/domain'

/** Nomor antrean harian (reset tiap hari) untuk pesanan takeaway/delivery, dihitung dari data yang ada. */
async function drawQueueNumber(): Promise<number> {
  const todayKey = jakartaDateKey(Date.now())
  const todaysOrders = await db.orders
    .filter((o) => o.queueNumber !== null && jakartaDateKey(o.createdAt) === todayKey)
    .toArray()
  const maxQueue = todaysOrders.reduce((max, o) => Math.max(max, o.queueNumber ?? 0), 0)
  return maxQueue >= 999 ? 1 : maxQueue + 1
}

export async function startOrder(params: {
  type: OrderType
  tableId?: string
  customerId?: string
  guestCount?: number
  cashierId: string
  cashierName: string
  shiftId: string
}): Promise<Order> {
  const settings = await getSettings()
  const orderNumber = await nextTransactionNumber()
  const now = Date.now()
  const order: Order = {
    id: newId(),
    orderNumber,
    type: params.type,
    tableId: params.tableId ?? null,
    customerId: params.customerId ?? null,
    queueNumber: params.type !== 'dine_in' ? await drawQueueNumber() : null,
    guestCount: params.guestCount ?? null,
    status: 'open',
    subtotal: 0,
    discountType: null,
    discountValue: 0,
    discountAmount: 0,
    taxPercent: settings.taxPercent,
    taxAmount: 0,
    serviceChargePercent: settings.serviceChargePercent,
    serviceChargeAmount: 0,
    roundingAdjustment: 0,
    grandTotal: 0,
    shiftId: params.shiftId,
    cashierId: params.cashierId,
    cashierName: params.cashierName,
    notes: '',
    idempotencyKey: newIdempotencyKey(),
    parentOrderId: null,
    voidReason: null,
    voidedBy: null,
    voidedAt: null,
    createdAt: now,
    updatedAt: now,
    paidAt: null,
  }
  await db.transaction('rw', db.orders, db.cafeTables, db.syncQueue, async () => {
    await db.orders.add(order)
    await enqueueSync('orders', order.id, order)
    if (params.tableId) {
      await occupyTable(params.tableId, order.id, params.guestCount ?? 1)
    }
  })
  return order
}

export async function getOrder(orderId: string): Promise<Order | undefined> {
  return db.orders.get(orderId)
}

export async function listOpenOrders(): Promise<Order[]> {
  return db.orders.where('status').equals('open').reverse().sortBy('createdAt')
}

export async function listOrderItems(orderId: string): Promise<OrderItem[]> {
  return db.orderItems.where('orderId').equals(orderId).sortBy('createdAt')
}

export async function addOrderItem(params: {
  orderId: string
  productId: string
  productName: string
  unitPrice: number
  qty: number
  modifiers: OrderItemModifierSnapshot[]
  notes: string
  discountAmount?: number
}): Promise<OrderItem> {
  const now = Date.now()
  const lineTotal = computeLineTotal({
    unitPrice: params.unitPrice,
    qty: params.qty,
    modifiers: params.modifiers,
    discountAmount: params.discountAmount ?? 0,
  })
  const item: OrderItem = {
    id: newId(),
    orderId: params.orderId,
    productId: params.productId,
    productName: params.productName,
    unitPrice: params.unitPrice,
    qty: params.qty,
    modifiers: params.modifiers,
    notes: params.notes,
    discountAmount: params.discountAmount ?? 0,
    lineTotal,
    kitchenStatus: 'new',
    voided: false,
    voidReason: null,
    createdAt: now,
    updatedAt: now,
  }
  await db.transaction('rw', db.orderItems, db.orders, db.syncQueue, db.settings, async () => {
    await db.orderItems.add(item)
    await enqueueSync('orderItems', item.id, item)
    await recalcOrderTotals(params.orderId)
  })
  return item
}

export async function updateOrderItemQty(itemId: string, qty: number): Promise<void> {
  const item = await db.orderItems.get(itemId)
  if (!item) return
  const lineTotal = computeLineTotal({
    unitPrice: item.unitPrice,
    qty,
    modifiers: item.modifiers,
    discountAmount: item.discountAmount,
  })
  await db.transaction('rw', db.orderItems, db.orders, db.syncQueue, db.settings, async () => {
    await db.orderItems.update(itemId, { qty, lineTotal, updatedAt: Date.now() })
    const updated = await db.orderItems.get(itemId)
    if (updated) await enqueueSync('orderItems', itemId, updated)
    await recalcOrderTotals(item.orderId)
  })
}

export async function setOrderItemDiscount(itemId: string, discountAmount: number): Promise<void> {
  const item = await db.orderItems.get(itemId)
  if (!item) return
  const lineTotal = computeLineTotal({
    unitPrice: item.unitPrice,
    qty: item.qty,
    modifiers: item.modifiers,
    discountAmount,
  })
  await db.transaction('rw', db.orderItems, db.orders, db.syncQueue, db.settings, async () => {
    await db.orderItems.update(itemId, { discountAmount, lineTotal, updatedAt: Date.now() })
    const updated = await db.orderItems.get(itemId)
    if (updated) await enqueueSync('orderItems', itemId, updated)
    await recalcOrderTotals(item.orderId)
  })
}

export async function removeOrderItem(itemId: string): Promise<void> {
  const item = await db.orderItems.get(itemId)
  if (!item) return
  await db.transaction('rw', db.orderItems, db.orders, db.syncQueue, db.settings, async () => {
    await db.orderItems.delete(itemId)
    await recalcOrderTotals(item.orderId)
  })
}

/** Membatalkan satu item pesanan namun tetap menyimpan catatannya (untuk dapur & audit). */
export async function voidOrderItem(itemId: string, reason: string): Promise<void> {
  const item = await db.orderItems.get(itemId)
  if (!item) return
  await db.transaction('rw', db.orderItems, db.orders, db.syncQueue, db.settings, async () => {
    await db.orderItems.update(itemId, { voided: true, voidReason: reason, updatedAt: Date.now() })
    const updated = await db.orderItems.get(itemId)
    if (updated) await enqueueSync('orderItems', itemId, updated)
    await recalcOrderTotals(item.orderId)
  })
}

export async function setOrderDiscount(
  orderId: string,
  discountType: DiscountType | null,
  discountValue: number,
): Promise<void> {
  await db.transaction('rw', db.orders, db.orderItems, db.syncQueue, db.settings, async () => {
    await db.orders.update(orderId, { discountType, discountValue, updatedAt: Date.now() })
    await recalcOrderTotals(orderId)
  })
}

export async function setOrderItemKitchenStatus(itemId: string, kitchenStatus: OrderItem['kitchenStatus']): Promise<void> {
  await db.transaction('rw', db.orderItems, db.syncQueue, async () => {
    await db.orderItems.update(itemId, { kitchenStatus, updatedAt: Date.now() })
    const updated = await db.orderItems.get(itemId)
    if (updated) await enqueueSync('orderItems', itemId, updated)
  })
}

export async function listActiveKitchenItems(): Promise<OrderItem[]> {
  return db.orderItems
    .filter((item) => item.kitchenStatus !== 'done')
    .sortBy('createdAt')
}

export async function setOrderNotes(orderId: string, notes: string): Promise<void> {
  await db.orders.update(orderId, { notes, updatedAt: Date.now() })
}

export async function recalcOrderTotals(orderId: string): Promise<void> {
  const order = await db.orders.get(orderId)
  if (!order) return
  const items = await db.orderItems.where('orderId').equals(orderId).toArray()
  const totals = computeOrderTotals({
    items,
    discountType: order.discountType,
    discountValue: order.discountValue,
    taxPercent: order.taxPercent,
    serviceChargePercent: order.serviceChargePercent,
    roundingIncrement: (await getSettings()).roundingIncrement,
  })
  await db.orders.update(orderId, { ...totals, updatedAt: Date.now() })
  const updated = await db.orders.get(orderId)
  if (updated) await enqueueSync('orders', orderId, updated)
}

/** Memisahkan sebagian item ke pesanan baru (split bill). */
export async function splitOrder(orderId: string, itemIdsToMove: string[]): Promise<Order> {
  return db.transaction('rw', db.orders, db.orderItems, db.cafeTables, db.syncQueue, db.settings, async () => {
    const original = await db.orders.get(orderId)
    if (!original) throw new Error('Pesanan tidak ditemukan')
    const orderNumber = await nextTransactionNumber()
    const now = Date.now()
    const newOrder: Order = {
      ...original,
      id: newId(),
      orderNumber,
      parentOrderId: original.id,
      idempotencyKey: newIdempotencyKey(),
      createdAt: now,
      updatedAt: now,
      paidAt: null,
      status: 'open',
      queueNumber: original.type !== 'dine_in' ? await drawQueueNumber() : null,
    }
    await db.orders.add(newOrder)
    for (const itemId of itemIdsToMove) {
      await db.orderItems.update(itemId, { orderId: newOrder.id, updatedAt: now })
      const moved = await db.orderItems.get(itemId)
      if (moved) await enqueueSync('orderItems', itemId, moved)
    }
    await recalcOrderTotals(original.id)
    await recalcOrderTotals(newOrder.id)
    const refreshed = await db.orders.get(newOrder.id)
    return refreshed ?? newOrder
  })
}

/** Menggabungkan tagihan pesanan `sourceOrderId` ke dalam `targetOrderId`. */
export async function mergeOrders(targetOrderId: string, sourceOrderId: string): Promise<void> {
  await db.transaction('rw', db.orders, db.orderItems, db.cafeTables, db.syncQueue, db.settings, async () => {
    const items = await db.orderItems.where('orderId').equals(sourceOrderId).toArray()
    for (const item of items) {
      await db.orderItems.update(item.id, { orderId: targetOrderId, updatedAt: Date.now() })
      const moved = await db.orderItems.get(item.id)
      if (moved) await enqueueSync('orderItems', item.id, moved)
    }
    const source = await db.orders.get(sourceOrderId)
    await db.orders.update(sourceOrderId, {
      status: 'void',
      voidReason: `Digabung ke pesanan ${targetOrderId}`,
      voidedAt: Date.now(),
      updatedAt: Date.now(),
    })
    const updatedSource = await db.orders.get(sourceOrderId)
    if (updatedSource) await enqueueSync('orders', sourceOrderId, updatedSource)

    if (source?.tableId) {
      const table = await db.cafeTables.get(source.tableId)
      if (table && table.currentOrderId === sourceOrderId) {
        await db.cafeTables.update(source.tableId, {
          status: 'available',
          currentOrderId: null,
          occupiedSince: null,
          guestCount: null,
          updatedAt: Date.now(),
        })
      }
    }
    await recalcOrderTotals(targetOrderId)
  })
}
