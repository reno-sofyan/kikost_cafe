import { consumeServerDeveloperCode } from '@/sync/client'
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
  'Backup → Pulihkan dari Backup (menimpa seluruh data)',
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
