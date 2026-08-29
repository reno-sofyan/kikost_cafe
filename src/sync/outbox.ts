import { db } from '@/db/schema'
import { newId, newIdempotencyKey } from '@/lib/id'
import type { SyncEntity, SyncQueueEntry } from '@/types/domain'

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
