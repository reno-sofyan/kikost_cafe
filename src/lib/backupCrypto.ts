// Enkripsi file backup dengan passphrase — AES-256-GCM lewat WebCrypto, kunci
// diturunkan dari passphrase via PBKDF2 (pola sama dengan pinHash.ts).
//
// Kenapa ini penting: backup mengekspor SELURUH data aplikasi apa adanya —
// termasuk hash+salt PIN semua pengguna, nomor HP pelanggan, dan seluruh
// riwayat transaksi/audit log. File ini biasa dibagikan lewat WhatsApp/email/
// Drive (lihat BackupManager.tsx) — tanpa enkripsi, itu jalur kebocoran PII dan
// data finansial penuh sekali kirim. Passphrase TIDAK PERNAH disimpan di mana
// pun oleh aplikasi (tidak di localStorage, tidak di Dexie) — pemilik usaha
// yang bertanggung jawab mengingatnya sendiri, sama seperti password terenkripsi
// pada umumnya.

const PBKDF2_ITERATIONS = 210_000
const KEY_LENGTH_BITS = 256
const SALT_BYTES = 16
const IV_BYTES = 12

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.substring(i * 2, i * 2 + 2), 16)
  return bytes
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function deriveAesKey(passphrase: string, saltHex: string, iterations: number): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromHex(saltHex) as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH_BITS },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Bentuk berkas backup terenkripsi — dibedakan dari `BackupFile` lama lewat `encrypted: true`. */
export interface EncryptedBackupEnvelope {
  appId: string
  encrypted: true
  envelopeVersion: number
  kdf: 'PBKDF2-SHA256'
  iterations: number
  salt: string
  iv: string
  /** Ciphertext base64 dari JSON `BackupFile` asli (AES-256-GCM, termasuk auth tag). */
  ciphertext: string
}

export function isEncryptedBackupEnvelope(data: unknown): data is EncryptedBackupEnvelope {
  if (typeof data !== 'object' || data === null) return false
  const c = data as Partial<EncryptedBackupEnvelope>
  return (
    c.encrypted === true &&
    typeof c.salt === 'string' &&
    typeof c.iv === 'string' &&
    typeof c.ciphertext === 'string' &&
    typeof c.iterations === 'number'
  )
}

export class BackupPassphraseError extends Error {
  constructor() {
    super('Gagal membuka backup — passphrase salah, atau file rusak/telah diubah.')
    this.name = 'BackupPassphraseError'
  }
}

export class WeakPassphraseError extends Error {
  constructor() {
    super('Passphrase minimal 8 karakter.')
    this.name = 'WeakPassphraseError'
  }
}

const MIN_PASSPHRASE_LENGTH = 8

/** Enkripsi teks JSON backup dengan sebuah passphrase. */
export async function encryptBackupPayload(
  plaintextJson: string,
  passphrase: string,
  appId: string,
): Promise<EncryptedBackupEnvelope> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) throw new WeakPassphraseError()

  const saltBytes = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const ivBytes = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const salt = toHex(saltBytes)
  const key = await deriveAesKey(passphrase, salt, PBKDF2_ITERATIONS)
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBytes as BufferSource },
    key,
    new TextEncoder().encode(plaintextJson) as BufferSource,
  )

  return {
    appId,
    encrypted: true,
    envelopeVersion: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt,
    iv: toHex(ivBytes),
    ciphertext: toBase64(new Uint8Array(ciphertextBuf)),
  }
}

/**
 * Dekripsi sebuah envelope dengan passphrase. Melempar `BackupPassphraseError`
 * bila passphrase salah ATAU ciphertext rusak/diubah — AES-GCM menolak
 * keduanya lewat auth tag, tidak bisa dibedakan (dan memang tak perlu:
 * keduanya sama-sama berarti "tidak bisa dipercaya, jangan dipulihkan").
 */
export async function decryptBackupPayload(envelope: EncryptedBackupEnvelope, passphrase: string): Promise<string> {
  try {
    const key = await deriveAesKey(passphrase, envelope.salt, envelope.iterations)
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromHex(envelope.iv) as BufferSource },
      key,
      fromBase64(envelope.ciphertext) as BufferSource,
    )
    return new TextDecoder().decode(plainBuf)
  } catch {
    throw new BackupPassphraseError()
  }
}
