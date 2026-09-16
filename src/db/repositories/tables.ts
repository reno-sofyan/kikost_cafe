import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import { recordAuditLog } from '@/db/repositories/auditLog'
import type { CafeTable, TableStatus } from '@/types/domain'

export async function listTables(): Promise<CafeTable[]> {
  return db.cafeTables.orderBy('name').toArray()
}

export async function createTable(input: { name: string; area: string; capacity: number }): Promise<CafeTable> {
  const table: CafeTable = {
    id: newId(),
    name: input.name,
    area: input.area,
    capacity: input.capacity,
    status: 'available',
    currentOrderId: null,
    occupiedSince: null,
    guestCount: null,
    qrToken: null,
    qrActive: false,
    posX: null,
    posY: null,
    updatedAt: Date.now(),
  }
  await db.transaction('rw', db.cafeTables, db.syncQueue, async () => {
    await db.cafeTables.add(table)
    await enqueueSync('cafeTables', table.id, table)
  })
  return table
}

/** Simpan posisi meja di kanvas "Susun Denah". Tak perlu audit — kosmetik murni. */
export async function setTablePosition(id: string, posX: number, posY: number): Promise<void> {
  await updateTable(id, { posX: Math.round(posX), posY: Math.round(posY) })
}

export async function updateTable(id: string, patch: Partial<Omit<CafeTable, 'id'>>): Promise<void> {
  await db.transaction('rw', db.cafeTables, db.syncQueue, async () => {
    await db.cafeTables.update(id, { ...patch, updatedAt: Date.now() })
    const updated = await db.cafeTables.get(id)
    if (updated) await enqueueSync('cafeTables', id, updated)
  })
}

/**
 * Menghapus meja HANYA bila belum pernah dipakai untuk pesanan apa pun (menjaga
 * riwayat/laporan tetap utuh — sama seperti `deleteProductIfUnused` di
 * `products.ts`) dan sedang tidak terisi. Meja yang pernah dipakai: nonaktifkan
 * QR-nya saja lewat `setQrActive`, jangan dihapus.
 */
export async function deleteTableIfUnused(id: string): Promise<void> {
  const table = await db.cafeTables.get(id)
  if (!table) return
  if (table.status !== 'available') {
    throw new Error('Meja sedang terisi atau menunggu pembersihan — selesaikan dulu sebelum menghapus.')
  }
  const used = await db.orders.where('tableId').equals(id).count()
  if (used > 0) {
    throw new Error('Meja ini pernah dipakai untuk pesanan — riwayat akan rusak jika dihapus. Nonaktifkan QR-nya saja bila sudah tak dipakai.')
  }
  await db.cafeTables.delete(id)
}

/** Token QR = string acak (bukan id meja). Backend memetakan token → meja/outlet. */
function newQrToken(): string {
  return newId().replace(/-/g, '')
}

/** Membuat / mengganti token QR sebuah meja & mengaktifkannya. Ber-audit. */
export async function issueQrToken(
  tableId: string,
  actor: { userId: string; userName: string },
): Promise<string> {
  const token = newQrToken()
  await db.transaction('rw', db.cafeTables, db.syncQueue, db.auditLogs, async () => {
    const table = await db.cafeTables.get(tableId)
    if (!table) throw new Error('Meja tidak ditemukan')
    const wasActive = table.qrActive
    await db.cafeTables.update(tableId, { qrToken: token, qrActive: true, updatedAt: Date.now() })
    const updated = await db.cafeTables.get(tableId)
    if (updated) await enqueueSync('cafeTables', tableId, updated)
    await recordAuditLog({
      userId: actor.userId,
      userName: actor.userName,
      action: wasActive ? 'qr.token.regenerate' : 'qr.token.issue',
      entityType: 'cafeTable',
      entityId: tableId,
      details: `${wasActive ? 'Regenerasi' : 'Terbitkan'} token QR untuk meja ${table.name}`,
    })
  })
  return token
}

/** Menonaktifkan / mengaktifkan kembali QR tanpa mengganti token & tanpa hapus meja. */
export async function setQrActive(
  tableId: string,
  active: boolean,
  actor: { userId: string; userName: string },
): Promise<void> {
  await db.transaction('rw', db.cafeTables, db.syncQueue, db.auditLogs, async () => {
    const table = await db.cafeTables.get(tableId)
    if (!table) throw new Error('Meja tidak ditemukan')
    await db.cafeTables.update(tableId, { qrActive: active, updatedAt: Date.now() })
    const updated = await db.cafeTables.get(tableId)
    if (updated) await enqueueSync('cafeTables', tableId, updated)
    await recordAuditLog({
      userId: actor.userId,
      userName: actor.userName,
      action: active ? 'qr.token.enable' : 'qr.token.disable',
      entityType: 'cafeTable',
      entityId: tableId,
      details: `${active ? 'Aktifkan' : 'Nonaktifkan'} QR meja ${table.name}`,
    })
  })
}

export async function occupyTable(id: string, orderId: string, guestCount: number): Promise<void> {
  await updateTable(id, {
    status: 'occupied',
    currentOrderId: orderId,
    occupiedSince: Date.now(),
    guestCount,
  })
}

export async function markAwaitingPayment(id: string): Promise<void> {
  const table = await db.cafeTables.get(id)
  if (!table || table.status !== 'occupied') return
  await updateTable(id, { status: 'awaiting_payment' })
}

export async function markNeedsCleaning(id: string): Promise<void> {
  await updateTable(id, {
    status: 'needs_cleaning',
    currentOrderId: null,
    occupiedSince: null,
    guestCount: null,
  })
}

export async function markAvailable(id: string): Promise<void> {
  await updateTable(id, {
    status: 'available',
    currentOrderId: null,
    occupiedSince: null,
    guestCount: null,
  })
}

/** Memindahkan pesanan aktif dari satu meja ke meja lain. */
export async function moveTable(fromTableId: string, toTableId: string): Promise<void> {
  await db.transaction('rw', db.cafeTables, db.orders, db.syncQueue, async () => {
    const fromTable = await db.cafeTables.get(fromTableId)
    const toTable = await db.cafeTables.get(toTableId)
    if (!fromTable || !toTable) throw new Error('Meja tidak ditemukan')
    if (toTable.status === 'occupied' || toTable.status === 'awaiting_payment') {
      throw new Error('Meja tujuan sedang terisi')
    }
    if (!fromTable.currentOrderId) throw new Error('Meja asal tidak memiliki pesanan aktif')

    await db.cafeTables.update(toTableId, {
      status: fromTable.status,
      currentOrderId: fromTable.currentOrderId,
      occupiedSince: fromTable.occupiedSince,
      guestCount: fromTable.guestCount,
      updatedAt: Date.now(),
    })
    await db.cafeTables.update(fromTableId, {
      status: 'available',
      currentOrderId: null,
      occupiedSince: null,
      guestCount: null,
      updatedAt: Date.now(),
    })
    await db.orders.update(fromTable.currentOrderId, { tableId: toTableId, updatedAt: Date.now() })
    const updatedOrder = await db.orders.get(fromTable.currentOrderId)
    if (updatedOrder) await enqueueSync('orders', updatedOrder.id, updatedOrder)
  })
}

export const TABLE_STATUS_LABELS: Record<TableStatus, string> = {
  available: 'Tersedia',
  occupied: 'Terisi',
  awaiting_payment: 'Menunggu Pembayaran',
  needs_cleaning: 'Perlu Dibersihkan',
}
