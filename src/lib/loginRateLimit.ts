// Rate limiting percobaan login PIN sisi klien (tanpa server auth, PIN diverifikasi lokal).
// Mencegah percobaan PIN bertubi-tubi pada perangkat yang sama.
//
// PENTING soal batasannya: ini adalah pengaman terhadap orang yang mencoba-coba
// PIN lewat layar sentuh (mis. pelanggan iseng di kasir), BUKAN terhadap
// penyerang teknis. Verifikasi PIN (`pinHash.ts`) berjalan 100% di klien —
// siapa pun dengan akses DevTools/IndexedDB ke perangkat ini bisa melihat/ubah
// data tanpa lewat PIN sama sekali, sehingga tidak melewati limiter ini, tapi
// melewati SELURUH mekanisme login. Menutup celah itu butuh sebagian verifikasi
// pindah ke server — tidak cocok untuk mode aplikasi yang berjalan tanpa backend.
//
// Disimpan di `localStorage` (bukan `sessionStorage`) supaya lockout bertahan
// lintas tab & reload di perangkat yang sama — sessionStorage sebelumnya bisa
// di-reset semudah membuka tab baru, mengalahkan tujuan "perangkat yang sama"
// di atas.

const STORAGE_KEY = 'kione.loginAttempts'
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 30_000
/** Cakupan dipakai saat tidak ada userId spesifik (mis. LockScreen, yang belum tahu
 *  akun mana yang dituju sampai PIN cocok — lihat findUserByPin). */
const DEVICE_SCOPE = '__device__'

interface AttemptState {
  count: number
  lockedUntil: number | null
}

type StoredAttempts = Record<string, AttemptState>

function readAll(): StoredAttempts {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as StoredAttempts
  } catch {
    return {}
  }
}

function writeAll(state: StoredAttempts): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* localStorage tidak tersedia — rate limit tak tersimpan lintas reload, tapi login tetap jalan */
  }
}

function scopeKey(userId?: string): string {
  return userId ? `user:${userId}` : DEVICE_SCOPE
}

function readState(scope: string): AttemptState {
  return readAll()[scope] ?? { count: 0, lockedUntil: null }
}

function writeState(scope: string, state: AttemptState): void {
  const all = readAll()
  all[scope] = state
  writeAll(all)
}

/**
 * `userId` men-scope lockout per akun (dipakai `LoginScreen`, yang sudah tahu
 * akun mana yang dituju sebelum PIN dimasukkan) — supaya percobaan gagal pada
 * satu akun tidak ikut mengunci akun lain di tablet yang sama. Tanpa `userId`
 * (dipakai `LockScreen`, yang belum tahu akun tujuan) → cakupan device-wide.
 */
export function getLockoutRemainingMs(userId?: string): number {
  const state = readState(scopeKey(userId))
  if (!state.lockedUntil) return 0
  return Math.max(0, state.lockedUntil - Date.now())
}

export function recordFailedAttempt(userId?: string): void {
  const scope = scopeKey(userId)
  const state = readState(scope)
  const nextCount = state.count + 1
  if (nextCount >= MAX_ATTEMPTS) {
    writeState(scope, { count: 0, lockedUntil: Date.now() + LOCKOUT_MS })
  } else {
    writeState(scope, { count: nextCount, lockedUntil: state.lockedUntil })
  }
}

export function recordSuccessfulAttempt(userId?: string): void {
  writeState(scopeKey(userId), { count: 0, lockedUntil: null })
}

export function attemptsRemaining(userId?: string): number {
  return Math.max(0, MAX_ATTEMPTS - readState(scopeKey(userId)).count)
}
