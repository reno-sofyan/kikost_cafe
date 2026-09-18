import { db } from '@/db/schema'
import { newId, newIdempotencyKey } from '@/lib/id'
import type { SyncEntity, SyncQueueEntry } from '@/types/domain'

/** Semua entitas yang disinkronkan ke backend (lih. `SyncEntity`). `users` & `printJobs`
 * sengaja tak termasuk — keduanya tak pernah disinkronkan (lihat tabel `db`/tipe `SyncEntity`). */
async function collectAllLocalEntities(): Promise<{ entity: SyncEntity; id: string; payload: unknown }[]> {
  const [
    orders, orderItems, kitchenTickets, payments, shifts, cashMovements, expenses, returns,
    stockMovements, purchases, stockOpnames, productions, refunds, onlinePayments, bills,
    printers, printRoutes, tableCalls, products, ingredients, recipes, categories, customers,
    cafeTables, outlets, modifierGroups, modifierOptions, settings, auditLogs,
  ] = await Promise.all([
    db.orders.toArray(), db.orderItems.toArray(), db.kitchenTickets.toArray(), db.payments.toArray(),
    db.shifts.toArray(), db.cashMovements.toArray(), db.expenses.toArray(), db.returns.toArray(),
    db.stockMovements.toArray(), db.purchases.toArray(), db.stockOpnames.toArray(), db.productions.toArray(),
    db.refunds.toArray(), db.onlinePayments.toArray(), db.bills.toArray(), db.printers.toArray(),
    db.printRoutes.toArray(), db.tableCalls.toArray(), db.products.toArray(), db.ingredients.toArray(),
    db.recipes.toArray(), db.categories.toArray(), db.customers.toArray(), db.cafeTables.toArray(),
    db.outlets.toArray(), db.modifierGroups.toArray(), db.modifierOptions.toArray(), db.settings.toArray(),
    db.auditLogs.toArray(),
  ])

  const groups: [SyncEntity, { id: string }[]][] = [
    ['orders', orders], ['orderItems', orderItems], ['kitchenTickets', kitchenTickets],
    ['payments', payments], ['shifts', shifts], ['cashMovements', cashMovements],
    ['expenses', expenses], ['returns', returns], ['stockMovements', stockMovements],
    ['purchases', purchases], ['stockOpnames', stockOpnames], ['productions', productions],
    ['refunds', refunds], ['onlinePayments', onlinePayments], ['bills', bills],
    ['printers', printers], ['printRoutes', printRoutes], ['tableCalls', tableCalls],
    ['products', products], ['ingredients', ingredients], ['recipes', recipes],
    ['categories', categories], ['customers', customers], ['cafeTables', cafeTables],
    ['outlets', outlets], ['modifierGroups', modifierGroups], ['modifierOptions', modifierOptions],
    ['settings', settings], ['auditLogs', auditLogs],
  ]

  return groups.flatMap(([entity, rows]) => rows.map((row) => ({ entity, id: row.id, payload: row })))
}

/**
 * Mendorong ULANG seluruh data lokal ke antrean sync, terlepas dari status sync
 * sebelumnya. Dipakai saat backend baru dikonfigurasi di perangkat yang sudah lama
 * dipakai offline (mis. sebelum ini backend belum pernah diisi) — enqueueSync normal
 * hanya terpicu saat data baru DITULIS, jadi data lama yang sudah ada sebelum backend
 * dikonfigurasi tak pernah masuk antrean dengan sendirinya.
 */
export async function enqueueFullResync(): Promise<number> {
  const items = await collectAllLocalEntities()
  const now = Date.now()
  await db.transaction('rw', db.syncQueue, async () => {
    for (const item of items) {
      const entry: SyncQueueEntry = {
        id: newId(),
        entity: item.entity,
        entityId: item.id,
        operation: 'upsert',
        payload: item.payload,
        idempotencyKey: newIdempotencyKey(),
        status: 'pending',
        attempts: 0,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      }
      await db.syncQueue.add(entry)
    }
  })
  return items.length
}

/**
 * Menambahkan entri ke antrean sinkronisasi. HARUS dipanggil di dalam transaksi Dexie
 * yang sama dengan penulisan data lokal, supaya penulisan lokal dan pendaftaran outbox
 * selalu atomik (tidak ada transaksi yang "hilang" dari antrean sync).
 */
export async function enqueueSync(entity: SyncEntity, entityId: string, payload: unknown): Promise<void> {
  const now = Date.now()
  const entry: SyncQueueEntry = {
    id: newId(),
    entity,
    entityId,
    operation: 'upsert',
    payload,
    idempotencyKey: newIdempotencyKey(),
    status: 'pending',
    attempts: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  }
  await db.syncQueue.add(entry)
}

export async function countPendingSync(): Promise<number> {
  return db.syncQueue.where('status').anyOf(['pending', 'failed']).count()
}

export async function listFailedSync(): Promise<SyncQueueEntry[]> {
  return db.syncQueue.where('status').equals('failed').toArray()
}
