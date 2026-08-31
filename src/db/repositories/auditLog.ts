import { db } from '@/db/schema'
import { newId } from '@/lib/id'
import type { AuditLogEntry } from '@/types/domain'

export async function recordAuditLog(entry: {
  userId: string
  userName: string
  action: string
  entityType: string
  entityId: string
  details: string
}): Promise<void> {
  const record: AuditLogEntry = {
    id: newId(),
    createdAt: Date.now(),
    ...entry,
  }
  await db.auditLogs.add(record)
}

export async function listAuditLogs(limit = 200): Promise<AuditLogEntry[]> {
  return db.auditLogs.orderBy('createdAt').reverse().limit(limit).toArray()
}
