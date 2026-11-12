import { db } from '@/db/schema'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { verifyUserPin } from '@/db/repositories/users'
import type { DateRange } from '@/db/repositories/reports'
import { getTrustedNow } from '@/lib/clockGuard'
import { jakartaDateKey } from '@/lib/datetime'
import { getLockoutRemainingMs, recordFailedAttempt, recordSuccessfulAttempt } from '@/lib/loginRateLimit'
import { roleHasPermission, ROLE_LABELS } from '@/lib/permissions'
import type { AuditLogEntry } from '@/types/domain'

/**
 * Absensi karyawan. Tiap absen masuk/pulang dicatat sebagai entri Log Aktivitas
 * (entityType `attendance`, entityId = id karyawan): append-only, berantai-hash, dan
 * ikut sinkron — jadi tak bisa diubah diam-diam dan terbaca dari perangkat lain.
 * Rekap jam kerja dihitung dari pasangan masuk–pulang.
 *
 * Sumber absen:
 *  - `phone`  — jalur utama: HP karyawan + QR dinamis tablet + PIN + selfie, dicatat SERVER
 *               (`attendance.in/out`, deviceId {@link PHONE_CHAIN_DEVICE_ID}). Lihat
 *               backend/src/lib/staffAttendance.ts.
 *  - `manual` — pengecualian (HP mati/tanpa internet): dicatat di tablet dengan PIN
 *               Admin/Pemilik + alasan (`attendance.manual_in/out`), ditandai di rekap.
 *  - `pin`    — absen PIN karyawan sendiri; jalur lama yang sudah dihapus, tetap
 *               dibaca agar riwayat lama utuh.
 */
const ACTION_IN = 'attendance.in'
const ACTION_OUT = 'attendance.out'
const ACTION_MANUAL_IN = 'attendance.manual_in'
const ACTION_MANUAL_OUT = 'attendance.manual_out'
const IN_ACTIONS = new Set([ACTION_IN, ACTION_MANUAL_IN])
const OUT_ACTIONS = new Set([ACTION_OUT, ACTION_MANUAL_OUT])
/** Sama dengan `SERVER_CHAIN_DEVICE_ID` di backend/src/lib/staffAttendance.ts. */
export const PHONE_CHAIN_DEVICE_ID = 'server:absen-hp'
/** Sesi tanpa absen pulang lebih lama dari ini dianggap "lupa absen pulang" (jamnya tak dihitung). */
export const MAX_SESSION_MS = 16 * 60 * 60 * 1000
/** Alasan absen manual minimal sepanjang ini — "lupa" saja tak cukup untuk diaudit. */
export const MANUAL_REASON_MIN = 5
const MANUAL_RATE_LIMIT_SCOPE = 'attendance-manual'

export class WrongPinError extends Error {
  constructor() {
    super('PIN salah.')
    this.name = 'WrongPinError'
  }
}

export type AttendanceSource = 'phone' | 'manual' | 'pin'

export interface AttendanceSession {
  userId: string
  userName: string
  clockIn: number
  /** null = masih bekerja, atau lupa absen pulang (lihat `missingOut`). */
  clockOut: number | null
  missingOut: boolean
  minutes: number
  inSource: AttendanceSource
  outSource: AttendanceSource | null
}

type AttendanceEvent = Pick<AuditLogEntry, 'entityId' | 'userName' | 'action' | 'createdAt'> & Partial<Pick<AuditLogEntry, 'deviceId'>>

export function attendanceSourceOf(e: Pick<AuditLogEntry, 'action'> & Partial<Pick<AuditLogEntry, 'deviceId'>>): AttendanceSource {
  if (e.action === ACTION_MANUAL_IN || e.action === ACTION_MANUAL_OUT) return 'manual'
  return e.deviceId === PHONE_CHAIN_DEVICE_ID ? 'phone' : 'pin'
}

async function attendanceEvents(range?: DateRange): Promise<AuditLogEntry[]> {
  const rows = await db.auditLogs.where('entityType').equals('attendance').toArray()
  return rows.filter((e) => !range || (e.createdAt >= range.from && e.createdAt <= range.to)).sort((a, b) => a.createdAt - b.createdAt)
}

