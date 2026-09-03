import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId, newIdempotencyKey } from '@/lib/id'
import { computeLineTotal, computeOrderTotals } from '@/lib/orderTotals'
import { getSettings, nextTransactionNumber } from '@/db/repositories/settings'
import { occupyTable } from '@/db/repositories/tables'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { assertTransition, deriveKitchenPhase, legacyStatusFor } from '@/lib/orderState'
import { getDeviceId } from '@/sync/device'
import { jakartaDateKey } from '@/lib/datetime'
import type {
  DiscountType,
  KitchenItemStatus,
  Order,
  OrderItem,
  OrderItemModifierSnapshot,
  OrderLifecycleStatus,
  OrderSource,
  OrderType,
} from '@/types/domain'

/** Nomor antrean harian (reset tiap hari) untuk semua pesanan, dihitung dari data yang ada. */
async function drawQueueNumber(): Promise<number> {
  const todayKey = jakartaDateKey(Date.now())
  const todaysOrders = await db.orders
    .filter((o) => o.queueNumber !== null && jakartaDateKey(o.createdAt) === todayKey)
    .toArray()
  const maxQueue = todaysOrders.reduce((max, o) => Math.max(max, o.queueNumber ?? 0), 0)
  return maxQueue >= 999 ? 1 : maxQueue + 1
}

export class NoActiveShiftError extends Error {
  constructor() {
    super('Tidak ada shift aktif. Buka shift terlebih dahulu sebelum membuat pesanan.')
    this.name = 'NoActiveShiftError'
  }
}

