import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { buildSalesReport, type ProductSalesRow } from '@/db/repositories/reports'
import { getSettings, updateSettings } from '@/db/repositories/settings'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { buildFeedbackReport } from '@/db/repositories/feedback'
import { formatNumber, formatRupiah, parseRupiahInput } from '@/lib/currency'
import { formatDateTime, jakartaDateKey, startOfJakartaDay, startOfJakartaMonth } from '@/lib/datetime'
import { buildMenuEngineering, MENU_CLASS_INFO, type MenuClass } from '@/lib/menuEngineering'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/state/toastStore'

const CLASS_TONE: Record<MenuClass, string> = {
  star: 'bg-success-600/15 text-success-400',
  plowhorse: 'bg-brand-600/15 text-brand-400',
  puzzle: 'bg-yellow-900/25 text-yellow-400',
  dog: 'bg-red-900/25 text-red-400',
}

/** Analisis menu: tiap menu dikelompokkan dari kelarisan & margin per porsinya. */
export function MenuEngineeringSection({ sales }: { sales: ProductSalesRow[] }) {
  const analysis = useMemo(() => buildMenuEngineering(sales), [sales])
  const [filter, setFilter] = useState<MenuClass | 'all'>('all')
  if (analysis.rows.length < 4) return null
  const rows = filter === 'all' ? analysis.rows : analysis.rows.filter((r) => r.menuClass === filter)

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-ink-100">Analisis Menu</h3>
        <p className="text-xs text-ink-300">
          Laris = minimal {analysis.popularityThresholdPercent.toFixed(1)}% porsi terjual • Untung = margin per porsi minimal {formatRupiah(Math.round(analysis.averageMarginPerUnit))}
        </p>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(Object.keys(MENU_CLASS_INFO) as MenuClass[]).map((c) => (
          <button
            key={c}
            onClick={() => setFilter(filter === c ? 'all' : c)}
            aria-pressed={filter === c}
            className={`card p-4 text-left ${filter === c ? 'ring-2 ring-brand-600' : ''}`}
          >
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${CLASS_TONE[c]}`}>{MENU_CLASS_INFO[c].label}</span>
            <p className="mt-2 text-2xl font-bold tabular-nums text-ink-50">{formatNumber(analysis.counts[c])}</p>
            <p className="text-xs text-ink-300">{MENU_CLASS_INFO[c].summary}</p>
            <p className="mt-1 text-xs text-ink-400">{MENU_CLASS_INFO[c].advice}</p>
          </button>
        ))}
      </div>
      <div className="card max-h-96 overflow-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="sticky top-0 bg-ink-800 text-left text-ink-300">
            <tr>
              <th className="px-4 py-2">Menu</th>
              <th className="px-4 py-2">Kelompok</th>
              <th className="px-4 py-2 text-right">Terjual</th>
              <th className="px-4 py-2 text-right">Margin / porsi</th>
              <th className="px-4 py-2 text-right">Total margin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.productId} className="border-t border-ink-800">
                <td className="px-4 py-2 text-ink-50">
                  {r.productName}
                  {r.missingCost && <span className="ml-2 text-xs text-yellow-400">HPP kosong</span>}
                </td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${CLASS_TONE[r.menuClass]}`}>{MENU_CLASS_INFO[r.menuClass].label}</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-100">
                  {formatNumber(r.qtySold)}× <span className="text-xs text-ink-400">({r.mixPercent.toFixed(1)}%)</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-100">{formatRupiah(Math.round(r.marginPerUnit))}</td>
                <td className="px-4 py-2 text-right font-semibold tabular-nums text-ink-50">{formatRupiah(Math.round(r.marginTotal))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {analysis.missingCostCount > 0 && (
        <p className="mt-2 text-xs text-yellow-400">
          {formatNumber(analysis.missingCostCount)} menu belum punya HPP, jadi marginnya tampak lebih besar dari yang sebenarnya. Isi HPP di menu Produk supaya analisisnya akurat.
        </p>
      )}
    </div>
  )
}

function TargetBar({ label, value, target, expectedShare }: { label: string; value: number; target: number; expectedShare?: number }) {
  const pct = target > 0 ? (value / target) * 100 : 0
  const onTrack = expectedShare == null || pct >= expectedShare * 100
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-ink-300">{label}</span>
        <span className={`text-sm font-semibold tabular-nums ${pct >= 100 ? 'text-success-400' : onTrack ? 'text-ink-50' : 'text-yellow-400'}`}>{pct.toFixed(0)}%</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-800" role="progressbar" aria-label={label} aria-valuenow={Math.round(Math.min(100, pct))} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full ${pct >= 100 ? 'bg-success-500' : onTrack ? 'bg-brand-600' : 'bg-yellow-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <p className="mt-1 text-xs text-ink-300">
        {formatRupiah(value)} dari {formatRupiah(target)}
        {pct < 100 ? ` • kurang ${formatRupiah(Math.max(0, target - value))}` : ' • tercapai'}
      </p>
    </div>
  )
}

