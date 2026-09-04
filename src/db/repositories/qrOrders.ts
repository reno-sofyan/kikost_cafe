import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { transitionOrder, drawQueueNumber, recalcOrderTotals } from '@/db/repositories/orders'
import { sendOrderToKitchen } from '@/db/repositories/kitchenDispatch'
import { getSettings } from '@/db/repositories/settings'
import { computeLineTotal } from '@/lib/orderTotals'
import type { Order, OrderItem } from '@/types/domain'

export interface ConfirmQrResult {
  queueNumber: number
  /** true bila total berubah setelah dihitung ulang dengan harga menu terkini. */
  priceChanged: boolean
  oldTotal: number
  newTotal: number
  /** Nama item yang dikeluarkan karena produk sudah tidak tersedia saat diterima. */
  removedItems: string[]
}

/**
 * Hitung ulang harga tiap item pesanan QR dengan harga menu TERKINI (harga
 * di-lock saat submit bisa basi bila kasir baru menerima lama kemudian).
 * Item yang produknya hilang/nonaktif ditandai `removed` (tidak disajikan).
 * Dijalankan di dalam transaksi pemanggil.
 */
async function repriceQrItems(orderId: string): Promise<string[]> {
  const items = await db.orderItems
    .where('orderId')
    .equals(orderId)
    .filter((i) => !i.removed && !i.voided)
    .toArray()
  const removed: string[] = []

  for (const item of items) {
    const product = await db.products.get(item.productId)
    const now = Date.now()

    if (!product || product.isAvailable === false) {
      await db.orderItems.update(item.id, { removed: true, updatedAt: now })
      const upd = await db.orderItems.get(item.id)
      if (upd) await enqueueSync('orderItems', item.id, upd)
      removed.push(item.productName)
      continue
    }

    const modifiers = await Promise.all(
      item.modifiers.map(async (m) => {
        const opt = await db.modifierOptions.get(m.optionId)
        return opt ? { ...m, priceDelta: opt.priceDelta } : m
      }),
    )
    const unitPrice = product.price
    const lineTotal = computeLineTotal({ unitPrice, qty: item.qty, modifiers, discountAmount: item.discountAmount })

    const changed =
      unitPrice !== item.unitPrice ||
      lineTotal !== item.lineTotal ||
      modifiers.some((m, idx) => m.priceDelta !== item.modifiers[idx]?.priceDelta)
    if (changed) {
      await db.orderItems.update(item.id, { unitPrice, modifiers, lineTotal, updatedAt: now } as Partial<OrderItem>)
      const upd = await db.orderItems.get(item.id)
      if (upd) await enqueueSync('orderItems', item.id, upd)
    }
  }
  return removed
}

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
): Promise<ConfirmQrResult> {
  const order = await db.orders.get(orderId)
  if (!order) throw new Error('Pesanan tidak ditemukan')
  if (order.lifecycleStatus !== 'PENDING_CONFIRMATION') {
    throw new Error('Pesanan ini sudah diproses.')
  }

  const settings = await getSettings()
  const queueNumber = order.queueNumber ?? (await drawQueueNumber())
  const oldTotal = order.grandTotal
  let removedItems: string[] = []

  await db.transaction(
    'rw',
    [db.orders, db.orderItems, db.products, db.modifierOptions, db.cafeTables, db.settings, db.syncQueue, db.auditLogs],
    async () => {
    await db.orders.update(orderId, {
      queueNumber,
      // Snapshot fiskal mengikuti setelan kafe saat DITERIMA (bukan saat submit).
      taxPercent: settings.taxPercent,
      serviceChargePercent: settings.serviceChargePercent,
      roundingIncrementSnapshot: order.roundingIncrementSnapshot || settings.roundingIncrement,
      updatedAt: Date.now(),
    })
    removedItems = await repriceQrItems(orderId)
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

    const fresh = await db.orders.get(orderId)
    const newTotal = fresh?.grandTotal ?? oldTotal
    const priceNote =
      newTotal !== oldTotal ? ` Harga disesuaikan Rp${oldTotal.toLocaleString('id-ID')} → Rp${newTotal.toLocaleString('id-ID')}.` : ''
    const removedNote = removedItems.length ? ` Item dikeluarkan (tak tersedia): ${removedItems.join(', ')}.` : ''
    await recordAuditLog({
      userId: actor.userId,
      userName: actor.userName,
      action: 'qr.order.confirm',
      entityType: 'order',
      entityId: orderId,
      details: `Pesanan QR ${order.orderNumber} diterima (antrean #${queueNumber}).${priceNote}${removedNote}`,
    })
    },
  )

  const finalOrder = await db.orders.get(orderId)
  const newTotal = finalOrder?.grandTotal ?? oldTotal

  try {
    await sendOrderToKitchen(orderId, actor)
  } catch {
    /* diabaikan — pesanan sudah diterima; job cetak tersimpan untuk retry */
  }
  return { queueNumber, priceChanged: newTotal !== oldTotal, oldTotal, newTotal, removedItems }
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

/** Pesanan aktif (belum bayar/batal) di sebuah meja — kandidat penggabungan QR. */
export async function activeOrderOnTable(tableId: string): Promise<Order | null> {
  if (!tableId) return null
  const orders = await db.orders.where('tableId').equals(tableId).toArray()
  const open = orders.find(
    (o) =>
      o.status === 'open' &&
      o.lifecycleStatus !== 'PENDING_CONFIRMATION' &&
      o.lifecycleStatus !== 'DRAFT' &&
      !['COMPLETED', 'VOIDED', 'CANCELLED', 'REJECTED'].includes(o.lifecycleStatus),
  )
  return open ?? null
}

/**
 * Menerima pesanan QR dengan MENGGABUNGKANNYA ke pesanan meja yang sedang aktif
 * (pelanggan menambah pesanan di meja yang sama). Item QR dipindah ke pesanan
 * target, order QR di-void ("digabung"), lalu item baru dikirim ke dapur/bar.
 */
export async function mergeQrOrderIntoTable(
  qrOrderId: string,
  targetOrderId: string,
  actor: { userId: string; userName: string },
): Promise<void> {
  const qrOrder = await db.orders.get(qrOrderId)
  if (!qrOrder) throw new Error('Pesanan QR tidak ditemukan')
  if (qrOrder.lifecycleStatus !== 'PENDING_CONFIRMATION') throw new Error('Pesanan ini sudah diproses.')
  const target = await db.orders.get(targetOrderId)
  if (!target || target.status !== 'open') throw new Error('Pesanan meja tujuan tidak aktif.')

  await db.transaction(
    'rw',
    [db.orders, db.orderItems, db.products, db.modifierOptions, db.cafeTables, db.settings, db.syncQueue, db.auditLogs],
    async () => {
      const removed = await repriceQrItems(qrOrderId)
      const now = Date.now()
      const items = await db.orderItems.where('orderId').equals(qrOrderId).filter((i) => !i.removed).toArray()
      for (const item of items) {
        await db.orderItems.update(item.id, { orderId: targetOrderId, kitchenPrintedAt: null, ticketId: null, updatedAt: now })
        const moved = await db.orderItems.get(item.id)
        if (moved) await enqueueSync('orderItems', item.id, moved)
      }
      await db.orders.update(qrOrderId, {
        lifecycleStatus: 'VOIDED',
        status: 'void',
        voidReason: `Digabung ke ${target.orderNumber}`,
        voidedBy: actor.userId,
        voidedAt: now,
        rejectedReason: null,
        updatedAt: now,
      })
      const voided = await db.orders.get(qrOrderId)
      if (voided) await enqueueSync('orders', qrOrderId, voided)
      await recalcOrderTotals(targetOrderId)

      await recordAuditLog({
        userId: actor.userId,
        userName: actor.userName,
        action: 'qr.order.merge',
        entityType: 'order',
        entityId: qrOrderId,
        details:
          `Pesanan QR ${qrOrder.orderNumber} digabung ke ${target.orderNumber} (${items.length} item)` +
          (removed.length ? `. Dikeluarkan: ${removed.join(', ')}.` : '.'),
      })
    },
  )

  try {
    await sendOrderToKitchen(targetOrderId, actor)
  } catch {
    /* diabaikan — item sudah tergabung; job cetak tersimpan untuk retry */
  }
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
