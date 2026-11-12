import { consumeServerDeveloperCode, pairDeviceWithCode } from '@/sync/client'
import { isBackendConfigured } from '@/sync/deviceConfig'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { useDeveloperStore } from '@/state/developerStore'

/**
 * Mode Developer: membuka pengaturan teknis yang bisa merusak aplikasi bila diubah
 * klien. Dibuka dengan TOKEN 4 ANGKA dari Konsol Operator (/ops → tenant → Token
 * Developer): sekali pakai, berlaku 10 menit, hangus setelah 5x salah (dicek server).
 * Aktif sampai keluar akun / layar terkunci / aplikasi dimuat ulang — setelah itu perlu
 * token baru dari /ops.
 */
export const DEVELOPER_ONLY = [
  'Sinkronisasi (URL server, kunci perangkat, reset, hapus data tenant)',
  'Backup (unduh & pulihkan seluruh data perangkat)',
  'QRIS → penyedia (statis / Midtrans dinamis)',
  'Pager (koneksi perangkat keras)',
  'Barcode Timbangan (format harga/berat)',
] as const

export const DEVELOPER_TOKEN_LENGTH = 4

export type DeveloperUnlockResult = { ok: true } | { ok: false; message: string }

const REASON_TEXT = {
  no_code: 'Tidak ada token aktif. Buat token baru di Konsol Operator.',
  expired: 'Token sudah kedaluwarsa. Buat token baru di Konsol Operator.',
  burned: 'Token hangus karena terlalu banyak salah. Buat token baru di Konsol Operator.',
} as const

export async function unlockDeveloperMode(token: string, actor: { userId: string; userName: string }): Promise<DeveloperUnlockResult> {
  const code = token.trim()
  if (!new RegExp(`^\\d{${DEVELOPER_TOKEN_LENGTH}}$`).test(code)) return { ok: false, message: `Token harus ${DEVELOPER_TOKEN_LENGTH} angka.` }
  if (!isBackendConfigured()) return { ok: false, message: 'Perangkat belum terhubung ke server. Atur Sinkronisasi dulu.' }
  let result
  try {
    result = await consumeServerDeveloperCode(code)
  } catch {
    return { ok: false, message: 'Tidak bisa menghubungi server. Token developer butuh koneksi internet.' }
  }
  if (!result.ok) {
    await recordAuditLog({ ...actor, action: 'developer.unlock_failed', entityType: 'device', entityId: 'developer', details: `Token developer ditolak (${result.reason})` })
    return { ok: false, message: result.reason === 'invalid' ? `Token salah. Sisa percobaan: ${result.attemptsLeft}.` : REASON_TEXT[result.reason] }
  }
  useDeveloperStore.getState().unlock()
  await recordAuditLog({ ...actor, action: 'developer.unlock', entityType: 'device', entityId: 'developer', details: `Mode Developer dibuka oleh ${actor.userName}` })
  return { ok: true }
}

export function lockDeveloperMode(): void {
  useDeveloperStore.getState().lock()
}

// ---- Tablet BARU (belum punya kunci perangkat): kode pasang dari /ops ----------------

/** Kunci perangkat hasil pemasangan, menunggu disimpan developer di tab Sinkronisasi (alur cek tenant yang ada). */
const PENDING_PAIRING_KEY = 'kione.pendingPairing'

export interface PendingPairing {
  apiBaseUrl: string
  deviceKey: string
}

export function takePendingPairing(): PendingPairing | null {
  try {
    const raw = sessionStorage.getItem(PENDING_PAIRING_KEY)
    if (!raw) return null
    sessionStorage.removeItem(PENDING_PAIRING_KEY)
    return JSON.parse(raw) as PendingPairing
  } catch {
    return null
  }
}

const PAIR_REASON_TEXT = {
  invalid: 'Kode pasang salah atau sudah dipakai. Buat kode baru di Konsol Operator.',
  expired: 'Kode pasang sudah kedaluwarsa. Buat kode baru di Konsol Operator.',
  blocked: 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.',
} as const

/**
 * Tukar kode pasang (8 karakter, dari /ops → Kode Pasang Tablet) → kunci perangkat baru
 * khusus tablet ini, lalu Mode Developer terbuka. Kuncinya TIDAK langsung dipakai: developer
 * menyimpannya di tab Sinkronisasi (isian sudah terisi) supaya pemeriksaan tenant & sinkron
 * awal berjalan lewat alur yang sama seperti biasa.
 */
export async function pairAndUnlockDeveloperMode(
  apiBaseUrl: string,
  code: string,
  label: string,
  actor: { userId: string; userName: string },
): Promise<DeveloperUnlockResult> {
  const cleanCode = code.toUpperCase().replace(/[\s-]/g, '')
  if (!/^[A-Z2-9]{8}$/.test(cleanCode)) return { ok: false, message: 'Kode pasang harus 8 huruf/angka, mis. K7QM-3XPA.' }
  if (!apiBaseUrl.trim()) return { ok: false, message: 'Isi alamat server.' }
  let result
  try {
    result = await pairDeviceWithCode(apiBaseUrl, cleanCode, label)
  } catch {
    return { ok: false, message: 'Tidak bisa menghubungi server. Periksa alamat server & koneksi internet.' }
  }
  if (!result.ok) {
    await recordAuditLog({ ...actor, action: 'developer.pair_failed', entityType: 'device', entityId: 'developer', details: `Kode pasang ditolak (${result.reason})` })
    return { ok: false, message: PAIR_REASON_TEXT[result.reason] }
  }
  try {
    sessionStorage.setItem(PENDING_PAIRING_KEY, JSON.stringify({ apiBaseUrl: apiBaseUrl.trim(), deviceKey: result.deviceKey }))
  } catch {
    return { ok: false, message: 'Penyimpanan perangkat diblokir — tak bisa melanjutkan pemasangan.' }
  }
  useDeveloperStore.getState().unlock()
  await recordAuditLog({ ...actor, action: 'developer.pair', entityType: 'device', entityId: 'developer', details: `Tablet dipasangkan ke server oleh ${actor.userName} (kode pasang); Mode Developer dibuka` })
  return { ok: true }
}
