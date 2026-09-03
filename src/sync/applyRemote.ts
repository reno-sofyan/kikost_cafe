import { db } from '@/db/schema'
import { reconcileTransactionSequence } from '@/db/repositories/settings'
import { playNewOrderChime } from '@/lib/kitchenSound'
import type { Order, Payment, SyncEntity } from '@/types/domain'

const IMMUTABLE_ORDER_STATUSES = new Set(['paid', 'void', 'completed'])

/**
 * Menerapkan entitas dari server ke database lokal (last-write-wins berdasarkan updatedAt),
 * dengan pengecualian penting: transaksi yang di perangkat ini sudah berstatus final
 * (paid/void/completed) TIDAK PERNAH ditimpa oleh data dari server, supaya transaksi yang
 * sudah dibayar tidak pernah tertimpa oleh konflik sinkronisasi.
 */
export async function applyRemoteEntities(entities: Partial<Record<SyncEntity, unknown[]>>): Promise<void> {
  for (const [entity, rows] of Object.entries(entities) as [SyncEntity, unknown[] | undefined][]) {
    if (!rows || rows.length === 0) continue
    switch (entity) {
      case 'orders':
        await applyOrders(rows as Order[])
        break
      case 'payments':
        await applyPayments(rows as Payment[])
        break
      default:
        await applyGeneric(entity, rows)
    }
  }
}

async function applyOrders(remoteOrders: Order[]): Promise<void> {
  let newPendingQr = 0
  await db.transaction('rw', db.orders, async () => {
    for (const remote of remoteOrders) {
      const local = await db.orders.get(remote.id)
      if (local && IMMUTABLE_ORDER_STATUSES.has(local.status)) continue
      if (local && local.updatedAt > remote.updatedAt) continue
      if (
        !local &&
        remote.source === 'qr_table' &&
        remote.lifecycleStatus === 'PENDING_CONFIRMATION'
      ) {
        newPendingQr++
      }
      await db.orders.put(remote)
    }
  })
  // Pesanan QR baru dari pelanggan → bunyikan lonceng supaya kasir sadar walau
  // sedang di layar lain.
  if (newPendingQr > 0) {
    try {
      playNewOrderChime()
    } catch {
      /* audio bisa diblokir sebelum interaksi pengguna — abaikan */
    }
  }
  // H11 — kejar penghitung nomor transaksi lokal agar tak bentrok dengan nomor
  // dari perangkat lain setelah keduanya online kembali.
  await reconcileTransactionSequence(remoteOrders.map((o) => o.orderNumber))
}

/**
 * Payment bersifat immutable setelah dibuat: sekali ada baris dengan id yang sama
 * secara lokal, jangan pernah ditimpa (mencegah nominal berubah lewat sync).
 * Id pembayaran deterministik → perangkat berbeda menghasilkan id yang sama → dedup.
 */
async function applyPayments(remotePayments: Payment[]): Promise<void> {
  await db.transaction('rw', db.payments, async () => {
    for (const remote of remotePayments) {
      const local = await db.payments.get(remote.id)
      if (local) continue
      await db.payments.put(remote)
    }
  })
}

async function applyGeneric(entity: SyncEntity, rows: unknown[]): Promise<void> {
  const table = db.table(entity)
  await db.transaction('rw', table, async () => {
    for (const row of rows) {
      const typed = row as { id: string; updatedAt?: number }
      const local = (await table.get(typed.id)) as { updatedAt?: number } | undefined
      if (local && typeof local.updatedAt === 'number' && typeof typed.updatedAt === 'number' && local.updatedAt > typed.updatedAt) {
        continue
      }
      await table.put(row)
    }
  })
}
