import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { attendanceReportToCsv, buildAttendanceReport, clockAttendance, formatWorkMinutes, listClockedIn } from '@/db/repositories/attendance'
import { listActiveUsers } from '@/db/repositories/users'
import { durationSince, formatDateTime, formatTime, jakartaDateKey, startOfJakartaDay, startOfJakartaMonth } from '@/lib/datetime'
import { formatNumber } from '@/lib/currency'
import { ROLE_LABELS, roleHasPermission } from '@/lib/permissions'
import { saveTextFile } from '@/lib/saveFile'
import { Modal } from '@/components/ui/Modal'
import { useSessionStore } from '@/state/sessionStore'
import { toast } from '@/state/toastStore'
import type { User } from '@/types/domain'

type Period = 'today' | 'week' | 'month'
const PERIOD_LABELS: Record<Period, string> = { today: 'Hari Ini', week: '7 Hari', month: 'Bulan Ini' }

/** Absensi: karyawan absen masuk/pulang dengan PIN-nya sendiri; pengelola melihat rekap jam kerja. */
export function AttendanceScreen() {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const users = useLiveQuery(() => listActiveUsers(), []) ?? []
  const clockedIn = useLiveQuery(() => listClockedIn(), [])
  const [pinFor, setPinFor] = useState<User | null>(null)
  const [period, setPeriod] = useState<Period>('today')
  const canSeeReport = roleHasPermission(currentUser.role, 'reports.view')
  // Durasi "sudah bekerja" ikut bergerak tanpa perubahan data.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const dayKey = jakartaDateKey(now)
  const range = useMemo(
    () => ({ from: period === 'today' ? startOfJakartaDay(0) : period === 'week' ? startOfJakartaDay(-6) : startOfJakartaMonth(), to: Date.now() + 60_000 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [period, dayKey],
  )
  const report = useLiveQuery(() => (canSeeReport ? buildAttendanceReport(range) : undefined), [canSeeReport, range, clockedIn])
  const sorted = [...users].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-1 text-xl font-bold text-ink-50">Absensi</h1>
      <p className="mb-4 text-sm text-ink-300">Ketuk nama Anda lalu masukkan PIN untuk absen masuk atau pulang.</p>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {sorted.map((u) => {
          const since = clockedIn?.get(u.id)
          return (
            <button key={u.id} onClick={() => setPinFor(u)} className={`card p-4 text-left ${since != null ? 'ring-1 ring-success-600' : ''}`} aria-label={`Absen ${u.name}`}>
              <p className="truncate font-semibold text-ink-50">{u.name}</p>
              <p className="text-xs text-ink-300">{ROLE_LABELS[u.role]}</p>
              {since != null ? (
                <p className="mt-2 text-sm font-semibold text-success-400">
                  Bekerja sejak {formatTime(since)} <span className="font-normal text-ink-300">({durationSince(since, now)})</span>
                </p>
              ) : (
                <p className="mt-2 text-sm text-ink-400">Belum absen masuk</p>
              )}
              <span className={`mt-3 inline-block rounded-lg px-3 py-1.5 text-sm font-semibold ${since != null ? 'bg-ink-800 text-ink-100' : 'bg-brand-600 text-white'}`}>
                {since != null ? 'Absen Pulang' : 'Absen Masuk'}
              </span>
            </button>
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
                    </tr>
                  </thead>
                  <tbody>
                    {report.summary.map((r) => (
                      <tr key={r.userId} className="border-t border-ink-800">
                        <td className="px-4 py-2 text-ink-50">
                          {r.userName}
                          {r.missingOutCount > 0 && <span className="ml-2 text-xs text-yellow-400">{r.missingOutCount}× tanpa absen pulang</span>}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-ink-100">{formatNumber(r.daysPresent)}</td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums text-ink-50">{formatWorkMinutes(r.totalMinutes)}</td>
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
                        <td className="px-4 py-2 text-ink-50">{s.userName}</td>
                        <td className="px-4 py-2 text-ink-200">{formatDateTime(s.clockIn)}</td>
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

      {pinFor && <AttendancePinModal user={pinFor} clockingOut={clockedIn?.has(pinFor.id) ?? false} onClose={() => setPinFor(null)} />}
    </div>
  )
}

function AttendancePinModal({ user, clockingOut, onClose }: { user: User; clockingOut: boolean; onClose: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await clockAttendance(user.id, pin)
      toast.success(res.type === 'in' ? `${res.userName} absen masuk pukul ${formatTime(res.at)}.` : `${res.userName} absen pulang — bekerja ${formatWorkMinutes(res.minutes)}.`)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal absen.')
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-1 text-lg font-bold text-ink-50">
        {clockingOut ? 'Absen Pulang' : 'Absen Masuk'} • {user.name}
      </h2>
      <p className="mb-3 text-sm text-ink-400">Masukkan PIN Anda sendiri.</p>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        autoFocus
        aria-label="PIN absensi"
        className="input-field mb-2 text-center text-2xl tracking-[0.5em]"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && pin.length >= 4) void submit()
        }}
      />
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      <div className="mt-2 flex gap-3">
        <button className="btn-ghost flex-1" onClick={onClose}>
          Batal
        </button>
        <button className="btn-primary flex-[2]" disabled={busy || pin.length < 4} onClick={() => void submit()}>
          {clockingOut ? 'Absen Pulang' : 'Absen Masuk'}
        </button>
      </div>
    </Modal>
  )
}
