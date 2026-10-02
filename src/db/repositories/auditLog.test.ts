import { beforeEach, describe, expect, it } from 'vitest'
import { resetLocalDb } from '@/test/db'
import { db } from '@/db/schema'
import { listAuditLogs, recordAuditLog, verifyAuditLogIntegrity } from './auditLog'
import { computeEntryHash } from '@/lib/auditLogIntegrity'

beforeEach(() => resetLocalDb())

const actor = { userId: 'u1', userName: 'Admin' }

describe('recordAuditLog — menulis rantai hash', () => {
  it('entri pertama di perangkat ini punya prevHash null & hash yang bisa diverifikasi ulang', async () => {
    await recordAuditLog({ ...actor, action: 'order.void', entityType: 'order', entityId: 'o1', details: 'test' })
    const [entry] = await listAuditLogs()

    expect(entry.prevHash).toBeNull()
    expect(entry.hash).toEqual(expect.any(String))
    expect(entry.deviceId).toEqual(expect.any(String))

    const { hash, ...rest } = entry
    expect(await computeEntryHash(rest)).toBe(hash)
  })

  it('entri kedua merujuk hash entri pertama sebagai prevHash-nya', async () => {
    await recordAuditLog({ ...actor, action: 'a1', entityType: 'order', entityId: 'o1', details: 'satu' })
    await recordAuditLog({ ...actor, action: 'a2', entityType: 'order', entityId: 'o2', details: 'dua' })

    const entries = (await listAuditLogs()).sort((a, b) => (a.deviceSeq ?? 0) - (b.deviceSeq ?? 0))
    expect(entries[1].prevHash).toBe(entries[0].hash)
  })

  it('verifyAuditLogIntegrity: rantai normal (tanpa manipulasi) semua ok', async () => {
    for (let i = 0; i < 5; i++) {
      await recordAuditLog({ ...actor, action: `a${i}`, entityType: 'order', entityId: `o${i}`, details: `d${i}` })
    }
    const summary = await verifyAuditLogIntegrity()
    expect(summary).toMatchObject({ totalEntries: 5, okCount: 5, brokenCount: 0, unverifiableCount: 0 })
  })

  it('mengedit satu entri langsung lewat Dexie (simulasi akses DevTools) TERDETEKSI oleh verifikasi', async () => {
    for (let i = 0; i < 3; i++) {
      await recordAuditLog({ ...actor, action: `a${i}`, entityType: 'order', entityId: `o${i}`, details: `asli ${i}` })
    }
    const entries = (await listAuditLogs()).sort((a, b) => (a.deviceSeq ?? 0) - (b.deviceSeq ?? 0))

    // Simulasi staf mengedit isi entri langsung lewat DevTools/IndexedDB — tanpa lewat recordAuditLog.
    await db.auditLogs.update(entries[1].id, { details: 'DIUBAH diam-diam untuk menutupi jejak void' })

    const summary = await verifyAuditLogIntegrity()
    expect(summary.brokenCount).toBeGreaterThan(0)
    expect(summary.brokenEntryIds).toContain(entries[1].id)
  })

  it('menghapus satu entri langsung lewat Dexie TERDETEKSI (prevHash entri berikutnya menggantung)', async () => {
    for (let i = 0; i < 3; i++) {
      await recordAuditLog({ ...actor, action: `a${i}`, entityType: 'order', entityId: `o${i}`, details: `d${i}` })
    }
    const entries = (await listAuditLogs()).sort((a, b) => (a.deviceSeq ?? 0) - (b.deviceSeq ?? 0))
    await db.auditLogs.delete(entries[1].id)

    const summary = await verifyAuditLogIntegrity()
    expect(summary.brokenCount).toBeGreaterThan(0)
    expect(summary.brokenEntryIds).toContain(entries[2].id)
  })
})