/** Memasangkan absen masuk & pulang tiap karyawan menjadi sesi kerja. */
export function pairAttendance(events: AttendanceEvent[], now: number): AttendanceSession[] {
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
    if (IN_ACTIONS.has(e.action)) {
      if (active) closeAsMissing(active) // absen masuk dua kali → yang pertama tanpa absen pulang
      const session: AttendanceSession = { userId: e.entityId, userName: e.userName, clockIn: e.createdAt, clockOut: null, missingOut: false, minutes: 0, inSource: attendanceSourceOf(e), outSource: null }
      sessions.push(session)
      open.set(e.entityId, session)
    } else if (OUT_ACTIONS.has(e.action) && active) {
      active.clockOut = e.createdAt
      active.minutes = Math.round((e.createdAt - active.clockIn) / 60000)
      active.outSource = attendanceSourceOf(e)
      open.delete(e.entityId)
    }
  }
  for (const s of open.values()) if (now - s.clockIn > MAX_SESSION_MS) s.missingOut = true
  return sessions
}

/** Sesi yang sebagian/seluruhnya dicatat manual — perlu perhatian saat audit. */
export const isManualSession = (s: Pick<AttendanceSession, 'inSource' | 'outSource'>) => s.inSource === 'manual' || s.outSource === 'manual'

/** Karyawan yang sedang bekerja saat ini: userId → jam absen masuk. */
export async function listClockedIn(): Promise<Map<string, number>> {
  const now = getTrustedNow()
  const sessions = pairAttendance(await attendanceEvents({ from: now - 2 * MAX_SESSION_MS, to: now }), now)
  return new Map(sessions.filter((s) => s.clockOut == null && !s.missingOut).map((s) => [s.userId, s.clockIn]))
}

/**
 * Absen manual — pengecualian bila HP karyawan tak bisa dipakai. Wajib disetujui
 * Admin/Pemilik dengan PIN-nya sendiri dan disertai alasan. Penyetuju tidak boleh
 * menyetujui absennya sendiri (kecuali Pemilik). Arah (masuk/pulang) ditentukan dari
 * status terakhir karyawan.
 */
export async function clockAttendanceManual(params: {
  staff: { id: string; name: string }
  approverId: string
  approverPin: string
  reason: string
}): Promise<{ type: 'in' | 'out'; at: number; userName: string; minutes: number }> {
  const reason = params.reason.trim()
  if (reason.length < MANUAL_REASON_MIN) throw new Error(`Tulis alasan absen manual (minimal ${MANUAL_REASON_MIN} huruf).`)
  const lockedMs = getLockoutRemainingMs(MANUAL_RATE_LIMIT_SCOPE)
  if (lockedMs > 0) throw new Error(`Terlalu banyak PIN salah. Coba lagi dalam ${Math.ceil(lockedMs / 1000)} detik.`)
  const approver = await verifyUserPin(params.approverId, params.approverPin)
  if (!approver) {
    recordFailedAttempt(MANUAL_RATE_LIMIT_SCOPE)
    throw new WrongPinError()
  }
  recordSuccessfulAttempt(MANUAL_RATE_LIMIT_SCOPE)
  if (!roleHasPermission(approver.role, 'settings.manage')) throw new Error('Absen manual hanya bisa disetujui Admin atau Pemilik.')
  if (approver.id === params.staff.id && approver.role !== 'pemilik') throw new Error('Absen manual Anda sendiri harus disetujui Admin/Pemilik lain.')

  const clockedInAt = (await listClockedIn()).get(params.staff.id)
  const type = clockedInAt != null ? 'out' : 'in'
  const at = getTrustedNow()
  const minutes = clockedInAt != null ? Math.round((at - clockedInAt) / 60000) : 0
  const by = `disetujui ${approver.name} (${ROLE_LABELS[approver.role]})`
  await recordAuditLog({
    userId: params.staff.id,
    userName: params.staff.name,
    action: type === 'in' ? ACTION_MANUAL_IN : ACTION_MANUAL_OUT,
    entityType: 'attendance',
    entityId: params.staff.id,
    details:
      type === 'in'
        ? `${params.staff.name} absen masuk MANUAL, ${by}. Alasan: ${reason}`
        : `${params.staff.name} absen pulang MANUAL setelah ${formatWorkMinutes(minutes)}, ${by}. Alasan: ${reason}`,
  })
  return { type, at, userName: params.staff.name, minutes }
}

