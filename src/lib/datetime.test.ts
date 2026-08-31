import { describe, expect, it } from 'vitest'
import { durationSince, jakartaDateKey } from './datetime'

describe('jakartaDateKey', () => {
  it('menggeser ke tanggal WIB (UTC+7)', () => {
    // 2026-03-01T20:00:00Z -> 03:00 WIB tanggal 2
    expect(jakartaDateKey(Date.parse('2026-03-01T20:00:00Z'))).toBe('2026-03-02')
    // 2026-03-01T16:00:00Z -> 23:00 WIB tanggal 1
    expect(jakartaDateKey(Date.parse('2026-03-01T16:00:00Z'))).toBe('2026-03-01')
  })
})

describe('durationSince', () => {
  it('memformat jam & menit', () => {
    expect(durationSince(0, 90 * 60_000)).toBe('1j 30m')
    expect(durationSince(0, 45 * 60_000)).toBe('45m')
    expect(durationSince(0, 0)).toBe('0m')
  })
  it('tidak negatif untuk waktu mundur', () => {
    expect(durationSince(100_000, 0)).toBe('0m')
  })
})
