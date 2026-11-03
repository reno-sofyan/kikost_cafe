import { getApiBaseUrl } from '@/sync/deviceConfig'
import { qrOrderBaseUrlIsUsable } from '@/lib/qrOrderUrl'
import type { AppSettings } from '@/types/domain'

/**
 * QR absensi yang tampil di tablet kasir. Isinya `<jendela>.<kode>`: jendela = waktu
 * dibagi `periodMs`, kode = HMAC-SHA256(rahasia tenant, `absen:<jendela>`) — dihitung
 * di tablet sehingga QR tetap tampil walau tablet offline; server memeriksanya saat HP
 * absen. HARUS identik dengan `qrCodeFor` di backend/src/lib/staffAttendance.ts.
 */
export async function attendanceQrCode(secret: string, window: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`absen:${window}`)))
  let bin = ''
  for (const b of mac) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 12)
}

/**
 * Alamat publik halaman absen HP (`/absen`). Sama urutannya dengan QR ulasan di struk:
 * alamat server sinkronisasi dulu (di APK origin aplikasi `https://localhost` tak bisa
 * dibuka HP lain), lalu basis URL QR meja, lalu origin perangkat.
 */
export function attendancePageBase(settings: Pick<AppSettings, 'qrOrderBaseUrl'> | undefined): string | null {
  const candidates = [getApiBaseUrl(), settings?.qrOrderBaseUrl, typeof window !== 'undefined' ? window.location.origin : '']
  const base = candidates.map((c) => (c ?? '').trim().replace(/\/+$/, '')).find((c) => c !== '' && qrOrderBaseUrlIsUsable(c))
  return base ? `${base}/absen` : null
}
