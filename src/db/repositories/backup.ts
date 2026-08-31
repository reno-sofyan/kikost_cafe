import { db } from '@/db/schema'

const BACKUP_VERSION = 1

export interface BackupFile {
  version: number
  createdAt: number
  appId: 'kikost-cafe-pos'
  tables: Record<string, unknown[]>
}

const BACKUP_TABLE_NAMES = [
  'settings',
  'users',
  'auditLogs',
  'categories',
  'products',
  'ingredients',
  'recipes',
  'modifierGroups',
  'modifierOptions',
  'stockMovements',
  'cafeTables',
  'customers',
  'orders',
  'orderItems',
  'payments',
  'shifts',
  'cashMovements',
  'expenses',
  'returns',
] as const

export async function exportBackup(): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {}
  for (const name of BACKUP_TABLE_NAMES) {
    tables[name] = await db.table(name).toArray()
  }
  return {
    version: BACKUP_VERSION,
    createdAt: Date.now(),
    appId: 'kikost-cafe-pos',
    tables,
  }
}

export function validateBackupFile(data: unknown): data is BackupFile {
  if (typeof data !== 'object' || data === null) return false
  const candidate = data as Partial<BackupFile>
  if (candidate.appId !== 'kikost-cafe-pos') return false
  if (typeof candidate.version !== 'number') return false
  if (typeof candidate.tables !== 'object' || candidate.tables === null) return false
  for (const name of BACKUP_TABLE_NAMES) {
    if (!Array.isArray(candidate.tables[name])) return false
  }
  return true
}

/**
 * Memulihkan data dari file backup. Ini MENIMPA seluruh data lokal saat ini, jadi hanya boleh
 * dipanggil setelah konfirmasi eksplisit dari pengguna (mis. saat memulihkan tablet baru).
 */
export async function restoreBackup(file: BackupFile): Promise<void> {
  if (!validateBackupFile(file)) {
    throw new Error('File backup tidak valid atau rusak.')
  }
  await db.transaction('rw', BACKUP_TABLE_NAMES.map((n) => db.table(n)), async () => {
    for (const name of BACKUP_TABLE_NAMES) {
      await db.table(name).clear()
      const rows = file.tables[name] ?? []
      if (rows.length) await db.table(name).bulkPut(rows)
    }
  })
}

export function backupFileName(cafeName: string): string {
  const date = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const safeName = cafeName.replace(/[^a-zA-Z0-9-_]+/g, '_')
  return `backup-${safeName}-${date}.json`
}