/** Pencapaian target omzet hari ini & bulan berjalan (selalu "sekarang", tak ikut rentang laporan). */
export function SalesTargetCard({ canManage, actor }: { canManage: boolean; actor: { userId: string; userName: string } }) {
  const settings = useLiveQuery(() => getSettings(), [])
  const targets = settings?.salesTargets
  const hasTarget = (targets?.daily ?? 0) > 0 || (targets?.monthly ?? 0) > 0
  const todayKey = jakartaDateKey(Date.now())
  const progress = useLiveQuery(async () => {
    if (!hasTarget) return null
    const now = Date.now()
    const [today, month] = await Promise.all([buildSalesReport({ from: startOfJakartaDay(0), to: now }), buildSalesReport({ from: startOfJakartaMonth(), to: now })])
    return { today: today.revenue, month: month.revenue }
  }, [hasTarget, todayKey])
  const [editing, setEditing] = useState(false)
  if (!settings || (!hasTarget && !canManage)) return null

  // Porsi bulan yang sudah berjalan → apakah omzet bulan ini "sesuai jalur".
  const [year, monthNo, day] = todayKey.split('-').map(Number)
  const monthShare = day / new Date(year, monthNo, 0).getDate()

  return (
    <div className="card mb-4 flex flex-wrap items-center gap-x-8 gap-y-3 p-4">
      {hasTarget ? (
        <>
          {(targets?.daily ?? 0) > 0 && <TargetBar label="Target hari ini" value={progress?.today ?? 0} target={targets?.daily ?? 0} />}
          {(targets?.monthly ?? 0) > 0 && <TargetBar label="Target bulan ini" value={progress?.month ?? 0} target={targets?.monthly ?? 0} expectedShare={monthShare} />}
        </>
      ) : (
        <p className="flex-1 text-sm text-ink-300">Belum ada target omzet. Pasang target harian atau bulanan untuk memantau pencapaian.</p>
      )}
      {canManage && (
        <button className="btn-secondary btn-compact !px-3 text-sm" onClick={() => setEditing(true)}>
          {hasTarget ? 'Ubah Target' : 'Pasang Target'}
        </button>
      )}
      {editing && <SalesTargetModal initial={targets} actor={actor} onClose={() => setEditing(false)} />}
    </div>
  )
}

function SalesTargetModal({ initial, actor, onClose }: { initial: { daily?: number; monthly?: number } | undefined; actor: { userId: string; userName: string }; onClose: () => void }) {
  const [daily, setDaily] = useState(initial?.daily ?? 0)
  const [monthly, setMonthly] = useState(initial?.monthly ?? 0)

  async function save() {
    await updateSettings({ salesTargets: { daily: daily > 0 ? daily : undefined, monthly: monthly > 0 ? monthly : undefined } })
    await recordAuditLog({ ...actor, action: 'settings.sales_target', entityType: 'settings', entityId: 'singleton', details: `Target omzet diubah: harian Rp${daily.toLocaleString('id-ID')}, bulanan Rp${monthly.toLocaleString('id-ID')}.` })
    toast.success('Target omzet disimpan.')
    onClose()
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-1 text-lg font-bold text-ink-50">Target Omzet</h2>
      <p className="mb-3 text-sm text-ink-400">Kosongkan (Rp0) untuk tidak memakai target itu.</p>
      <label className="mb-3 block">
        <span className="mb-1 block text-sm text-ink-300">Target per hari</span>
        <input className="input-field" inputMode="numeric" autoFocus aria-label="Target per hari" value={daily ? formatRupiah(daily) : ''} placeholder="Rp0" onChange={(e) => setDaily(parseRupiahInput(e.target.value))} />
      </label>
      <label className="mb-4 block">
        <span className="mb-1 block text-sm text-ink-300">Target per bulan</span>
        <input className="input-field" inputMode="numeric" aria-label="Target per bulan" value={monthly ? formatRupiah(monthly) : ''} placeholder="Rp0" onChange={(e) => setMonthly(parseRupiahInput(e.target.value))} />
      </label>
      <div className="flex gap-3">
        <button className="btn-ghost flex-1" onClick={onClose}>
          Batal
        </button>
        <button className="btn-primary flex-[2]" onClick={() => void save()}>
          Simpan Target
        </button>
      </div>
    </Modal>
  )
}

/** Kepuasan tamu dari penilaian bintang di layar pembayaran. */
export function FeedbackSection({ range }: { range: { from: number; to: number } }) {
  const report = useLiveQuery(() => buildFeedbackReport(range), [range.from, range.to])
  if (!report || report.count === 0) return null
  const max = Math.max(...report.distribution, 1)
  return (
    <div>
      <h3 className="mb-2 font-semibold text-ink-100">Penilaian Tamu</h3>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <div className="flex items-end gap-4">
            <p className="text-4xl font-bold tabular-nums text-ink-50">{report.average.toFixed(1)}</p>
            <div className="pb-1 text-sm text-ink-300">
              <p className="text-accent-500">{'★'.repeat(Math.round(report.average))}</p>
              <p>
                {formatNumber(report.count)} penilaian • {report.satisfiedPercent.toFixed(0)}% puas (★4–5)
              </p>
            </div>
          </div>
          <div className="mt-3 space-y-1">
            {[5, 4, 3, 2, 1].map((star) => (
              <div key={star} className="flex items-center gap-2 text-xs text-ink-300">
                <span className="w-6 flex-none">★{star}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-800">
                  <div className={`h-full rounded-full ${star >= 4 ? 'bg-success-500' : star === 3 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${(report.distribution[star - 1] / max) * 100}%` }} />
                </div>
                <span className="w-8 flex-none text-right tabular-nums">{formatNumber(report.distribution[star - 1])}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card max-h-64 overflow-auto p-4">
          <p className="mb-2 text-sm text-ink-300">Komentar & penilaian rendah</p>
          {report.notable.length === 0 && <p className="text-sm text-ink-500">Belum ada komentar.</p>}
          <div className="space-y-2">
            {report.notable.map((f) => (
              <div key={f.id} className="rounded-xl bg-ink-800 px-3 py-2 text-sm">
                <p className="text-ink-50">
                  <span className={f.rating >= 4 ? 'text-success-400' : f.rating === 3 ? 'text-yellow-400' : 'text-red-400'}>★{f.rating}</span>
                  {f.comment ? ` “${f.comment}”` : ' (tanpa komentar)'}
                </p>
                <p className="text-xs text-ink-300">
                  {f.orderNumber} • {formatDateTime(f.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