export const ATTENDANCE_SOURCE_LABELS: Record<AttendanceSource, string> = { phone: 'HP', manual: 'Manual', pin: 'PIN' }

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
  /** Sesi yang masuk/pulangnya dicatat manual (pengecualian, disetujui Admin/Pemilik). */
  manualCount: number
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
    const row = byUser.get(s.userId) ?? { userId: s.userId, userName: s.userName, daysPresent: 0, totalMinutes: 0, sessionCount: 0, missingOutCount: 0, manualCount: 0, days: new Set<string>() }
    row.userName = s.userName
    row.days.add(jakartaDateKey(s.clockIn))
    row.sessionCount += 1
    row.totalMinutes += s.minutes
    if (s.missingOut) row.missingOutCount += 1
    if (isManualSession(s)) row.manualCount += 1
    byUser.set(s.userId, row)
  }
  const summary = Array.from(byUser.values())
    .map(({ days, ...row }) => ({ ...row, daysPresent: days.size }))
    .sort((a, b) => a.userName.localeCompare(b.userName))
  return { sessions: sessions.sort((a, b) => b.clockIn - a.clockIn), summary }
}

export function attendanceReportToCsv(report: AttendanceReport, formatDateTime: (t: number) => string): string {
  const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const lines = [['Karyawan', 'Hari Hadir', 'Jumlah Sesi', 'Total Jam', 'Tanpa Absen Pulang', 'Absen Manual'].map(cell).join(',')]
  for (const r of report.summary) lines.push([r.userName, r.daysPresent, r.sessionCount, (r.totalMinutes / 60).toFixed(2), r.missingOutCount, r.manualCount].map(cell).join(','))
  lines.push('')
  lines.push(['Karyawan', 'Masuk', 'Pulang', 'Durasi (menit)', 'Cara Absen', 'Keterangan'].map(cell).join(','))
  for (const s of report.sessions) {
    const via = [ATTENDANCE_SOURCE_LABELS[s.inSource], s.outSource ? ATTENDANCE_SOURCE_LABELS[s.outSource] : null].filter((v, i, a) => v && a.indexOf(v) === i).join(' / ')
    lines.push([s.userName, formatDateTime(s.clockIn), s.clockOut ? formatDateTime(s.clockOut) : '', s.minutes, via, s.missingOut ? 'Tanpa absen pulang' : s.clockOut ? '' : 'Masih bekerja'].map(cell).join(','))
  }
  return lines.join('\n')
}

/**
 * Mode Developer: menghapus SEMUA absen (HP, manual, PIN lama) dari tablet ini, mis. data
 * uji coba. Pengguna, jadwal, transaksi & log lain tak tersentuh; absen yang belum
 * terkirim ikut dibuang dari antrean sync. Penghapusan sendiri dicatat di Log Aktivitas,
 * dan pemeriksaan keutuhan log akan menandai celah rantainya — memang disengaja.
 * Data absen di server tidak ikut terhapus (lihat deploy/scripts/reset-attendance.sql).
 */
export async function clearLocalAttendance(actor: { userId: string; userName: string }): Promise<number> {
  const actions = [ACTION_IN, ACTION_OUT, ACTION_MANUAL_IN, ACTION_MANUAL_OUT]
  const removed = await db.transaction('rw', db.auditLogs, db.syncQueue, async () => {
    const ids = (await db.auditLogs.where('action').anyOf(actions).filter((e) => e.entityType === 'attendance').primaryKeys()) as string[]
    await db.auditLogs.bulkDelete(ids)
    const idSet = new Set(ids)
    await db.syncQueue.filter((q) => q.entity === 'auditLogs' && idSet.has(q.entityId)).delete()
    return ids.length
  })
  await recordAuditLog({
    ...actor,
    action: 'attendance.reset_local',
    entityType: 'settings',
    entityId: 'attendance',
    details: `Mode Developer: ${removed} catatan absen dihapus dari tablet ini.`,
  })
  return removed
}
