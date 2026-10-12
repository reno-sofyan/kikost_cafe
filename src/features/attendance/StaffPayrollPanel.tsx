import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { AttendanceReport } from '@/db/repositories/attendance'
import { listRecordedPayroll, recordPayrollExpense, saveStaffPay, saveStaffRoster } from '@/db/repositories/staffPay'
import { formatNumber, formatRupiah, parseRupiahInput } from '@/lib/currency'
import { buildPayroll, payFor, payrollToCsv, type PayrollRow } from '@/lib/payroll'
import { rosterFor, WEEKDAY_LABELS, WEEKDAY_ORDER } from '@/lib/roster'
import { ROLE_LABELS } from '@/lib/permissions'
import { saveTextFile } from '@/lib/saveFile'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/state/toastStore'
import type { AppSettings, StaffPay, StaffRoster, User } from '@/types/domain'

type Actor = { userId: string; userName: string }

function rosterSummary(roster: StaffRoster | null): string {
  if (!roster) return 'Belum dijadwalkan'
  const days = WEEKDAY_ORDER.filter((d) => roster.days[d])
  if (days.length === 0) return 'Belum dijadwalkan'
  return days.map((d) => `${WEEKDAY_LABELS[d].slice(0, 3)} ${roster.days[d]!.start}–${roster.days[d]!.end}`).join(', ')
}

function payLabel(pay: StaffPay | null): string {
  return pay ? `${formatRupiah(pay.rate)} / ${pay.type === 'hourly' ? 'jam' : 'hari'}` : 'Belum diatur'
}

