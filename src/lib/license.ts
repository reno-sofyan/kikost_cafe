/**
 * LicenseInfo — fondasi kunci/buka aplikasi untuk model SaaS di masa depan,
 * berbasis kriptografi kunci publik (ECDSA P-256 lewat WebCrypto — tersedia
 * di browser & WebView Android, sama seperti pinHash.ts).
 *
 * Model kepercayaan: vendor (kita) menyimpan KUNCI PRIVAT secara offline, tidak
 * pernah masuk repo ini maupun bundel aplikasi (lihat scripts/license/ — tool
 * CLI terpisah yang dijalankan vendor untuk menerbitkan lisensi). Aplikasi hanya
 * membawa KUNCI PUBLIK (`DEFAULT_PUBLIC_KEY_JWK` di bawah) dan bisa
 * MEMVERIFIKASI tanda tangan sebuah lisensi sepenuhnya offline — cocok untuk
 * app offline-first ini, tidak perlu "phone home" ke server lisensi untuk
 * memvalidasi.
 *
 * `DEFAULT_PUBLIC_KEY_JWK` di bawah adalah kunci publik PRODUKSI vendor —
 * pasangan privatnya disimpan di luar repo (mesin vendor + password manager),
 * tidak pernah di-commit. `DEV_PUBLIC_KEY_JWK` adalah kunci CONTOH untuk
 * pengujian; privatnya sengaja ada di scripts/license/dev-keypair.json, jadi
 * lisensi bertanda tangan dev DITOLAK oleh kunci default.
 *
 * Modul ini BELUM dikaitkan ke gerbang apa pun di UI (App.tsx dll.) — ini
 * murni fondasi yang siap dipanggil kapan saja model bisnis SaaS diaktifkan.
 * Menguncikan produk yang sudah berjalan offline-first ke sebuah lisensi
 * adalah keputusan produk, bukan keputusan teknis, jadi sengaja tidak
 * diaktifkan otomatis di sini.
 */

import { getTrustedNow } from '@/lib/clockGuard'

export type LicensePlan = 'trial' | 'standard' | 'pro'

export interface LicensePayload {
  /** ID unik lisensi (mis. UUID) — untuk pencatatan/pencabutan di sisi vendor. */
  licenseId: string
  /** Nama usaha yang lisensinya diterbitkan — pengikatan longgar terhadap Pengaturan > Profil Usaha. */
  businessName: string
  plan: LicensePlan
  /** Epoch ms saat lisensi diterbitkan. */
  issuedAt: number
  /** Epoch ms kedaluwarsa; `null` = tanpa batas waktu (lisensi perpetual/lifetime). */
  expiresAt: number | null
  /** Batas perangkat aktif; `null` = tanpa batas. Penegakan multi-perangkat di luar cakupan modul ini. */
  maxDevices: number | null
}

export interface SignedLicense {
  payload: LicensePayload
  /** Tanda tangan ECDSA P-256/SHA-256 atas bentuk kanonik `payload`, base64. */
  signature: string
}

export type LicenseStatus = 'unlicensed' | 'active' | 'expired' | 'invalid'

export interface LicenseState {
  status: LicenseStatus
  payload: LicensePayload | null
}

export class InvalidLicenseSignatureError extends Error {
  constructor() {
    super('Tanda tangan lisensi tidak valid — berkas lisensi rusak atau telah diubah.')
    this.name = 'InvalidLicenseSignatureError'
  }
}

export class MalformedLicenseError extends Error {
  constructor(detail: string) {
    super(`Berkas lisensi tidak bisa dibaca: ${detail}`)
    this.name = 'MalformedLicenseError'
  }
}

/**
 * Kunci publik PRODUKSI — yang dibawa aplikasi klien. Pasangan privatnya TIDAK
 * PERNAH masuk repo ini (lihat catatan di atas berkas).
 */
export const DEFAULT_PUBLIC_KEY_JWK: JsonWebKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'uqMlD0ot2gF_64TeBdhZkZ07Pfvb1j4SXIMFRBSmx5g',
  y: 'CYDJWlEFHjYEEonqQCCVehb8800q49kZGVA2HtrDADU',
  ext: true,
  key_ops: ['verify'],
}

/**
 * Kunci publik CONTOH/DEV — hanya untuk pengujian. Pasangan privatnya:
 * scripts/license/dev-keypair.json (sengaja di-commit; bukan kunci produksi).
 */
