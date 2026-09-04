import { db } from '@/db/schema'
import { reconcileTransactionSequence } from '@/db/repositories/settings'
import { playNewOrderChime } from '@/lib/kitchenSound'
import { enqueueSync } from '@/sync/outbox'
import type { OnlinePayment, Order, Payment, SyncEntity } from '@/types/domain'

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
      case 'refunds':
        await applyAppendOnly('refunds', rows as { id: string }[])
        break
      case 'auditLogs':
        await applyAppendOnly('auditLogs', rows as { id: string }[])
        break
      case 'onlinePayments':
        await applyAppendOnly('onlinePayments', rows as { id: string }[])
        await applyOnlinePayments(rows as OnlinePayment[])
        break
      default:
        await applyGeneric(entity, rows)
    }
  }
}

/**
 * Notifikasi pembayaran online (dari webhook gateway): jalankan `payBill` lokal
 * supaya potong stok + selesaikan order tetap lewat jalur bisnis klien.
 * `payBill` idempoten → aman diproses ulang.
 */
async function applyOnlinePayments(rows: OnlinePayment[]): Promise<void> {
  const { payOrderBill } = await import('@/db/repositories/checkout')
  const { ensureOrderBill, implicitBillId } = await import('@/db/repositories/billing')
  for (const op of rows) {
    try {
      const order = await db.orders.get(op.orderId)
      // Belum dikonfirmasi kasir / order belum ada → coba lagi siklus berikutnya.
      if (!order || order.status === 'void' || order.lifecycleStatus === 'PENDING_CONFIRMATION') continue

      let bill = await db.bills.get(op.billId)
      if (!bill && op.billId === implicitBillId(op.orderId)) {
        await db.transaction('rw', db.orders, db.bills, db.syncQueue, async () => {
          await ensureOrderBill(order)
        })
        bill = await db.bills.get(op.billId)
      }
      if (!bill || bill.paymentStatus === 'PAID' || bill.paymentStatus === 'VOIDED') continue
      await payOrderBill({
        billId: op.billId,
        payments: [{ method: op.method, amount: op.amount, reference: op.reference }],
        confirmedByUserId: 'online',
        allowPartial: true,
      })
      await db.transaction('rw', db.bills, db.syncQueue, async () => {
        const fresh = await db.bills.get(op.billId)
        if (fresh && fresh.onlinePaymentRef !== op.reference) {
          const updated = { ...fresh, onlinePaymentRef: op.reference, updatedAt: Date.now() }
          await db.bills.put(updated)
          await enqueueSync('bills', op.billId, updated)
        }
      })
    } catch {
      /* akan dicoba lagi pada siklus sync berikutnya */
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

/** Entitas append-only (refund, audit log): sekali ada lokal, tak pernah ditimpa. */
async function applyAppendOnly(entity: SyncEntity, rows: { id: string }[]): Promise<void> {
  const table = db.table(entity)
  await db.transaction('rw', table, async () => {
    for (const row of rows) {
      if (await table.get(row.id)) continue
      await table.put(row)
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
