import Dexie from 'dexie'
import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import type { AuditLogEntry } from '@/types/domain'

/**
 * Mencatat satu entri audit. Append-only: tidak ada jalur update/delete.
 * Ikut disinkronkan ke server sehingga jejak audit tidak hilang saat perangkat
 * di-reset. Aman dipanggil di dalam transaksi Dexie `rw` yang sudah mencakup
 * `db.auditLogs` & `db.syncQueue`; bila dipanggil di luar transaksi, membungkus
 * transaksinya sendiri.
 */
export async function recordAuditLog(entry: {
  userId: string
  userName: string
  action: string
  entityType: string
  entityId: string
  details: string
}): Promise<void> {
  const record: AuditLogEntry = { id: newId(), createdAt: Date.now(), ...entry }
  const write = async () => {
    await db.auditLogs.add(record)
    await enqueueSync('auditLogs', record.id, record)
  }
  if (Dexie.currentTransaction) {
    await write()
  } else {
    await db.transaction('rw', db.auditLogs, db.syncQueue, write)
  }
}

export async function listAuditLogs(limit = 200): Promise<AuditLogEntry[]> {
  return db.auditLogs.orderBy('createdAt').reverse().limit(limit).toArray()
}

export async function listAuditLogsByAction(action: string, limit = 200): Promise<AuditLogEntry[]> {
  return db.auditLogs.where('action').equals(action).reverse().limit(limit).toArray()
}