export const DEV_PUBLIC_KEY_JWK: JsonWebKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'OoqPsf3L_MdVO6McKsCOtSQRfPbSytbqJyd5c8GQwJY',
  y: 'BlCj7yTlWg0TYYXWpuumGScsVANNeqC9gVSVIgf-H4o',
  ext: true,
  key_ops: ['verify'],
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Bentuk byte KANONIK dari payload untuk ditandatangani/diverifikasi — urutan
 * field ditulis eksplisit (bukan `JSON.stringify(payload)` langsung) supaya
 * hasilnya tidak pernah bergantung pada urutan key objek JS, yang tidak dijamin
 * stabil antar-engine/serializer dan akan membuat tanda tangan yang sah tampak
 * tidak valid.
 */
export function canonicalLicenseBytes(payload: LicensePayload): Uint8Array {
  const ordered = {
    licenseId: payload.licenseId,
    businessName: payload.businessName,
    plan: payload.plan,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    maxDevices: payload.maxDevices,
  }
  return new TextEncoder().encode(JSON.stringify(ordered))
}

async function importVerifyKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
}

/**
 * Verifikasi tanda tangan sebuah lisensi terhadap kunci publik. Melempar
 * `InvalidLicenseSignatureError` bila tanda tangan tidak cocok (payload
 * diubah, ditandatangani kunci lain, atau field diurutkan ulang secara
 * curang) — TIDAK memeriksa masa berlaku, itu tugas `evaluateLicenseStatus`.
 */
export async function verifySignedLicense(
  license: SignedLicense,
  publicKeyJwk: JsonWebKey = DEFAULT_PUBLIC_KEY_JWK,
): Promise<LicensePayload> {
  const key = await importVerifyKey(publicKeyJwk)
  const signatureBytes = base64ToBytes(license.signature)
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    signatureBytes as BufferSource,
    canonicalLicenseBytes(license.payload) as BufferSource,
  )
  if (!valid) throw new InvalidLicenseSignatureError()
  return license.payload
}

/** Parse string JSON mentah (mis. dari berkas lisensi yang di-import) menjadi `SignedLicense`. */
export function parseSignedLicense(raw: string): SignedLicense {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new MalformedLicenseError('bukan JSON yang sah')
  }
  const p = parsed as Partial<SignedLicense> | null
  if (!p || typeof p !== 'object' || typeof p.signature !== 'string' || !p.payload || typeof p.payload !== 'object') {
    throw new MalformedLicenseError('struktur payload/signature tidak lengkap')
  }
  return p as SignedLicense
}

/**
 * Status lisensi pada suatu waktu. Memakai `getTrustedNow()` (clockGuard.ts),
 * BUKAN `Date.now()` mentah — supaya kasir tidak bisa "memperpanjang" lisensi
 * yang sudah kedaluwarsa sekadar dengan memundurkan jam Android lalu restart
 * aplikasi. Lihat clockGuard.ts untuk detail proteksinya dan batasannya.
 */
export function evaluateLicenseStatus(payload: LicensePayload | null, now: number = getTrustedNow()): LicenseState {
  if (!payload) return { status: 'unlicensed', payload: null }
  if (payload.expiresAt != null && now > payload.expiresAt) return { status: 'expired', payload }
  return { status: 'active', payload }
}

// ---- Penyimpanan lisensi terpasang di perangkat ini ----
// Pola sama dengan sync/deviceConfig.ts: localStorage, try/catch, namespace `kione.*`.

const STORED_LICENSE_KEY = 'kione.license.signed'

export function loadStoredLicense(): SignedLicense | null {
  try {
    const raw = localStorage.getItem(STORED_LICENSE_KEY)
    if (!raw) return null
    return parseSignedLicense(raw)
  } catch {
    return null
  }
}

export function saveStoredLicense(license: SignedLicense): void {
  try {
    localStorage.setItem(STORED_LICENSE_KEY, JSON.stringify(license))
  } catch {
    /* localStorage tidak tersedia — lisensi tidak tersimpan, verifikasi berikutnya gagal aman ke 'unlicensed' */
  }
}

export function clearStoredLicense(): void {
  try {
    localStorage.removeItem(STORED_LICENSE_KEY)
  } catch {
    /* abaikan */
  }
}

/**
 * Titik masuk tunggal: verifikasi + evaluasi lisensi yang tersimpan di
 * perangkat ini. Tanda tangan tidak valid ATAU berkas rusak dianggap
 * 'invalid' (gagal aman — bukan exception yang bisa lolos tak tertangani).
 */
export async function getCurrentLicenseState(publicKeyJwk: JsonWebKey = DEFAULT_PUBLIC_KEY_JWK): Promise<LicenseState> {
  const stored = loadStoredLicense()
  if (!stored) return { status: 'unlicensed', payload: null }
  try {
    const payload = await verifySignedLicense(stored, publicKeyJwk)
    return evaluateLicenseStatus(payload)
  } catch {
    return { status: 'invalid', payload: null }
  }
}
