import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attemptsRemaining,
  getLockoutRemainingMs,
  recordFailedAttempt,
  recordSuccessfulAttempt,
} from './loginRateLimit'

beforeEach(() => {
  localStorage.clear()
  vi.useRealTimers()
})

describe('loginRateLimit — cakupan device-wide (tanpa userId, dipakai LockScreen)', () => {
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

describe('loginRateLimit — cakupan per-userId (dipakai LoginScreen)', () => {
  it('kegagalan pada satu akun TIDAK ikut mengunci akun lain di tablet yang sama', () => {
    for (let i = 0; i < 5; i++) recordFailedAttempt('user-a')
    expect(getLockoutRemainingMs('user-a')).toBeGreaterThan(0)
    expect(getLockoutRemainingMs('user-b')).toBe(0)
    expect(attemptsRemaining('user-b')).toBe(5)
  })

  it('cakupan per-user terpisah dari cakupan device-wide', () => {
    for (let i = 0; i < 5; i++) recordFailedAttempt('user-a')
    expect(getLockoutRemainingMs('user-a')).toBeGreaterThan(0)
    expect(getLockoutRemainingMs()).toBe(0) // device-wide (LockScreen) tidak ikut terkunci
  })

  it('sukses pada satu akun tidak mereset lockout akun lain', () => {
    for (let i = 0; i < 5; i++) recordFailedAttempt('user-a')
    recordSuccessfulAttempt('user-b')
    expect(getLockoutRemainingMs('user-a')).toBeGreaterThan(0)
  })
})

describe('loginRateLimit — bertahan lintas "tab baru" (localStorage, bukan sessionStorage)', () => {
  it('state tetap ada setelah modul dimuat ulang (simulasi tab/reload baru)', async () => {
    for (let i = 0; i < 3; i++) recordFailedAttempt('user-a')
    vi.resetModules()
    const fresh = await import('./loginRateLimit')
    expect(fresh.attemptsRemaining('user-a')).toBe(2)
  })
})
