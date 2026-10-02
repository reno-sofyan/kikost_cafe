/**
 * Jam yang tidak bisa dimundurkan oleh pengguna perangkat ("monotonic clock").
 *
 * Aplikasi ini offline-first dan memakai `Date.now()` untuk banyak hal yang
 * mengasumsikan waktu selalu maju: `updatedAt` untuk resolusi konflik sinkronisasi
 * (last-write-wins) dan, nanti, masa berlaku lisensi (lihat license.ts). Jam
 * sistem Android sepenuhnya bisa diubah pengguna — sengaja (mencoba
 * memperpanjang lisensi yang kedaluwarsa dengan memundurkan tanggal) maupun
 * tidak sengaja (salah zona waktu, baterai RTC habis lalu reset ke epoch).
 *
 * Solusinya BUKAN mempercayai jam sistem mentah-mentah: setiap kali aplikasi
 * mengamati sebuah waktu (jam sistem saat ini, atau header `Date` dari respons
 * server saat online), waktu tertinggi yang pernah terlihat disimpan ke
 * localStorage. `getTrustedNow()` mengembalikan MAKSIMUM dari jam sistem saat
 * ini dan waktu tertinggi itu — jadi begitu aplikasi pernah melihat waktu T,
 * "sekarang" tidak akan pernah mundur di bawah T lagi pada perangkat itu,
 * bahkan lintas restart aplikasi, walau jam sistem dimundurkan.
 *
 * Ini bukan proteksi sempurna (reset total aplikasi + localStorage tetap bisa
 * mengembalikan ke titik nol), tapi menutup celah paling gampang dieksploitasi:
 * mundurkan jam lalu restart app, tanpa perlu root/tool tambahan.
 */

const LAST_KNOWN_MS_KEY = 'kione.clock.lastKnownMs'

function readStoredLastKnown(): number {
  try {
    const raw = localStorage.getItem(LAST_KNOWN_MS_KEY)
    const n = raw ? Number(raw) : 0
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

function persistIfNewer(ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0) return
  try {
    if (ms > readStoredLastKnown()) localStorage.setItem(LAST_KNOWN_MS_KEY, String(Math.floor(ms)))
  } catch {
    /* localStorage tidak tersedia — jam tetap berfungsi, cuma tanpa proteksi mundur lintas-restart */
  }
}

/** "Sekarang" yang tidak pernah mundur di bawah waktu tertinggi yang pernah diamati perangkat ini. */
export function getTrustedNow(): number {
  const now = Date.now()
  const trusted = Math.max(now, readStoredLastKnown())
  persistIfNewer(trusted)
  return trusted
}

/** Catat sebuah waktu yang dipercaya (mis. dari server) untuk memajukan ratchet — tidak pernah memundurkannya. */
export function noteTrustedTimestamp(ms: number): void {
  persistIfNewer(ms)
}

/** Ratchet maju dari header `Date` sebuah respons HTTP — dipanggil setiap kali backend terjangkau. */
export function noteTrustedTimestampFromResponse(response: Response): void {
  const header = response.headers.get('date')
  if (!header) return
  const ms = Date.parse(header)
  if (!Number.isNaN(ms)) noteTrustedTimestamp(ms)
}

/** true bila jam sistem saat ini berada di bawah waktu tertinggi yang pernah diamati (indikasi jam dimundurkan). */
export function isSystemClockBehindTrusted(): boolean {
  return Date.now() < readStoredLastKnown()
}
