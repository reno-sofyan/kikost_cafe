import Dexie from 'dexie'
import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import type { AuditLogEntry } from '@/types/domain'
import { getTrustedNow } from '@/lib/clockGuard'
import { getDeviceId } from '@/sync/device'
import {
  computeEntryHash,
  getLastChainHead,
  setLastChainHead,
  verifyAuditLog,
  type AuditLogIntegritySummary,
} from '@/lib/auditLogIntegrity'

/**
 * Mencatat satu entri audit. Append-only: tidak ada jalur update/delete.
 * Ikut disinkronkan ke server sehingga jejak audit tidak hilang saat perangkat
 * di-reset. Aman dipanggil di dalam transaksi Dexie `rw` yang sudah mencakup
 * `db.auditLogs` & `db.syncQueue`; bila dipanggil di luar transaksi, membungkus
 * transaksinya sendiri.
 *
 * Setiap entri dirantai-hash ke entri SEBELUMNYA di perangkat yang sama (lihat
 * auditLogIntegrity.ts) — mengedit/menghapus entri lama langsung lewat
 * IndexedDB akan terdeteksi saat log diverifikasi (`verifyAuditLogIntegrity`),
 * walau tidak bisa dicegah sepenuhnya di klien.
 */
export async function recordAuditLog(entry: {
  userId: string
  userName: string
  action: string
  entityType: string
  entityId: string
  details: string
}): Promise<void> {
  const deviceId = getDeviceId()
  const write = async () => {
    const lastHead = getLastChainHead(deviceId)
    const unsigned: Omit<AuditLogEntry, 'hash'> = {
      id: newId(),
      createdAt: getTrustedNow(),
      deviceId,
      deviceSeq: (lastHead?.seq ?? 0) + 1,
      prevHash: lastHead?.hash ?? null,
      ...entry,
    }
    // `computeEntryHash` memakai WebCrypto (`crypto.subtle.digest`), sebuah promise
    // asli — bukan `Dexie.Promise`. Mengawaitnya langsung di dalam transaksi Dexie
    // memutus zona transaksi (lihat http://bit.ly/2kdckMn, "commit too early"),
    // termasuk transaksi AMBIEN milik pemanggil (mis. checkout.ts yang membungkus
    // recordAuditLog di transaksinya sendiri) — `Dexie.waitFor` menahannya tetap hidup.
    const hash = await Dexie.waitFor(computeEntryHash(unsigned))
    const record: AuditLogEntry = { ...unsigned, hash }
    await db.auditLogs.add(record)
    await enqueueSync('auditLogs', record.id, record)
    setLastChainHead(deviceId, { hash, seq: record.deviceSeq! })
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

/** Verifikasi integritas SELURUH audit log tersimpan di perangkat ini — lihat auditLogIntegrity.ts. */
export async function verifyAuditLogIntegrity(): Promise<AuditLogIntegritySummary> {
  return verifyAuditLog(await db.auditLogs.toArray())
}
