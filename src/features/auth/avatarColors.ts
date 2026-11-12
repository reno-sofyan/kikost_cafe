/**
 * Warna avatar akun di layar masuk: tetap (deterministik) per nama, supaya kasir mengenali
 * akunnya dari warna yang sama setiap hari, dan akun berbeda mudah dibedakan. Kelas
 * ditulis utuh (bukan dirangkai) supaya ikut terbaca Tailwind; nilainya di tailwind.config.
 */
export const AVATAR_CLASSES = [
  'bg-brand-600',
  'bg-avatar-sky',
  'bg-avatar-teal',
  'bg-avatar-emerald',
  'bg-avatar-amber',
  'bg-avatar-rose',
  'bg-avatar-violet',
  'bg-avatar-slate',
] as const

/** Hash FNV-1a 32-bit — stabil lintas perangkat & versi (tak bergantung Math.random). */
function hashName(name: string): number {
  let h = 0x811c9dc5
  for (const ch of name.trim().toLowerCase()) {
    h ^= ch.codePointAt(0) ?? 0
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function avatarClassFor(name: string): (typeof AVATAR_CLASSES)[number] {
  return AVATAR_CLASSES[hashName(name) % AVATAR_CLASSES.length]
}

export function accountInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

/** "Terakhir masuk …" yang ringkas; null bila belum pernah tercatat. */
export function lastLoginLabel(at: number | null | undefined, now: number): string | null {
  if (!at) return null
  const min = Math.floor((now - at) / 60_000)
  if (min < 1) return 'Baru saja masuk'
  if (min < 60) return `Masuk ${min} menit lalu`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `Masuk ${hours} jam lalu`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'Masuk kemarin' : `Masuk ${days} hari lalu`
}