export async function startOrder(params: {
  type: OrderType
  source?: OrderSource
  tableId?: string
  customerId?: string
  guestCount?: number
  notes?: string
  cashierId: string
  cashierName: string
  shiftId: string
}): Promise<Order> {
  // Guard integritas: pesanan wajib terikat ke shift yang benar-benar terbuka —
  // tidak cukup mengandalkan UI menyembunyikan tombol.
  const shift = await db.shifts.get(params.shiftId)
  if (!shift || shift.status !== 'open') throw new NoActiveShiftError()

  const settings = await getSettings()
  const orderNumber = await nextTransactionNumber()
  const now = Date.now()
  const order: Order = {
    id: newId(),
    orderNumber,
    type: params.type,
    tableId: params.tableId ?? null,
    customerId: params.customerId ?? null,
    queueNumber: await drawQueueNumber(),
    guestCount: params.guestCount ?? null,
    status: 'open',
    lifecycleStatus: 'DRAFT',
    subtotal: 0,
    discountType: null,
    discountValue: 0,
    discountAmount: 0,
    taxPercent: settings.taxPercent,
    taxAmount: 0,
    serviceChargePercent: settings.serviceChargePercent,
    serviceChargeAmount: 0,
    roundingIncrementSnapshot: settings.roundingIncrement,
    roundingAdjustment: 0,
    grandTotal: 0,
    shiftId: params.shiftId,
    deviceId: getDeviceId(),
    source: params.source ?? (params.type === 'takeaway' ? 'takeaway' : params.type === 'delivery' ? 'delivery' : 'cashier'),
    cashierId: params.cashierId,
    cashierName: params.cashierName,
    notes: params.notes?.trim() ?? '',
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

/**
 * Satu-satunya pintu perubahan status siklus hidup order. Memvalidasi transisi,
 * menyelaraskan `status` legacy, dan mendaftarkan ke sync. Harus dipanggil di
 * dalam transaksi yang mencakup `db.orders` & `db.syncQueue`.
 */
export async function transitionOrder(
  orderId: string,
  to: OrderLifecycleStatus,
  extra: Partial<Order> = {},
): Promise<void> {
  const order = await db.orders.get(orderId)
  if (!order) throw new Error('Pesanan tidak ditemukan')
  const from = order.lifecycleStatus ?? 'DRAFT'
  if (from === to && Object.keys(extra).length === 0) return
  assertTransition(from, to)
  await db.orders.update(orderId, {
    lifecycleStatus: to,
    status: legacyStatusFor(to),
    updatedAt: Date.now(),
    ...extra,
  })
  const updated = await db.orders.get(orderId)
  if (updated) await enqueueSync('orders', orderId, updated)
}

/** Menaikkan status dapur order (CONFIRMED→…→SERVED) berdasarkan agregat status item. */
async function syncKitchenPhase(orderId: string): Promise<void> {
  const order = await db.orders.get(orderId)
  if (!order) return
  const items = await db.orderItems
    .where('orderId')
    .equals(orderId)
    .filter((i) => !i.removed && !i.voided)
    .toArray()
  const derived = deriveKitchenPhase(
    order.lifecycleStatus ?? 'DRAFT',
    items.map((i) => i.kitchenStatus),
  )
  if (derived !== order.lifecycleStatus) {
    await db.orders.update(orderId, { lifecycleStatus: derived, updatedAt: Date.now() })
    const updated = await db.orders.get(orderId)
    if (updated) await enqueueSync('orders', orderId, updated)
  }
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
  await db.transaction(
    'rw',
    [db.orderItems, db.orders, db.syncQueue, db.settings],
    async () => {
      // Tiket dapur & cetak dibuat saat item di-"Kirim ke Dapur/Bar"
      // (sendOrderToKitchen) — bukan saat item ditambahkan. Item baru mulai
      // dengan ticketId null & kitchenPrintedAt null hingga di-dispatch.
      await db.orderItems.add(item)
      await enqueueSync('orderItems', item.id, item)
      // Item pertama mengkonfirmasi order. Kafe: tanpa tombol terpisah —
      // menambah item = mengkonfirmasi order (DRAFT -> CONFIRMED).
      const order = await db.orders.get(params.orderId)
      if (order && (order.lifecycleStatus ?? 'DRAFT') === 'DRAFT') {
        await transitionOrder(params.orderId, 'CONFIRMED')
      }
      await recalcOrderTotals(params.orderId)
    },
  )
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

/**
 * Menghapus item yang BELUM dikirim ke dapur. Soft-delete (`removed: true`) —
 * bukan hard delete — supaya penghapusan terwakili di sinkronisasi dan tak ada
 * data transaksi yang lenyap tanpa jejak.
 */
export async function removeOrderItem(itemId: string): Promise<void> {
  const item = await db.orderItems.get(itemId)
  if (!item || item.removed) return
  await db.transaction('rw', db.orderItems, db.orders, db.syncQueue, db.settings, async () => {
    await db.orderItems.update(itemId, { removed: true, updatedAt: Date.now() })
    const updated = await db.orderItems.get(itemId)
    if (updated) await enqueueSync('orderItems', itemId, updated)
    await recalcOrderTotals(item.orderId)
  })
}

/**
 * Membatalkan satu item pesanan (tetap tersimpan untuk dapur & audit). Item yang
 * SUDAH dikirim ke dapur (`kitchenStatus !== 'new'`) wajib disertai penyetuju
 * supervisor — dipaksa oleh tipe: `approver` wajib bila item sudah diproses.
 */
export async function voidOrderItem(
  itemId: string,
  reason: string,
  approver?: { userId: string; userName: string },
): Promise<void> {
  const item = await db.orderItems.get(itemId)
  if (!item || item.voided) return
  const wasSentToKitchen = item.kitchenStatus !== 'new'
  if (wasSentToKitchen && !approver) {
    throw new Error('Membatalkan item yang sudah dikirim ke dapur butuh persetujuan supervisor.')
  }
  await db.transaction(
    'rw',
    [db.orderItems, db.orders, db.syncQueue, db.settings, db.auditLogs],
    async () => {
      await db.orderItems.update(itemId, { voided: true, voidReason: reason, updatedAt: Date.now() })
      const updated = await db.orderItems.get(itemId)
      if (updated) await enqueueSync('orderItems', itemId, updated)
      await recalcOrderTotals(item.orderId)
      if (wasSentToKitchen && approver) {
        await recordAuditLog({
          userId: approver.userId,
          userName: approver.userName,
          action: 'orderItem.void',
          entityType: 'orderItem',
          entityId: itemId,
          details: `Item "${item.productName}" (sudah di dapur) dibatalkan. Alasan: ${reason}`,
        })
      }
    },
  )
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

const KITCHEN_TIMESTAMP_FIELD: Partial<Record<KitchenItemStatus, keyof OrderItem>> = {
  in_progress: 'startedAt',
  ready: 'readyAt',
  done: 'servedAt',
}

export async function setOrderItemKitchenStatus(itemId: string, kitchenStatus: KitchenItemStatus): Promise<void> {
  await db.transaction('rw', [db.orderItems, db.orders, db.syncQueue], async () => {
    const item = await db.orderItems.get(itemId)
    if (!item) return
    const now = Date.now()
    const patch: Partial<OrderItem> = { kitchenStatus, updatedAt: now }
    const tsField = KITCHEN_TIMESTAMP_FIELD[kitchenStatus]
    if (tsField && item[tsField] == null) (patch as Record<string, unknown>)[tsField] = now
    await db.orderItems.update(itemId, patch)
    const updated = await db.orderItems.get(itemId)
    if (updated) await enqueueSync('orderItems', itemId, updated)
    await syncKitchenPhase(item.orderId)
  })
}

export async function listActiveKitchenItems(): Promise<OrderItem[]> {
  return db.orderItems
    .where('kitchenStatus')
    .notEqual('done')
    .and((item) => !item.removed)
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
    // Snapshot pembulatan milik order — bukan setelan live — supaya perubahan
    // setelan tak menggeser total order lama saat di-recalc.
    roundingIncrement: order.roundingIncrementSnapshot ?? (await getSettings()).roundingIncrement,
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
      deviceId: getDeviceId(),
      createdAt: now,
      updatedAt: now,
      paidAt: null,
      status: 'open',
      lifecycleStatus: original.lifecycleStatus === 'DRAFT' ? 'DRAFT' : 'CONFIRMED',
      queueNumber: await drawQueueNumber(),
    }
    await db.orders.add(newOrder)
    await enqueueSync('orders', newOrder.id, newOrder)
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
