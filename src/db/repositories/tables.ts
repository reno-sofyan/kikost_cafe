import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
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
    updatedAt: Date.now(),
  }
  await db.cafeTables.add(table)
  return table
}

export async function updateTable(id: string, patch: Partial<Omit<CafeTable, 'id'>>): Promise<void> {
  await db.cafeTables.update(id, { ...patch, updatedAt: Date.now() })
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
