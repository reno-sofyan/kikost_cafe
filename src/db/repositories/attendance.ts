import { db } from '@/db/schema'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { verifyUserPin } from '@/db/repositories/users'
import type { DateRange } from '@/db/repositories/reports'
import { getTrustedNow } from '@/lib/clockGuard'
import { jakartaDateKey } from '@/lib/datetime'
import type { AuditLogEntry } from '@/types/domain'

/**
 * Absensi karyawan. Tiap absen masuk/pulang dicatat sebagai entri Log Aktivitas
 * (`attendance.in` / `attendance.out`): append-only, berantai-hash, dan ikut
 * sinkron — jadi tak bisa diubah diam-diam dan terbaca dari perangkat lain.
 * Rekap jam kerja dihitung dari pasangan masuk–pulang.
 */
const ACTION_IN = 'attendance.in'
const ACTION_OUT = 'attendance.out'
/** Sesi tanpa absen pulang lebih lama dari ini dianggap "lupa absen pulang" (jamnya tak dihitung). */
export const MAX_SESSION_MS = 16 * 60 * 60 * 1000

export class WrongPinError extends Error {
  constructor() {
    super('PIN salah.')
    this.name = 'WrongPinError'
  }
}

export interface AttendanceSession {
  userId: string
  userName: string
  clockIn: number
  /** null = masih bekerja, atau lupa absen pulang (lihat `missingOut`). */
  clockOut: number | null
  missingOut: boolean
  minutes: number
}

async function attendanceEvents(range?: DateRange): Promise<AuditLogEntry[]> {
  const rows = await db.auditLogs.where('entityType').equals('attendance').toArray()
  return rows.filter((e) => !range || (e.createdAt >= range.from && e.createdAt <= range.to)).sort((a, b) => a.createdAt - b.createdAt)
}

/** Memasangkan absen masuk & pulang tiap karyawan menjadi sesi kerja. */
export function pairAttendance(events: Pick<AuditLogEntry, 'entityId' | 'userName' | 'action' | 'createdAt'>[], now: number): AttendanceSession[] {
  const sessions: AttendanceSession[] = []
  const open = new Map<string, AttendanceSession>()
  const closeAsMissing = (s: AttendanceSession) => {
    s.missingOut = true
    open.delete(s.userId)
  }
  for (const e of [...events].sort((a, b) => a.createdAt - b.createdAt)) {
    const current = open.get(e.entityId)
    if (current && e.createdAt - current.clockIn > MAX_SESSION_MS) closeAsMissing(current)
    const active = open.get(e.entityId)
    if (e.action === ACTION_IN) {
      if (active) closeAsMissing(active) // absen masuk dua kali → yang pertama tanpa absen pulang
      const session: AttendanceSession = { userId: e.entityId, userName: e.userName, clockIn: e.createdAt, clockOut: null, missingOut: false, minutes: 0 }
      sessions.push(session)
      open.set(e.entityId, session)
    } else if (e.action === ACTION_OUT && active) {
      active.clockOut = e.createdAt
      active.minutes = Math.round((e.createdAt - active.clockIn) / 60000)
      open.delete(e.entityId)
    }
  }
  for (const s of open.values()) if (now - s.clockIn > MAX_SESSION_MS) s.missingOut = true
  return sessions
}

/** Karyawan yang sedang bekerja saat ini: userId → jam absen masuk. */
export async function listClockedIn(): Promise<Map<string, number>> {
  const now = getTrustedNow()
  const sessions = pairAttendance(await attendanceEvents({ from: now - 2 * MAX_SESSION_MS, to: now }), now)
  return new Map(sessions.filter((s) => s.clockOut == null && !s.missingOut).map((s) => [s.userId, s.clockIn]))
}

/** Absen dengan PIN milik karyawan itu sendiri. Arah (masuk/pulang) ditentukan dari status terakhirnya. */
export async function clockAttendance(userId: string, pin: string): Promise<{ type: 'in' | 'out'; at: number; userName: string; minutes: number }> {
  const user = await verifyUserPin(userId, pin)
  if (!user) throw new WrongPinError()
  const clockedInAt = (await listClockedIn()).get(userId)
  const type = clockedInAt != null ? 'out' : 'in'
  const at = getTrustedNow()
  const minutes = clockedInAt != null ? Math.round((at - clockedInAt) / 60000) : 0
  await recordAuditLog({
    userId: user.id,
    userName: user.name,
    action: type === 'in' ? ACTION_IN : ACTION_OUT,
    entityType: 'attendance',
    entityId: user.id,
    details: type === 'in' ? `${user.name} absen masuk.` : `${user.name} absen pulang setelah ${formatWorkMinutes(minutes)}.`,
  })
  return { type, at, userName: user.name, minutes }
}

export function formatWorkMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h} jam ${m} mnt` : `${m} mnt`
}

export interface AttendanceSummaryRow {
  userId: string
  userName: string
  daysPresent: number
  totalMinutes: number
  sessionCount: number
  /** Sesi tanpa absen pulang — jamnya tak ikut dihitung. */
  missingOutCount: number
}

export interface AttendanceReport {
  sessions: AttendanceSession[]
  summary: AttendanceSummaryRow[]
}

/** Rekap kehadiran & jam kerja untuk sesi yang DIMULAI dalam rentang. */
export async function buildAttendanceReport(range: DateRange): Promise<AttendanceReport> {
  const now = getTrustedNow()
  // Ambil sedikit setelah rentang supaya absen pulang lewat tengah malam tetap terpasangkan.
  const events = await attendanceEvents({ from: range.from, to: range.to + MAX_SESSION_MS })
  const sessions = pairAttendance(events, now).filter((s) => s.clockIn >= range.from && s.clockIn <= range.to)
  const byUser = new Map<string, AttendanceSummaryRow & { days: Set<string> }>()
  for (const s of sessions) {
    const row = byUser.get(s.userId) ?? { userId: s.userId, userName: s.userName, daysPresent: 0, totalMinutes: 0, sessionCount: 0, missingOutCount: 0, days: new Set<string>() }
    row.userName = s.userName
    row.days.add(jakartaDateKey(s.clockIn))
    row.sessionCount += 1
    row.totalMinutes += s.minutes
    if (s.missingOut) row.missingOutCount += 1
    byUser.set(s.userId, row)
  }
  const summary = Array.from(byUser.values())
    .map(({ days, ...row }) => ({ ...row, daysPresent: days.size }))
    .sort((a, b) => a.userName.localeCompare(b.userName))
  return { sessions: sessions.sort((a, b) => b.clockIn - a.clockIn), summary }
}

export function attendanceReportToCsv(report: AttendanceReport, formatDateTime: (t: number) => string): string {
  const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const lines = [['Karyawan', 'Hari Hadir', 'Jumlah Sesi', 'Total Jam', 'Tanpa Absen Pulang'].map(cell).join(',')]
  for (const r of report.summary) lines.push([r.userName, r.daysPresent, r.sessionCount, (r.totalMinutes / 60).toFixed(2), r.missingOutCount].map(cell).join(','))
  lines.push('')
  lines.push(['Karyawan', 'Masuk', 'Pulang', 'Durasi (menit)', 'Keterangan'].map(cell).join(','))
  for (const s of report.sessions) {
    lines.push([s.userName, formatDateTime(s.clockIn), s.clockOut ? formatDateTime(s.clockOut) : '', s.minutes, s.missingOut ? 'Tanpa absen pulang' : s.clockOut ? '' : 'Masih bekerja'].map(cell).join(','))
  }
  return lines.join('\n')
}