/** Daftar karyawan dengan tarif gaji & jadwal mingguannya (pengelola). */
export function StaffSetupSection({ users, settings, actor }: { users: User[]; settings: AppSettings | undefined; actor: Actor }) {
  const [editing, setEditing] = useState<User | null>(null)
  return (
    <div className="mt-8">
      <h2 className="mb-1 font-semibold text-ink-100">Jadwal & Tarif Gaji</h2>
      <p className="mb-3 text-sm text-ink-300">Jadwal dipakai untuk menandai terlambat & tidak hadir; tarif dipakai untuk rekap gaji dari absensi.</p>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-ink-800 text-left text-ink-300">
            <tr>
              <th className="px-4 py-2">Karyawan</th>
              <th className="px-4 py-2">Tarif</th>
              <th className="px-4 py-2">Jadwal mingguan</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const pay = payFor(settings?.staffPay, u.id, u.name)
              const roster = rosterFor(settings?.staffRoster, u.id, u.name)
              return (
                <tr key={u.id} className="border-t border-ink-800">
                  <td className="px-4 py-2 text-ink-50">
                    {u.name} <span className="text-xs text-ink-400">{ROLE_LABELS[u.role]}</span>
                  </td>
                  <td className={`px-4 py-2 ${pay ? 'text-ink-100' : 'text-ink-400'}`}>{payLabel(pay)}</td>
                  <td className={`px-4 py-2 ${roster ? 'text-ink-100' : 'text-ink-400'}`}>{rosterSummary(roster)}</td>
                  <td className="px-4 py-2 text-right">
                    <button className="btn-secondary btn-compact !px-3 text-sm" aria-label={`Atur ${u.name}`} onClick={() => setEditing(u)}>
                      Atur
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {editing && (
        <StaffSetupModal
          user={editing}
          pay={payFor(settings?.staffPay, editing.id, editing.name)}
          roster={rosterFor(settings?.staffRoster, editing.id, editing.name)}
          actor={actor}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function StaffSetupModal({ user, pay, roster, actor, onClose }: { user: User; pay: StaffPay | null; roster: StaffRoster | null; actor: Actor; onClose: () => void }) {
  const [type, setType] = useState<StaffPay['type']>(pay?.type ?? 'hourly')
  const [rate, setRate] = useState(pay?.rate ?? 0)
  const [days, setDays] = useState<StaffRoster['days']>(roster?.days ?? {})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function toggleDay(day: number, on: boolean) {
    setDays((current) => {
      const next = { ...current }
      if (on) next[day] = current[day] ?? { start: '08:00', end: '16:00' }
      else delete next[day]
      return next
    })
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await saveStaffRoster(user.id, { name: user.name, days }, actor)
      await saveStaffPay(user.id, rate > 0 ? { name: user.name, type, rate } : null, actor)
      toast.success(`Jadwal & tarif ${user.name} disimpan.`)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-ink-900 p-6">
      <h2 className="mb-4 text-lg font-bold text-ink-50">Jadwal & Tarif • {user.name}</h2>

      <h3 className="mb-2 text-sm font-semibold text-ink-200">Tarif gaji</h3>
      <div className="mb-2 flex gap-2">
        {(['hourly', 'daily'] as const).map((t) => (
          <button key={t} className={`btn btn-compact flex-1 text-sm ${type === t ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setType(t)}>
            {t === 'hourly' ? 'Per jam kerja' : 'Per hari hadir'}
          </button>
        ))}
      </div>
      <input className="input-field mb-1" inputMode="numeric" aria-label="Tarif gaji" placeholder="Rp0" value={rate ? formatRupiah(rate) : ''} onChange={(e) => setRate(parseRupiahInput(e.target.value))} />
      <p className="mb-4 text-xs text-ink-400">Kosongkan untuk karyawan yang gajinya tidak dihitung dari absensi.</p>

      <h3 className="mb-2 text-sm font-semibold text-ink-200">Jadwal mingguan (WIB)</h3>
      <div className="mb-4 space-y-2">
        {WEEKDAY_ORDER.map((day) => {
          const slot = days[day]
          return (
            <div key={day} className="flex items-center gap-3">
              <label className="flex w-28 flex-none items-center gap-2 text-sm text-ink-100">
                <input type="checkbox" checked={!!slot} aria-label={`Kerja hari ${WEEKDAY_LABELS[day]}`} onChange={(e) => toggleDay(day, e.target.checked)} />
                {WEEKDAY_LABELS[day]}
              </label>
              {slot ? (
                <>
                  <input type="time" className="input-field !py-1.5" aria-label={`Mulai ${WEEKDAY_LABELS[day]}`} value={slot.start} onChange={(e) => setDays((c) => ({ ...c, [day]: { ...slot, start: e.target.value } }))} />
                  <span className="text-ink-400">–</span>
                  <input type="time" className="input-field !py-1.5" aria-label={`Selesai ${WEEKDAY_LABELS[day]}`} value={slot.end} onChange={(e) => setDays((c) => ({ ...c, [day]: { ...slot, end: e.target.value } }))} />
                </>
              ) : (
                <span className="text-sm text-ink-500">Libur</span>
              )}
            </div>
          )
        })}
      </div>
      <p className="mb-3 text-xs text-ink-400">Jam selesai lebih kecil dari jam mulai berarti shift melewati tengah malam.</p>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      <div className="flex gap-3">
        <button className="btn-ghost flex-1" onClick={onClose}>
          Batal
        </button>
        <button className="btn-primary flex-[2]" disabled={busy} onClick={() => void save()}>
          Simpan
        </button>
      </div>
    </Modal>
  )
}

/** Rekap gaji periode terpilih dari absensi + pencatatan sebagai pengeluaran. */
export function PayrollSection({
  report,
  settings,
  periodKey,
  periodLabel,
  actor,
}: {
  report: AttendanceReport
  settings: AppSettings | undefined
  periodKey: string
  periodLabel: string
  actor: Actor
}) {
  const payroll = useMemo(() => buildPayroll(report.summary, settings?.staffPay), [report.summary, settings?.staffPay])
  const recorded = useLiveQuery(() => listRecordedPayroll(periodKey), [periodKey])
  const [paying, setPaying] = useState<PayrollRow | null>(null)
  if (payroll.rows.length === 0) return null

  return (
    <div className="mt-8">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-ink-100">Rekap Gaji • {periodLabel}</h2>
        <button className="btn-secondary btn-compact ml-auto !px-4 text-sm" onClick={() => void saveTextFile(`gaji-${periodKey}.csv`, payrollToCsv(payroll, periodLabel), 'text/csv')}>
          Ekspor Gaji CSV
        </button>
      </div>
      {payroll.missingRateCount > 0 && <p className="mb-2 text-sm text-yellow-400">{payroll.missingRateCount} karyawan belum punya tarif — gajinya belum dihitung.</p>}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-ink-800 text-left text-ink-300">
            <tr>
              <th className="px-4 py-2">Karyawan</th>
              <th className="px-4 py-2">Tarif</th>
              <th className="px-4 py-2 text-right">Hari</th>
              <th className="px-4 py-2 text-right">Jam</th>
              <th className="px-4 py-2 text-right">Gaji kotor</th>
              <th className="px-4 py-2 text-right">Sudah dicatat</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {payroll.rows.map((r) => {
              const paid = recorded?.get(r.userName) ?? 0
              return (
                <tr key={r.userId} className="border-t border-ink-800">
                  <td className="px-4 py-2 text-ink-50">
                    {r.userName}
                    {r.missingOutCount > 0 && <span className="ml-2 text-xs text-yellow-400">{r.missingOutCount}× tanpa absen pulang</span>}
                  </td>
                  <td className={`px-4 py-2 ${r.pay ? 'text-ink-100' : 'text-yellow-400'}`}>{payLabel(r.pay)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-100">{formatNumber(r.daysPresent)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-100">{r.hours.toFixed(1)}</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-ink-50">{r.pay ? formatRupiah(r.gross) : '—'}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${paid > 0 ? 'text-success-400' : 'text-ink-400'}`}>{paid > 0 ? formatRupiah(paid) : '—'}</td>
                  <td className="px-4 py-2 text-right">
                    {r.pay && r.gross > 0 && (
                      <button className="btn-secondary btn-compact !px-3 text-sm" aria-label={`Catat gaji ${r.userName}`} onClick={() => setPaying(r)}>
                        Catat
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            <tr className="border-t border-ink-700 bg-ink-800/50">
              <td className="px-4 py-2 font-semibold text-ink-50" colSpan={4}>
                Total gaji
              </td>
              <td className="px-4 py-2 text-right font-bold tabular-nums text-ink-50">{formatRupiah(payroll.total)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-ink-200">{formatRupiah(Array.from(recorded?.values() ?? []).reduce((s, v) => s + v, 0))}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      {paying && <PayrollExpenseModal row={paying} alreadyPaid={recorded?.get(paying.userName) ?? 0} periodKey={periodKey} periodLabel={periodLabel} actor={actor} onClose={() => setPaying(null)} />}
    </div>
  )
}

function PayrollExpenseModal({ row, alreadyPaid, periodKey, periodLabel, actor, onClose }: { row: PayrollRow; alreadyPaid: number; periodKey: string; periodLabel: string; actor: Actor; onClose: () => void }) {
  const [amount, setAmount] = useState(Math.max(0, row.gross - alreadyPaid))
  const [fromDrawer, setFromDrawer] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await recordPayrollExpense({ userName: row.userName, amount, periodKey, fromDrawer, actor })
      toast.success(`Gaji ${row.userName} dicatat sebagai pengeluaran.`)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal mencatat')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-1 text-lg font-bold text-ink-50">Catat Gaji • {row.userName}</h2>
      <p className="mb-3 text-sm text-ink-400">
        {periodLabel} • gaji kotor {formatRupiah(row.gross)}
        {alreadyPaid > 0 ? ` • sudah dicatat ${formatRupiah(alreadyPaid)}` : ''}. Dicatat ke Pengeluaran kategori “Gaji & Upah”.
      </p>
      <label className="mb-3 block">
        <span className="mb-1 block text-sm text-ink-300">Jumlah dibayar</span>
        <input className="input-field" inputMode="numeric" autoFocus aria-label="Jumlah gaji dibayar" value={formatRupiah(amount)} onChange={(e) => setAmount(parseRupiahInput(e.target.value))} />
      </label>
      {alreadyPaid > 0 && amount + alreadyPaid > row.gross && <p className="mb-2 text-sm text-yellow-400">Total yang dicatat akan melebihi gaji kotor periode ini.</p>}
      <label className="mb-4 flex items-start gap-2 text-sm text-ink-100">
        <input type="checkbox" className="mt-0.5" checked={fromDrawer} onChange={(e) => setFromDrawer(e.target.checked)} />
        <span>
          Dibayar tunai dari laci kasir
          <span className="block text-xs text-ink-400">Mengurangi kas seharusnya pada shift yang sedang buka. Jangan dicentang bila dibayar lewat transfer.</span>
        </span>
      </label>
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      <div className="flex gap-3">
        <button className="btn-ghost flex-1" onClick={onClose}>
          Batal
        </button>
        <button className="btn-primary flex-[2]" disabled={busy || amount <= 0} onClick={() => void save()}>
          Catat Pengeluaran
        </button>
      </div>
    </Modal>
  )
}
