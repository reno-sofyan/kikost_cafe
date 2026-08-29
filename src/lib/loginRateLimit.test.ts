import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attemptsRemaining,
  getLockoutRemainingMs,
  recordFailedAttempt,
  recordSuccessfulAttempt,
} from './loginRateLimit'

beforeEach(() => {
  sessionStorage.clear()
  vi.useRealTimers()
})

describe('loginRateLimit', () => {
  it('mengurangi sisa percobaan setiap kegagalan', () => {
    expect(attemptsRemaining()).toBe(5)
    recordFailedAttempt()
    recordFailedAttempt()
    expect(attemptsRemaining()).toBe(3)
  })

  it('mengunci setelah 5 kegagalan berturut-turut', () => {
    for (let i = 0; i < 5; i++) recordFailedAttempt()
    expect(getLockoutRemainingMs()).toBeGreaterThan(0)
    expect(getLockoutRemainingMs()).toBeLessThanOrEqual(30_000)
  })

  it('login sukses mereset penghitung & lockout', () => {
    for (let i = 0; i < 5; i++) recordFailedAttempt()
    recordSuccessfulAttempt()
    expect(getLockoutRemainingMs()).toBe(0)
    expect(attemptsRemaining()).toBe(5)
  })

  it('lockout kedaluwarsa setelah durasinya', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    for (let i = 0; i < 5; i++) recordFailedAttempt()
    expect(getLockoutRemainingMs()).toBeGreaterThan(0)
    vi.setSystemTime(new Date('2026-01-01T00:00:31Z'))
    expect(getLockoutRemainingMs()).toBe(0)
  })
})
