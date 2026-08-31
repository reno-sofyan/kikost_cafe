// Rate limiting percobaan login PIN sisi klien (tanpa server auth, PIN diverifikasi lokal).
// Mencegah percobaan PIN bertubi-tubi pada perangkat yang sama.

const STORAGE_KEY = 'kikost.loginAttempts'
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 30_000

interface AttemptState {
  count: number
  lockedUntil: number | null
}

function readState(): AttemptState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return { count: 0, lockedUntil: null }
    return JSON.parse(raw) as AttemptState
  } catch {
    return { count: 0, lockedUntil: null }
  }
}

function writeState(state: AttemptState): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function getLockoutRemainingMs(): number {
  const state = readState()
  if (!state.lockedUntil) return 0
  return Math.max(0, state.lockedUntil - Date.now())
}

export function recordFailedAttempt(): void {
  const state = readState()
  const nextCount = state.count + 1
  if (nextCount >= MAX_ATTEMPTS) {
    writeState({ count: 0, lockedUntil: Date.now() + LOCKOUT_MS })
  } else {
    writeState({ count: nextCount, lockedUntil: state.lockedUntil })
  }
}

export function recordSuccessfulAttempt(): void {
  writeState({ count: 0, lockedUntil: null })
}

export function attemptsRemaining(): number {
  return Math.max(0, MAX_ATTEMPTS - readState().count)
}
