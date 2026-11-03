/**
 * Identitas HP karyawan untuk absensi. Kunci ECDSA P-256 dibuat di browser HP dengan
 * `extractable: false` — kunci privat tak bisa dibaca/disalin keluar, bahkan oleh
 * halaman ini sendiri; hanya bisa dipakai menandatangani. Server menyimpan kunci
 * publiknya saat pendaftaran, jadi absen hanya sah dari browser HP yang didaftarkan.
 *
 * Disimpan di IndexedDB (CryptoKey bisa disimpan apa adanya). Bila data situs dihapus,
 * HP perlu didaftarkan ulang oleh admin.
 */

const DB_NAME = 'kione-absen'
const STORE = 'kv'
const IDENTITY_KEY = 'identity'

export interface PhoneIdentity {
  phoneId: string
  userName: string
  businessName: string
  privateKey: CryptoKey
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export async function loadIdentity(): Promise<PhoneIdentity | null> {
  try {
    return ((await withStore('readonly', (s) => s.get(IDENTITY_KEY))) as PhoneIdentity | undefined) ?? null
  } catch {
    return null
  }
}

export async function saveIdentity(identity: PhoneIdentity): Promise<void> {
  await withStore('readwrite', (s) => s.put(identity, IDENTITY_KEY))
}

export async function clearIdentity(): Promise<void> {
  await withStore('readwrite', (s) => s.delete(IDENTITY_KEY))
}

/** Pasangan kunci baru: kunci privat tak bisa diekspor, kunci publik (JWK) dikirim ke server. */
export async function generatePhoneKey(): Promise<{ privateKey: CryptoKey; publicJwk: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
  return { privateKey: pair.privateKey, publicJwk: await crypto.subtle.exportKey('jwk', pair.publicKey) }
}

function base64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function signMessage(key: CryptoKey, message: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(message))))
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

export interface PunchLocation {
  latitude: number
  longitude: number
  accuracy: number
}

// Pesan yang ditandatangani — HARUS identik dengan backend/src/lib/staffAttendance.ts.
export const challengeMessage = (phoneId: string, qr: string) => `kione-absen/challenge\n${phoneId}\n${qr}`
export const punchMessage = (challengeId: string, selfieSha256: string, location: string) => `kione-absen/punch\n${challengeId}\n${selfieSha256}\n${location}`
export const locationText = (loc: PunchLocation | null) => (loc ? `${loc.latitude.toFixed(6)},${loc.longitude.toFixed(6)},${Math.round(loc.accuracy)}` : '-')

/** Label singkat HP untuk daftar admin, mis. "Android · Chrome". */
export function phoneLabel(ua = navigator.userAgent): string {
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : 'HP'
  const browser = /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /CriOS|Chrome/.test(ua) ? 'Chrome' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'Browser'
  return `${os} · ${browser}`
}
