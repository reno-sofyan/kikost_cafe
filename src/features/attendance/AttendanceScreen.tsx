import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ATTENDANCE_SOURCE_LABELS, attendanceReportToCsv, buildAttendanceReport, formatWorkMinutes, isManualSession, listClockedIn, type AttendanceSession } from '@/db/repositories/attendance'
import { listActiveUsers } from '@/db/repositories/users'
import { getSettings } from '@/db/repositories/settings'
import { PayrollSection, StaffSetupSection } from '@/features/attendance/StaffPayrollPanel'
import { AttendanceQrModal, DeveloperAttendanceReset, ManualAttendanceModal, PhoneAttendanceSettings } from '@/features/attendance/PhoneAttendance'
import { useAttendanceRosterSync } from '@/features/attendance/useAttendanceRosterSync'
import { buildRosterCompliance, lateMinutesFor, rosterFor, shiftOn } from '@/lib/roster'
import { durationSince, formatDateTime, formatTime, jakartaDateKey, startOfJakartaDay, startOfJakartaMonth } from '@/lib/datetime'
import { formatNumber } from '@/lib/currency'
import { ROLE_LABELS, roleHasPermission } from '@/lib/permissions'
import { saveTextFile } from '@/lib/saveFile'
import { useSessionStore } from '@/state/sessionStore'
import type { User } from '@/types/domain'

type Period = 'today' | 'week' | 'month' | 'lastMonth'
const NO_USERS: User[] = []
const PERIOD_LABELS: Record<Period, string> = { today: 'Hari Ini', week: '7 Hari', month: 'Bulan Ini', lastMonth: 'Bulan Lalu' }

/**
 * Absensi. Jalur utama: karyawan absen dari HP-nya dengan memindai QR Absensi di
 * tablet ini + PIN + selfie (lihat PhoneAttendance.tsx). Absen manual hanya pengecualian,
 * disetujui Admin/Pemilik. Pengelola melihat rekap jam kerja & gaji.
 */
