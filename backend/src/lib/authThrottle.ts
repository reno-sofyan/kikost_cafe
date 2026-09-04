/**
 * Rem lunak per-IP setelah beberapa kegagalan autentikasi berturut-turut
 * (defense-in-depth — entropi kunci sudah membuat brute force tak praktis).
 * In-memory: cukup untuk satu instance; reset saat restart.
 */

const WINDOW_MS = 10 * 60_000
const MAX_FAILURES = 10
const BLOCK_MS = 15 * 60_000

interface Entry {
  failures: number[]
  blockedUntil: number
}

const table = new Map<string, Entry>()

function get(ip: string): Entry {
  let e = table.get(ip)
  if (!e) {
    e = { failures: [], blockedUntil: 0 }
    table.set(ip, e)
  }
  return e
}

export function isAuthBlocked(ip: string): boolean {
  const e = table.get(ip)
  return !!e && e.blockedUntil > Date.now()
}

export function recordAuthFailure(ip: string): void {
  const now = Date.now()
  const e = get(ip)
  e.failures = e.failures.filter((t) => now - t < WINDOW_MS)
  e.failures.push(now)
  if (e.failures.length >= MAX_FAILURES) {
    e.blockedUntil = now + BLOCK_MS
    e.failures = []
  }
}

export function recordAuthSuccess(ip: string): void {
  table.delete(ip)
}

/** Buang entri kedaluwarsa — panggil berkala agar map tak tumbuh tanpa batas. */
export function pruneAuthThrottle(): void {
  const now = Date.now()
  for (const [ip, e] of table) {
    if (e.blockedUntil < now && (e.failures.length === 0 || now - e.failures[e.failures.length - 1] > WINDOW_MS)) {
      table.delete(ip)
    }
  }
}

/** Hanya untuk pengujian. */
export function _resetAuthThrottle(): void {
  table.clear()
}
