/**
 * UUID v4. Pakai `crypto.randomUUID()` kalau tersedia; kalau tidak, turun ke
 * `crypto.getRandomValues()` (dukungan jauh lebih luas & lama) untuk merakit
 * UUID v4 manual.
 *
 * `randomUUID()` distandarkan belakangan dan TIDAK selalu ada di WebView custom
 * OEM — ditemukan hilang di WebView HarmonyOS/EMUI pada Huawei MatePad SE
 * (dilaporkan lewat error "crypto.randomUUID is not a function" saat onboarding),
 * padahal `getRandomValues` sudah didukung sejak lama di hampir semua browser/WebView.
 */
export function randomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6]! & 0x0f) | 0x40 // versi 4
    bytes[8] = (bytes[8]! & 0x3f) | 0x80 // varian 10
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  // Fallback terakhir — semestinya tak pernah terpakai. ID di app ini hanya perlu
  // unik secara lokal (kunci Dexie/React), bukan token keamanan, jadi Math.random
  // di sini aman dipakai sebagai jaring pengaman terakhir.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function newId(): string {
  return randomUUID()
}

export function newIdempotencyKey(): string {
  return randomUUID()
}
