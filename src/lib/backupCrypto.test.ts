import { describe, expect, it } from 'vitest'
import {
  BackupPassphraseError,
  WeakPassphraseError,
  decryptBackupPayload,
  encryptBackupPayload,
  isEncryptedBackupEnvelope,
} from './backupCrypto'

const SAMPLE_JSON = JSON.stringify({ hello: 'world', pin: '1234', phone: '0812xxxx' })
const APP_ID = 'kione-pos'

describe('encryptBackupPayload / decryptBackupPayload', () => {
  it('dekripsi dengan passphrase yang benar mengembalikan JSON asli persis', async () => {
    const envelope = await encryptBackupPayload(SAMPLE_JSON, 'rahasia-usaha-saya', APP_ID)
    const plaintext = await decryptBackupPayload(envelope, 'rahasia-usaha-saya')
    expect(plaintext).toBe(SAMPLE_JSON)
  })

  it('ciphertext tidak pernah memuat teks asli dalam bentuk terbaca', async () => {
    const envelope = await encryptBackupPayload(SAMPLE_JSON, 'rahasia-usaha-saya', APP_ID)
    expect(envelope.ciphertext).not.toContain('1234')
    expect(envelope.ciphertext).not.toContain('world')
    expect(JSON.stringify(envelope)).not.toContain('0812xxxx')
  })

  it('menolak passphrase salah dengan BackupPassphraseError, bukan data rusak yang lolos', async () => {
    const envelope = await encryptBackupPayload(SAMPLE_JSON, 'rahasia-usaha-saya', APP_ID)
    await expect(decryptBackupPayload(envelope, 'passphrase-salah')).rejects.toThrow(BackupPassphraseError)
  })

  it('menolak ciphertext yang diubah (tamper) — auth tag AES-GCM gagal', async () => {
    const envelope = await encryptBackupPayload(SAMPLE_JSON, 'rahasia-usaha-saya', APP_ID)
    const tampered = { ...envelope, ciphertext: envelope.ciphertext.slice(0, -4) + 'AAAA' }
    await expect(decryptBackupPayload(tampered, 'rahasia-usaha-saya')).rejects.toThrow(BackupPassphraseError)
  })

  it('menolak passphrase lebih pendek dari 8 karakter', async () => {
    await expect(encryptBackupPayload(SAMPLE_JSON, 'pendek', APP_ID)).rejects.toThrow(WeakPassphraseError)
  })

  it('dua enkripsi dengan passphrase sama menghasilkan ciphertext & salt/iv berbeda (tidak deterministik)', async () => {
    const a = await encryptBackupPayload(SAMPLE_JSON, 'rahasia-usaha-saya', APP_ID)
    const b = await encryptBackupPayload(SAMPLE_JSON, 'rahasia-usaha-saya', APP_ID)
    expect(a.salt).not.toBe(b.salt)
    expect(a.iv).not.toBe(b.iv)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })
})

describe('isEncryptedBackupEnvelope', () => {
  it('true untuk envelope terenkripsi yang sah', async () => {
    const envelope = await encryptBackupPayload(SAMPLE_JSON, 'rahasia-usaha-saya', APP_ID)
    expect(isEncryptedBackupEnvelope(envelope)).toBe(true)
  })

  it('false untuk backup lama (JSON polos tanpa field encrypted)', () => {
    expect(isEncryptedBackupEnvelope({ appId: APP_ID, version: 1, tables: {} })).toBe(false)
  })

  it('false untuk data acak/bukan objek', () => {
    expect(isEncryptedBackupEnvelope(null)).toBe(false)
    expect(isEncryptedBackupEnvelope('string')).toBe(false)
    expect(isEncryptedBackupEnvelope(42)).toBe(false)
  })
})