export function AttendanceScreen() {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const users = useLiveQuery(() => listActiveUsers(), []) ?? NO_USERS
  const clockedIn = useLiveQuery(() => listClockedIn(), [])
  useAttendanceRosterSync(users)
  const [showQr, setShowQr] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const [period, setPeriod] = useState<Period>('today')
  const canSeeReport = roleHasPermission(currentUser.role, 'reports.view')
  const canManageStaff = roleHasPermission(currentUser.role, 'settings.manage')
  const settings = useLiveQuery(() => getSettings(), [])
  const actor = { userId: currentUser.id, userName: currentUser.name }
  // Durasi "sudah bekerja" ikut bergerak tanpa perubahan data.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const dayKey = jakartaDateKey(now)
  const range = useMemo(
    () =>
      period === 'lastMonth'
        ? { from: startOfJakartaMonth(-1), to: startOfJakartaMonth(0) - 1 }
        : { from: period === 'today' ? startOfJakartaDay(0) : period === 'week' ? startOfJakartaDay(6) : startOfJakartaMonth(), to: Date.now() + 60_000 },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [period, dayKey],
  )
  const report = useLiveQuery(() => (canSeeReport ? buildAttendanceReport(range) : undefined), [canSeeReport, range, clockedIn])
  const sorted = [...users].sort((a, b) => a.name.localeCompare(b.name))
  const rosters = settings?.staffRoster
  // Kepatuhan jadwal (terlambat / tidak hadir) untuk karyawan yang punya jadwal.
  const compliance = useMemo(
    () => new Map((report ? buildRosterCompliance(users.map((u) => ({ userId: u.id, userName: u.name })), rosters, report.sessions, range, now) : []).map((c) => [c.userId, c])),
    [report, users, rosters, range, now],
  )
  const hasRoster = compliance.size > 0
  // Kunci periode untuk catatan gaji: bulan = YYYY-MM supaya tak berubah tiap hari.
  const periodKey = period === 'month' || period === 'lastMonth' ? jakartaDateKey(range.from).slice(0, 7) : period === 'today' ? dayKey : `${jakartaDateKey(range.from)} s.d. ${dayKey}`

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h1 className="mb-1 text-xl font-bold text-ink-50">Absensi</h1>
          <p className="text-sm text-ink-300">Absen dari HP masing-masing: ketuk “QR Absensi”, pindai dengan kamera HP, pilih nama, masukkan PIN, lalu selfie.</p>
        </div>
        <button className="btn-secondary btn-compact !px-4 text-sm" onClick={() => setShowManual(true)}>
          Absen Manual
        </button>
        <button className="btn-primary btn-compact !px-5 text-sm" onClick={() => setShowQr(true)}>
          QR Absensi
        </button>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {sorted.map((u) => {
          const since = clockedIn?.get(u.id)
          return (
            <div key={u.id} className={`card p-4 text-left ${since != null ? 'ring-1 ring-success-600' : ''}`}>
              <p className="truncate font-semibold text-ink-50">{u.name}</p>
              <p className="text-xs text-ink-300">{ROLE_LABELS[u.role]}</p>
              {since != null ? (
                <p className="mt-2 text-sm font-semibold text-success-400">
                  Bekerja sejak {formatTime(since)} <span className="font-normal text-ink-300">({durationSince(since, now)})</span>
                </p>
              ) : (
                <p className="mt-2 text-sm text-ink-400">Belum absen masuk</p>
              )}
              {(() => {
                const roster = rosterFor(rosters, u.id, u.name)
                if (!roster) return null
                const today = shiftOn(roster, dayKey)
                return <p className="mt-1 text-xs text-ink-300">{today ? `Jadwal hari ini ${formatTime(today.start)}–${formatTime(today.end)}` : 'Hari ini libur'}</p>
              })()}
            </div>
          )
        })}
        {sorted.length === 0 && <p className="col-span-full text-sm text-ink-500">Belum ada pengguna aktif.</p>}
      </div>

      {canSeeReport && (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="mr-3 font-semibold text-ink-100">Rekap Kehadiran</h2>
            {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
              <button key={p} onClick={() => setPeriod(p)} className={`btn btn-compact !px-4 text-sm ${period === p ? 'btn-primary' : 'btn-secondary'}`}>
                {PERIOD_LABELS[p]}
              </button>
            ))}
            {report && report.sessions.length > 0 && (
              <button
                className="btn-secondary btn-compact ml-auto !px-4 text-sm"
                onClick={() => void saveTextFile(`absensi-${jakartaDateKey(range.from)}_${dayKey}.csv`, attendanceReportToCsv(report, formatDateTime), 'text/csv')}
              >
                Ekspor CSV
              </button>
            )}
          </div>
          {!report || report.summary.length === 0 ? (
            <p className="card p-6 text-center text-sm text-ink-400">Belum ada absensi pada periode ini.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-ink-800 text-left text-ink-300">
                    <tr>
                      <th className="px-4 py-2">Karyawan</th>
                      <th className="px-4 py-2 text-right">Hari hadir</th>
                      <th className="px-4 py-2 text-right">Total jam kerja</th>
                      {hasRoster && <th className="px-4 py-2 text-right">Terlambat</th>}
                      {hasRoster && <th className="px-4 py-2 text-right">Tidak hadir</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {report.summary.map((r) => (
                      <tr key={r.userId} className="border-t border-ink-800">
                        <td className="px-4 py-2 text-ink-50">
                          {r.userName}
                          {r.missingOutCount > 0 && <span className="ml-2 text-xs text-yellow-400">{r.missingOutCount}× tanpa absen pulang</span>}
                          {r.manualCount > 0 && <span className="ml-2 text-xs text-yellow-400">{r.manualCount}× manual</span>}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-ink-100">{formatNumber(r.daysPresent)}</td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums text-ink-50">{formatWorkMinutes(r.totalMinutes)}</td>
                        {hasRoster && (
                          <td className={`px-4 py-2 text-right tabular-nums ${(compliance.get(r.userId)?.lateCount ?? 0) > 0 ? 'text-yellow-400' : 'text-ink-300'}`}>
                            {compliance.has(r.userId) ? `${compliance.get(r.userId)!.lateCount}× (${compliance.get(r.userId)!.lateMinutes} mnt)` : '—'}
                          </td>
                        )}
                        {hasRoster && (
                          <td className={`px-4 py-2 text-right tabular-nums ${(compliance.get(r.userId)?.absentCount ?? 0) > 0 ? 'text-red-400' : 'text-ink-300'}`}>
                            {compliance.has(r.userId) ? `${compliance.get(r.userId)!.absentCount}×` : '—'}
                          </td>
                        )}
                      </tr>
                    ))}
                    {/* Terjadwal tetapi sama sekali tidak absen pada periode ini. */}
                    {Array.from(compliance.values())
                      .filter((c) => c.absentCount > 0 && !report.summary.some((r) => r.userId === c.userId))
                      .map((c) => (
                        <tr key={c.userId} className="border-t border-ink-800">
                          <td className="px-4 py-2 text-ink-50">{c.userName}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-ink-100">0</td>
                          <td className="px-4 py-2 text-right tabular-nums text-ink-100">—</td>
                          <td className="px-4 py-2 text-right text-ink-300">—</td>
                          <td className="px-4 py-2 text-right tabular-nums text-red-400">{c.absentCount}×</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <div className="card max-h-80 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-ink-800 text-left text-ink-300">
                    <tr>
                      <th className="px-4 py-2">Karyawan</th>
                      <th className="px-4 py-2">Masuk</th>
                      <th className="px-4 py-2">Pulang</th>
                      <th className="px-4 py-2 text-right">Durasi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.sessions.map((s) => (
                      <tr key={`${s.userId}-${s.clockIn}`} className="border-t border-ink-800">
                        <td className="px-4 py-2 text-ink-50">
                          {s.userName}
                          <SourceBadge session={s} />
                        </td>
                        <td className="px-4 py-2 text-ink-200">
                          {formatDateTime(s.clockIn)}
                          {lateMinutesFor(rosterFor(rosters, s.userId, s.userName), s.clockIn) > 0 && (
                            <span className="ml-2 text-xs text-yellow-400">terlambat {lateMinutesFor(rosterFor(rosters, s.userId, s.userName), s.clockIn)} mnt</span>
                          )}
                        </td>
                        <td className={`px-4 py-2 ${s.missingOut ? 'text-yellow-400' : 'text-ink-200'}`}>{s.clockOut ? formatTime(s.clockOut) : s.missingOut ? 'Tidak absen' : 'Masih bekerja'}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-ink-100">{s.clockOut ? formatWorkMinutes(s.minutes) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {canSeeReport && canManageStaff && report && <PayrollSection report={report} settings={settings} periodKey={periodKey} periodLabel={PERIOD_LABELS[period]} actor={actor} />}
      {canManageStaff && <PhoneAttendanceSettings settings={settings} actor={actor} />}
      {canManageStaff && <StaffSetupSection users={sorted} settings={settings} actor={actor} />}
      <DeveloperAttendanceReset actor={actor} />

      {showQr && <AttendanceQrModal settings={settings} onClose={() => setShowQr(false)} />}
      {showManual && <ManualAttendanceModal users={sorted} clockedIn={clockedIn} onClose={() => setShowManual(false)} />}
    </div>
  )
}

/** Cara absen sesi ini; absen manual disorot karena butuh perhatian saat audit. */
function SourceBadge({ session }: { session: AttendanceSession }) {
  const sources = [session.inSource, session.outSource].filter((v, i, a): v is AttendanceSession['inSource'] => v != null && a.indexOf(v) === i)
  const label = sources.map((src) => ATTENDANCE_SOURCE_LABELS[src]).join(' / ')
  return <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${isManualSession(session) ? 'bg-yellow-900/40 text-yellow-300' : 'bg-ink-800 text-ink-300'}`}>{label}</span>
}
