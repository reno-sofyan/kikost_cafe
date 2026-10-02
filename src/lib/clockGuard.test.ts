import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
})

describe('getTrustedNow', () => {
  it('sama dengan Date.now() saat belum pernah mengamati waktu sebelumnya', async () => {
    vi.setSystemTime(1_700_000_000_000)
    const { getTrustedNow } = await import('./clockGuard')

    expect(getTrustedNow()).toBe(1_700_000_000_000)
  })

  it('tidak pernah mundur meski jam sistem dimundurkan (simulasi kasir mengubah tanggal Android)', async () => {
    vi.setSystemTime(1_700_000_100_000)
    const { getTrustedNow } = await import('./clockGuard')
    const highWaterMark = getTrustedNow()

    // Kasir memundurkan jam sistem 1 jam.
    vi.setSystemTime(1_700_000_100_000 - 3_600_000)

    expect(getTrustedNow()).toBe(highWaterMark)
    expect(getTrustedNow()).toBeGreaterThan(Date.now())
  })

  it('bertahan lintas "restart aplikasi" (modul dimuat ulang, localStorage tetap)', async () => {
    vi.setSystemTime(1_700_000_500_000)
    const mod1 = await import('./clockGuard')
    mod1.getTrustedNow()

    vi.resetModules()
    vi.setSystemTime(1_700_000_500_000 - 60_000) // mundur 1 menit lalu "buka lagi" app
    const mod2 = await import('./clockGuard')

    expect(mod2.getTrustedNow()).toBe(1_700_000_500_000)
  })
})

describe('noteTrustedTimestamp', () => {
  it('memajukan ratchet, tapi tidak pernah memundurkannya', async () => {
    vi.setSystemTime(1_700_000_000_000)
    const { getTrustedNow, noteTrustedTimestamp } = await import('./clockGuard')
    getTrustedNow()

    noteTrustedTimestamp(1_700_000_000_000 + 10_000)
    expect(getTrustedNow()).toBeGreaterThanOrEqual(1_700_000_000_000 + 10_000)

    noteTrustedTimestamp(1_700_000_000_000 - 999_999) // waktu "lebih lama" — diabaikan
    expect(getTrustedNow()).toBeGreaterThanOrEqual(1_700_000_000_000 + 10_000)
  })
})

describe('noteTrustedTimestampFromResponse', () => {
  it('mengekstrak & mencatat header Date sebuah respons HTTP', async () => {
    vi.setSystemTime(1_700_000_000_000)
    const { getTrustedNow, noteTrustedTimestampFromResponse } = await import('./clockGuard')
    getTrustedNow()

    const future = new Date(1_700_000_000_000 + 5_000_000).toUTCString()
    const response = new Response(null, { headers: { Date: future } })
    noteTrustedTimestampFromResponse(response)

    expect(getTrustedNow()).toBeGreaterThanOrEqual(1_700_000_000_000 + 5_000_000)
  })

  it('respons tanpa header Date tidak melempar & tidak mengubah apa pun', async () => {
    const { getTrustedNow, noteTrustedTimestampFromResponse } = await import('./clockGuard')
    const before = getTrustedNow()

    expect(() => noteTrustedTimestampFromResponse(new Response(null))).not.toThrow()
    expect(getTrustedNow()).toBe(before)
  })
})

describe('isSystemClockBehindTrusted', () => {
  it('true begitu jam sistem berada di bawah waktu tertinggi yang pernah diamati', async () => {
    vi.setSystemTime(1_700_000_000_000)
    const { getTrustedNow, isSystemClockBehindTrusted } = await import('./clockGuard')
    getTrustedNow()
    expect(isSystemClockBehindTrusted()).toBe(false)

    vi.setSystemTime(1_700_000_000_000 - 1)
    expect(isSystemClockBehindTrusted()).toBe(true)
  })
})
