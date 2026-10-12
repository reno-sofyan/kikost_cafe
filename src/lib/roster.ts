import { jakartaDateKey, jakartaDateTimeToEpoch } from '@/lib/datetime'
import type { StaffRoster } from '@/types/domain'

export const WEEKDAY_LABELS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'] as const
/** Urutan tampil: Senin dulu. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const
/** Toleransi datang sebelum dihitung terlambat. */
export const LATE_GRACE_MINUTES = 10

const DAY_MS = 86_400_000
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export function isValidRosterTime(value: string): boolean {
  return TIME.test(value)
}

/** Hari dalam minggu (0 = Minggu) untuk tanggal WIB `YYYY-MM-DD`. */
export function weekdayOfDateKey(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** Jadwal milik karyawan: cocokkan id dulu, lalu nama (id pengguna berbeda antar perangkat). */
export function rosterFor(roster: Record<string, StaffRoster> | null | undefined, userId: string, userName: string): StaffRoster | null {
  if (!roster) return null
  if (roster[userId]) return roster[userId]
  const wanted = userName.trim().toLowerCase()
  return Object.values(roster).find((r) => r.name.trim().toLowerCase() === wanted) ?? null
}

export interface ScheduledShift {
  dateKey: string
  start: number
  end: number
}

/** Jadwal seorang karyawan pada tanggal WIB tertentu (null = libur). */
export function shiftOn(roster: StaffRoster | null, dateKey: string): ScheduledShift | null {
  const slot = roster?.days[weekdayOfDateKey(dateKey)]
  if (!slot || !isValidRosterTime(slot.start) || !isValidRosterTime(slot.end)) return null
  const start = jakartaDateTimeToEpoch(dateKey, slot.start)
  let end = jakartaDateTimeToEpoch(dateKey, slot.end)
  if (end <= start) end += DAY_MS // melewati tengah malam
  return { dateKey, start, end }
}

export interface RosterSession {
  userId: string
  userName: string
  clockIn: number
}

export interface RosterCompliance {
  userId: string
  userName: string
  scheduledDays: number
  lateCount: number
  lateMinutes: number
  absentCount: number
  absentDates: string[]
}

/** Menit keterlambatan sebuah absen masuk terhadap jadwal hari itu (0 = tepat waktu / tak dijadwalkan). */
export function lateMinutesFor(roster: StaffRoster | null, clockIn: number): number {
  const shift = shiftOn(roster, jakartaDateKey(clockIn))
  // Absen setelah jadwal berakhir = bekerja di luar jadwal, bukan "terlambat" berjam-jam.
  if (!shift || clockIn >= shift.end) return 0
  const late = Math.floor((clockIn - shift.start) / 60_000)
  return late > LATE_GRACE_MINUTES ? late : 0
}

/**
 * Kepatuhan jadwal dalam rentang: terlambat = absen masuk pertama hari itu lewat dari
 * jam mulai + toleransi; tidak hadir = hari terjadwal yang SUDAH berakhir tanpa absen masuk.
 */
export function buildRosterCompliance(
  staff: { userId: string; userName: string }[],
  rosters: Record<string, StaffRoster> | null | undefined,
  sessions: RosterSession[],
  range: { from: number; to: number },
  now: number,
): RosterCompliance[] {
  const out: RosterCompliance[] = []
  for (const person of staff) {
    const roster = rosterFor(rosters, person.userId, person.userName)
    if (!roster || Object.keys(roster.days).length === 0) continue
    const firstInByDay = new Map<string, number>()
    for (const s of sessions) {
      if (s.userId !== person.userId) continue
      const key = jakartaDateKey(s.clockIn)
      if (!firstInByDay.has(key) || s.clockIn < firstInByDay.get(key)!) firstInByDay.set(key, s.clockIn)
    }
    const row: RosterCompliance = { userId: person.userId, userName: person.userName, scheduledDays: 0, lateCount: 0, lateMinutes: 0, absentCount: 0, absentDates: [] }
    const seen = new Set<string>()
    for (let t = range.from; t <= Math.min(range.to, now); t += DAY_MS) {
      const dateKey = jakartaDateKey(t)
      if (seen.has(dateKey)) continue
      seen.add(dateKey)
      const shift = shiftOn(roster, dateKey)
      if (!shift) continue
      const clockIn = firstInByDay.get(dateKey)
      if (clockIn == null) {
        if (shift.end > now) continue // jadwal hari ini belum selesai — belum bisa disebut tidak hadir
        row.scheduledDays += 1
        row.absentCount += 1
        row.absentDates.push(dateKey)
        continue
      }
      row.scheduledDays += 1
      const late = lateMinutesFor(roster, clockIn)
      if (late > 0) {
        row.lateCount += 1
        row.lateMinutes += late
      }
    }
    out.push(row)
  }
  return out
}
