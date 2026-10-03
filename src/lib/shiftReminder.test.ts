import { beforeEach, describe, expect, it } from 'vitest'
import { getShiftReminderAck, latestReminderAt, setShiftReminderAck, shouldShowShiftReminder } from './shiftReminder'

/** Epoch ms untuk jam WIB tertentu (UTC+7). */
const wib = (y: number, m: number, d: number, h: number, min = 0) => Date.UTC(y, m - 1, d, h - 7, min)

describe('latestReminderAt', () => {
  it('sebelum 21.00 → jam 21.00 kemarin; sesudahnya → jam 21.00 hari ini', () => {
    expect(latestReminderAt(wib(2026, 10, 3, 20, 59))).toBe(wib(2026, 10, 2, 21))
    expect(latestReminderAt(wib(2026, 10, 3, 21, 0))).toBe(wib(2026, 10, 3, 21))
    expect(latestReminderAt(wib(2026, 10, 3, 23, 30))).toBe(wib(2026, 10, 3, 21))
  })

  it('lewat tengah malam WIB (masih tanggal kemarin di UTC) tetap benar', () => {
    expect(latestReminderAt(wib(2026, 10, 4, 1, 0))).toBe(wib(2026, 10, 3, 21))
  })
})

describe('shouldShowShiftReminder', () => {
  const openedMorning = wib(2026, 10, 3, 7)

  it('belum jam 21.00 → tidak muncul', () => {
    expect(shouldShowShiftReminder({ shiftOpenedAt: openedMorning, acknowledgedAt: null, now: wib(2026, 10, 3, 20) })).toBe(false)
  })

  it('jam 21.00 lewat & belum dijawab → muncul', () => {
    expect(shouldShowShiftReminder({ shiftOpenedAt: openedMorning, acknowledgedAt: null, now: wib(2026, 10, 3, 21, 1) })).toBe(true)
  })

  it('sudah "Lanjutkan" malam ini → tidak muncul lagi sampai 21.00 besok', () => {
    const ack = wib(2026, 10, 3, 21, 5)
    expect(shouldShowShiftReminder({ shiftOpenedAt: openedMorning, acknowledgedAt: ack, now: wib(2026, 10, 3, 23) })).toBe(false)
    expect(shouldShowShiftReminder({ shiftOpenedAt: openedMorning, acknowledgedAt: ack, now: wib(2026, 10, 4, 12) })).toBe(false)
    expect(shouldShowShiftReminder({ shiftOpenedAt: openedMorning, acknowledgedAt: ack, now: wib(2026, 10, 4, 21) })).toBe(true)
  })

  it('shift dibuka setelah 21.00 → baru ditanya besok malam', () => {
    const openedLate = wib(2026, 10, 3, 22)
    expect(shouldShowShiftReminder({ shiftOpenedAt: openedLate, acknowledgedAt: null, now: wib(2026, 10, 3, 23) })).toBe(false)
    expect(shouldShowShiftReminder({ shiftOpenedAt: openedLate, acknowledgedAt: null, now: wib(2026, 10, 4, 21) })).toBe(true)
  })

  it('aplikasi tertutup saat 21.00, dibuka pagi berikutnya → tetap ditanya', () => {
    expect(shouldShowShiftReminder({ shiftOpenedAt: openedMorning, acknowledgedAt: null, now: wib(2026, 10, 4, 8) })).toBe(true)
  })
})

describe('penyimpanan jawaban', () => {
  beforeEach(() => localStorage.clear())
  it('per shift', () => {
    expect(getShiftReminderAck('s1')).toBeNull()
    setShiftReminderAck('s1', 123)
    expect(getShiftReminderAck('s1')).toBe(123)
    expect(getShiftReminderAck('s2')).toBeNull()
  })
})
