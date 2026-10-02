import { db } from '@/db/schema'
import {
  decryptBackupPayload,
  encryptBackupPayload,
  isEncryptedBackupEnvelope,
  type EncryptedBackupEnvelope,
} from '@/lib/backupCrypto'

const BACKUP_VERSION = 1

export const APP_ID = 'kione-pos'

export interface BackupFile {
  version: number
  createdAt: number
  appId: string
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
    appId: APP_ID,
    tables,
  }
}

/**
 * Ekspor backup **terenkripsi** dengan passphrase (AES-256-GCM, lihat
 * backupCrypto.ts) — jalur yang dipakai tombol "Unduh Backup" di UI. Backup
 * berisi hash+salt PIN semua pengguna, nomor HP pelanggan, dan seluruh riwayat
 * transaksi, jadi tidak boleh keluar perangkat dalam bentuk JSON polos.
 */
export async function exportEncryptedBackup(passphrase: string): Promise<EncryptedBackupEnvelope> {
  const backup = await exportBackup()
  return encryptBackupPayload(JSON.stringify(backup), passphrase, APP_ID)
}

export class BackupPassphraseRequiredError extends Error {
  constructor() {
    super('File backup ini terenkripsi — masukkan passphrase untuk membukanya.')
    this.name = 'BackupPassphraseRequiredError'
  }
}

/**
 * Membaca isi mentah sebuah file backup (hasil `file.text()`) menjadi
 * `BackupFile` siap dipulihkan — menangani DUA bentuk:
 * - **Terenkripsi** (backup baru, lihat `exportEncryptedBackup`): perlu
 *   `passphrase`; tanpa itu melempar `BackupPassphraseRequiredError` supaya UI
 *   bisa menampilkan dialog input passphrase, BUKAN pesan error generik.
 * - **JSON polos** (backup lama dari sebelum enkripsi ada, atau hasil ekspor
 *   manual): dibaca langsung, tanpa passphrase — tetap didukung supaya backup
 *   lama pengguna tidak tiba-tiba tak bisa dipulihkan.
 */
export async function parseBackupFile(rawText: string, passphrase?: string): Promise<BackupFile> {
  let data: unknown
  try {
    data = JSON.parse(rawText)
  } catch {
    throw new Error('File bukan JSON yang sah — pastikan file tidak rusak.')
  }

  if (isEncryptedBackupEnvelope(data)) {
    if (data.appId !== APP_ID) throw new Error('File backup ini bukan dari Kione POS.')
    if (!passphrase) throw new BackupPassphraseRequiredError()
    const plaintext = await decryptBackupPayload(data, passphrase)
    data = JSON.parse(plaintext)
  }

  if (!validateBackupFile(data)) {
    throw new Error('File backup tidak valid atau rusak.')
  }
  return data
}

export function validateBackupFile(data: unknown): data is BackupFile {
  if (typeof data !== 'object' || data === null) return false
  const candidate = data as Partial<BackupFile>
  if (candidate.appId !== APP_ID) return false
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

export function backupFileName(businessName: string): string {
  const date = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const safeName = (businessName.trim() || 'kione-pos').replace(/[^a-zA-Z0-9-_]+/g, '_')
  return `backup-${safeName}-${date}.json`
}
