import { beforeEach, describe, expect, it } from 'vitest'
import { resetLocalDb } from '@/test/db'
import { db } from '@/db/schema'
import {
  APP_ID,
  BackupPassphraseRequiredError,
  exportBackup,
  exportEncryptedBackup,
  parseBackupFile,
  restoreBackup,
  validateBackupFile,
} from './backup'
import { BackupPassphraseError } from '@/lib/backupCrypto'

beforeEach(() => resetLocalDb())

describe('exportEncryptedBackup + parseBackupFile — jalur baru (terenkripsi)', () => {
  it('round-trip: ekspor terenkripsi lalu dibuka lagi dengan passphrase yang sama menghasilkan data identik', async () => {
    await db.categories.put({ id: 'c1', name: 'Minuman', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })
    const original = await exportBackup()

    const envelope = await exportEncryptedBackup('kunci-rahasia-toko')
    const raw = JSON.stringify(envelope)

    const restored = await parseBackupFile(raw, 'kunci-rahasia-toko')
    // `createdAt` top-level snapshot boleh beda beberapa ms antara dua panggilan
    // exportBackup() di atas (bukan hal yang diuji di sini) — bandingkan isi
    // tabelnya, yang harus identik persis.
    expect(restored.tables).toEqual(original.tables)
    expect(restored.appId).toBe(original.appId)
    expect(restored.version).toBe(original.version)
  })

  it('tanpa passphrase melempar BackupPassphraseRequiredError (bukan error generik) — sinyal bagi UI untuk membuka dialog', async () => {
    const envelope = await exportEncryptedBackup('kunci-rahasia-toko')
    await expect(parseBackupFile(JSON.stringify(envelope))).rejects.toThrow(BackupPassphraseRequiredError)
  })

  it('passphrase salah melempar BackupPassphraseError, tidak pernah mengembalikan data', async () => {
    const envelope = await exportEncryptedBackup('kunci-rahasia-toko')
    await expect(parseBackupFile(JSON.stringify(envelope), 'passphrase-keliru')).rejects.toThrow(BackupPassphraseError)
  })

  it('file dari appId lain ditolak sebelum sempat dicoba didekripsi', async () => {
    const envelope = await exportEncryptedBackup('kunci-rahasia-toko')
    const foreign = { ...envelope, appId: 'aplikasi-lain' }
    await expect(parseBackupFile(JSON.stringify(foreign), 'kunci-rahasia-toko')).rejects.toThrow('bukan dari Kione POS')
  })
})

describe('parseBackupFile — kompatibilitas mundur (backup lama, JSON polos)', () => {
  it('backup lama tanpa enkripsi tetap bisa dibaca tanpa passphrase', async () => {
    const legacy = await exportBackup() // bentuk lama: BackupFile polos, tanpa envelope
    const restored = await parseBackupFile(JSON.stringify(legacy))
    expect(restored).toEqual(legacy)
  })

  it('JSON rusak/tidak valid ditolak dengan pesan jelas', async () => {
    await expect(parseBackupFile('bukan json{{')).rejects.toThrow('bukan JSON')
  })

  it('JSON valid tapi bukan backup Kione POS ditolak oleh validateBackupFile', async () => {
    await expect(parseBackupFile(JSON.stringify({ foo: 'bar' }))).rejects.toThrow('tidak valid')
  })
})

describe('restoreBackup', () => {
  it('menimpa data lokal dengan isi file backup yang sudah divalidasi/didekripsi', async () => {
    await db.categories.put({ id: 'old', name: 'Lama', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })
    const envelope = await exportEncryptedBackup('kunci-rahasia-toko') // snapshot berisi 'old'

    await db.categories.clear()
    await db.categories.put({ id: 'new', name: 'Baru', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })

    const file = await parseBackupFile(JSON.stringify(envelope), 'kunci-rahasia-toko')
    await restoreBackup(file)

    const categories = await db.categories.toArray()
    expect(categories.map((c) => c.id)).toEqual(['old'])
  })
})

describe('validateBackupFile', () => {
  it('appId harus cocok', () => {
    expect(validateBackupFile({ appId: 'lain', version: 1, tables: {} })).toBe(false)
    expect(validateBackupFile({ appId: APP_ID, version: 1, tables: {} })).toBe(false) // tabel wajib ada, kosong pun sbg array
  })
})
