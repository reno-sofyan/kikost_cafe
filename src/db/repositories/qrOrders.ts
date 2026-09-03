import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { transitionOrder, drawQueueNumber, recalcOrderTotals } from '@/db/repositories/orders'
import { sendOrderToKitchen } from '@/db/repositories/kitchenDispatch'
import { getSettings } from '@/db/repositories/settings'
import type { Order } from '@/types/domain'

export interface QrOrderView {
  order: Order
  tableName: string
  itemCount: number
}

/** Pesanan QR yang menunggu keputusan kasir/waiter. */
export async function listPendingQrOrders(): Promise<Order[]> {
  return db.orders
    .where('lifecycleStatus')
    .equals('PENDING_CONFIRMATION')
    .filter((o) => o.source === 'qr_table')
    .reverse()
    .sortBy('createdAt')
}

export async function countPendingQrOrders(): Promise<number> {
  return db.orders
    .where('lifecycleStatus')
    .equals('PENDING_CONFIRMATION')
    .filter((o) => o.source === 'qr_table')
    .count()
}

/**
 * Menerima pesanan QR: kunci total (harga sudah dihitung server saat submit),
 * beri nomor antrean, pindahkan ke CONFIRMED, lalu kirim ke dapur/bar.
 * Kegagalan printer TIDAK membatalkan penerimaan.
 */
export async function confirmQrOrder(
  orderId: string,
  actor: { userId: string; userName: string },
): Promise<{ queueNumber: number }> {
  const order = await db.orders.get(orderId)
  if (!order) throw new Error('Pesanan tidak ditemukan')
  if (order.lifecycleStatus !== 'PENDING_CONFIRMATION') {
    throw new Error('Pesanan ini sudah diproses.')
  }

  const settings = await getSettings()
  const queueNumber = order.queueNumber ?? (await drawQueueNumber())

  await db.transaction(
    'rw',
    [db.orders, db.orderItems, db.cafeTables, db.settings, db.syncQueue, db.auditLogs],
    async () => {
    await db.orders.update(orderId, {
      queueNumber,
      // Snapshot fiskal mengikuti setelan kafe saat DITERIMA (bukan saat submit).
      taxPercent: settings.taxPercent,
      serviceChargePercent: settings.serviceChargePercent,
      roundingIncrementSnapshot: order.roundingIncrementSnapshot || settings.roundingIncrement,
      updatedAt: Date.now(),
    })
    await recalcOrderTotals(orderId)
    await transitionOrder(orderId, 'CONFIRMED')

    if (order.tableId) {
      const table = await db.cafeTables.get(order.tableId)
      if (table) {
        await db.cafeTables.update(order.tableId, {
          status: 'occupied',
          currentOrderId: orderId,
          occupiedSince: table.occupiedSince ?? Date.now(),
          updatedAt: Date.now(),
        })
        const updated = await db.cafeTables.get(order.tableId)
        if (updated) await enqueueSync('cafeTables', order.tableId, updated)
      }
    }

    await recordAuditLog({
      userId: actor.userId,
      userName: actor.userName,
      action: 'qr.order.confirm',
      entityType: 'order',
      entityId: orderId,
      details: `Pesanan QR ${order.orderNumber} diterima (antrean #${queueNumber}).`,
    })
    },
  )

  try {
    await sendOrderToKitchen(orderId, actor)
  } catch {
    /* diabaikan — pesanan sudah diterima; job cetak tersimpan untuk retry */
  }
  return { queueNumber }
}

/** Menolak pesanan QR. Alasan wajib. Stok tidak pernah dipotong, jadi tak ada restock. */
export async function rejectQrOrder(
  orderId: string,
  reason: string,
  actor: { userId: string; userName: string },
): Promise<void> {
  const trimmed = reason.trim()
  if (!trimmed) throw new Error('Alasan penolakan wajib diisi.')

  const order = await db.orders.get(orderId)
  if (!order) throw new Error('Pesanan tidak ditemukan')
  if (order.lifecycleStatus !== 'PENDING_CONFIRMATION') {
    throw new Error('Pesanan ini sudah diproses.')
  }

  await db.transaction('rw', [db.orders, db.cafeTables, db.syncQueue, db.auditLogs], async () => {
    await transitionOrder(orderId, 'REJECTED', { rejectedReason: trimmed })

    if (order.tableId) {
      const table = await db.cafeTables.get(order.tableId)
      if (table && table.currentOrderId === orderId) {
        await db.cafeTables.update(order.tableId, {
          status: 'available',
          currentOrderId: null,
          occupiedSince: null,
          guestCount: null,
          updatedAt: Date.now(),
        })
        const updated = await db.cafeTables.get(order.tableId)
        if (updated) await enqueueSync('cafeTables', order.tableId, updated)
      }
    }

    await recordAuditLog({
      userId: actor.userId,
      userName: actor.userName,
      action: 'qr.order.reject',
      entityType: 'order',
      entityId: orderId,
      details: `Pesanan QR ${order.orderNumber} ditolak. Alasan: ${trimmed}`,
    })
  })
}

/** Menandai satu permintaan pelanggan (panggil waiter / minta tagihan) selesai. */
export async function resolveTableCall(callId: string): Promise<void> {
  await db.transaction('rw', db.tableCalls, db.syncQueue, async () => {
    await db.tableCalls.update(callId, { status: 'done', updatedAt: Date.now() })
    const updated = await db.tableCalls.get(callId)
    if (updated) await enqueueSync('tableCalls', callId, updated)
  })
}

export async function listPendingTableCalls() {
  return db.tableCalls.where('status').equals('pending').reverse().sortBy('createdAt')
}
