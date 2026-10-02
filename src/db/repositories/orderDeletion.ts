import { db } from '@/db/schema'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { enqueueSyncDelete, type DeletableSyncEntity } from '@/sync/outbox'
import { formatRupiah } from '@/lib/currency'
import type { Order } from '@/types/domain'

/**
 * Hapus riwayat transaksi (khusus admin, izin `order.delete`). Menghapus pesanan
 * BESERTA turunannya (item, tiket dapur, tagihan, pembayaran, retur, refund,
 * notifikasi pembayaran online) di perangkat ini dan — lewat tombstone sync — di
 * server & perangkat lain, jadi laporan penjualan dan omzet di /ops ikut berubah.
 *
 * Yang TIDAK ikut berubah: stok (pergerakan stok penjualan punya riwayatnya sendiri)
 * dan rekap shift yang sudah ditutup. Setiap penghapusan tercatat di audit log
 * (append-only, tak bisa dihapus) beserta nomor, nominal, dan alasannya.
 */

interface DeleteActor {
  userId: string
  userName: string
}

/** Tabel turunan pesanan yang ikut dihapus — semuanya ber-index `orderId`. */
const CHILD_TABLES = ['orderItems', 'kitchenTickets', 'bills', 'payments', 'returns', 'refunds', 'onlinePayments'] as const satisfies readonly DeletableSyncEntity[]

const STATUS_LABELS: Record<Order['status'], string> = { open: 'terbuka', paid: 'lunas', void: 'dibatalkan', completed: 'selesai' }

const TX_TABLES = () => [
  db.orders,
  ...CHILD_TABLES.map((t) => db.table(t)),
  db.printJobs,
  db.syncQueue,
  db.auditLogs,
]

/** `null` = boleh dihapus. Pesanan yang masih terbuka harus dibayar/dibatalkan dulu. */
export function orderDeleteBlockReason(order: Pick<Order, 'status'>): string | null {
  return order.status === 'open' ? 'Transaksi masih terbuka — selesaikan atau batalkan dulu sebelum menghapus.' : null
}

/** Harus dipanggil di dalam transaksi `TX_TABLES()`. */
async function removeOrderWithChildren(orderId: string): Promise<void> {
  for (const table of CHILD_TABLES) {
    const ids = (await db.table(table).where('orderId').equals(orderId).primaryKeys()) as string[]
    if (ids.length === 0) continue
    await db.table(table).bulkDelete(ids)
    for (const id of ids) await enqueueSyncDelete(table, id)
  }
  // Antrean cetak bersifat lokal (tak pernah disinkronkan) — cukup dibuang.
  await db.printJobs.where('orderId').equals(orderId).delete()
  await db.orders.delete(orderId)
  await enqueueSyncDelete('orders', orderId)
}

export async function deleteOrder(orderId: string, actor: DeleteActor, reason: string): Promise<void> {
  const trimmedReason = reason.trim()
  if (!trimmedReason) throw new Error('Alasan penghapusan wajib diisi.')
  await db.transaction('rw', TX_TABLES(), async () => {
    const order = await db.orders.get(orderId)
    if (!order) return
    const blockReason = orderDeleteBlockReason(order)
    if (blockReason) throw new Error(blockReason)
    await removeOrderWithChildren(orderId)
    await recordAuditLog({
      ...actor,
      action: 'order.deleted',
      entityType: 'order',
      entityId: orderId,
      details: `Transaksi ${order.orderNumber} (${formatRupiah(order.grandTotal)}, ${STATUS_LABELS[order.status]}) dihapus. Alasan: ${trimmedReason}`,
    })
  })
}

/**
 * Hapus SELURUH riwayat transaksi yang sudah selesai (lunas/batal/selesai). Pesanan
 * yang masih terbuka dilewati supaya meja & kasir yang sedang berjalan tidak rusak.
 */
export async function clearOrderHistory(actor: DeleteActor): Promise<{ deleted: number; skippedOpen: number; total: number }> {
  return db.transaction('rw', TX_TABLES(), async () => {
    const orders = await db.orders.toArray()
    const deletable = orders.filter((o) => !orderDeleteBlockReason(o))
    for (const order of deletable) await removeOrderWithChildren(order.id)
    const total = deletable.reduce((sum, o) => sum + (o.status === 'void' ? 0 : o.grandTotal), 0)
    if (deletable.length > 0) {
      await recordAuditLog({
        ...actor,
        action: 'order.history_cleared',
        entityType: 'order',
        entityId: 'all',
        details: `Seluruh riwayat transaksi dihapus: ${deletable.length} transaksi, total ${formatRupiah(total)}`,
      })
    }
    return { deleted: deletable.length, skippedOpen: orders.length - deletable.length, total }
  })
}
