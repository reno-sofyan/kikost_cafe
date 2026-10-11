import { useState } from 'react'
import { formatRupiah } from '@/lib/currency'

/** Rupiah ringkas untuk sumbu & label sempit: 1,2 jt · 850 rb · 2,4 M. */
function compactRupiah(value: number): string {
  const abs = Math.abs(value)
  const fmt = (n: number, unit: string) => `${n.toLocaleString('id-ID', { maximumFractionDigits: n >= 100 ? 0 : 1 })} ${unit}`
  if (abs >= 1_000_000_000) return fmt(value / 1_000_000_000, 'M')
  if (abs >= 1_000_000) return fmt(value / 1_000_000, 'jt')
  if (abs >= 1_000) return fmt(value / 1_000, 'rb')
  return String(Math.round(value))
}

/** Batas atas sumbu yang "bulat" (1/2/2,5/5 × 10^n) supaya tick mudah dibaca. */
function niceCeil(value: number): number {
  if (value <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(value)))
  const n = value / pow
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return step * pow
}

export interface ColumnDatum {
  key: string
  /** Label sumbu-x (pendek). */
  label: string
  /** Label lengkap untuk tooltip & tabel. */
  fullLabel: string
  value: number
  /** Angka kedua di tooltip/tabel, mis. jumlah transaksi. */
  secondary?: string
}

const PLOT_HEIGHT = 168

/**
 * Diagram kolom satu seri (omzet per hari / per jam). Satu seri → tanpa legenda;
 * judul kartu yang menamainya. Nilai puncak diberi label langsung, sisanya lewat
 * sumbu + tooltip; "Lihat tabel" menyediakan angka persisnya.
 */
export function ColumnChart({ title, subtitle, data, secondaryHeader }: { title: string; subtitle?: string; data: ColumnDatum[]; secondaryHeader?: string }) {
  const [active, setActive] = useState<string | null>(null)
  const [showTable, setShowTable] = useState(false)
  const max = Math.max(0, ...data.map((d) => d.value))
  const top = niceCeil(max)
  const ticks = [top, top / 2, 0]
  const peakKey = max > 0 ? data.find((d) => d.value === max)?.key : undefined
  // Label sumbu-x: tampilkan tiap ke-n supaya tak bertabrakan.
  const labelEvery = Math.max(1, Math.ceil(data.length / 12))
  const activeDatum = data.find((d) => d.key === active)

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-ink-100">{title}</h3>
          {subtitle && <p className="text-xs text-ink-300">{subtitle}</p>}
        </div>
        <button className="text-xs font-medium text-brand-400 underline-offset-2 hover:underline" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Lihat grafik' : 'Lihat tabel'}
        </button>
      </div>

      {max <= 0 ? (
        <p className="py-10 text-center text-sm text-ink-400">Belum ada penjualan pada rentang ini.</p>
      ) : showTable ? (
        <div className="max-h-56 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-300">
              <tr>
                <th className="py-1 font-medium">Waktu</th>
                {secondaryHeader && <th className="py-1 text-right font-medium">{secondaryHeader}</th>}
                <th className="py-1 text-right font-medium">Omzet</th>
              </tr>
            </thead>
            <tbody>
              {data
                .filter((d) => d.value > 0)
                .map((d) => (
                  <tr key={d.key} className="border-t border-ink-700">
                    <td className="py-1 text-ink-100">{d.fullLabel}</td>
                    {secondaryHeader && <td className="py-1 text-right tabular-nums text-ink-200">{d.secondary ?? '-'}</td>}
                    <td className="py-1 text-right tabular-nums text-ink-100">{formatRupiah(d.value)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex gap-2">
          <div className="flex flex-none flex-col justify-between text-right text-[0.65rem] tabular-nums text-ink-300" style={{ height: PLOT_HEIGHT }}>
            {ticks.map((t) => (
              <span key={t} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
                {compactRupiah(t)}
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative" style={{ height: PLOT_HEIGHT }}>
              {ticks.map((t, i) => (
                <div key={t} className="absolute inset-x-0 border-t border-ink-600" style={{ top: `${(i / (ticks.length - 1)) * 100}%` }} />
              ))}
              <div className="absolute inset-0 flex items-end">
                {data.map((d) => {
                  const h = (d.value / top) * 100
                  const isActive = active === d.key
                  return (
                    <button
                      key={d.key}
                      type="button"
                      aria-label={`${d.fullLabel}: ${formatRupiah(d.value)}${d.secondary ? `, ${d.secondary}` : ''}`}
                      className="group relative flex h-full min-w-0 flex-1 items-end justify-center focus:outline-none"
                      onMouseEnter={() => setActive(d.key)}
                      onMouseLeave={() => setActive((a) => (a === d.key ? null : a))}
                      onFocus={() => setActive(d.key)}
                      onBlur={() => setActive((a) => (a === d.key ? null : a))}
                      onClick={() => setActive(d.key)}
                    >
                      {d.key === peakKey && !activeDatum && (
                        <span
                          className="pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap text-[0.65rem] font-semibold tabular-nums text-ink-100"
                          style={{ bottom: `calc(${h}% + 3px)` }}
                        >
                          {compactRupiah(d.value)}
                        </span>
                      )}
                      <span
                        className={`w-[70%] max-w-[24px] rounded-t transition-colors ${isActive ? 'bg-brand-700' : 'bg-brand-500 group-hover:bg-brand-700'}`}
                        style={{ height: `${h}%`, minHeight: d.value > 0 ? 2 : 0 }}
                      />
                    </button>
                  )
                })}
              </div>
              {activeDatum && (
                <div className="pointer-events-none absolute left-1/2 top-0 z-20 -translate-x-1/2 rounded-lg border border-ink-600 bg-ink-900 px-3 py-1.5 text-center shadow-card">
                  <p className="whitespace-nowrap text-xs text-ink-300">{activeDatum.fullLabel}</p>
                  <p className="whitespace-nowrap text-sm font-semibold tabular-nums text-ink-50">{formatRupiah(activeDatum.value)}</p>
                  {activeDatum.secondary && <p className="whitespace-nowrap text-xs text-ink-300">{activeDatum.secondary}</p>}
                </div>
              )}
            </div>
            <div className="mt-1 flex">
              {data.map((d, i) => (
                <span key={d.key} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center text-[0.65rem] tabular-nums text-ink-300">
                  {i % labelEvery === 0 ? d.label : ''}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export interface ShareRow {
  key: string
  label: string
  /** Kolom tengah opsional (mis. "12 trx", "34x"). */
  detail?: string
  value: number
}

/**
 * Tabel peringkat dengan batang proporsi: tiap baris menunjukkan nilainya dan
 * porsinya terhadap total — lebih cepat dibaca daripada deretan angka saja.
 */
export function ShareTable({
  title,
  rows,
  labelHeader,
  detailHeader,
  valueHeader = 'Omzet',
  emptyText = 'Tidak ada data',
  limit,
}: {
  title: string
  rows: ShareRow[]
  labelHeader: string
  detailHeader?: string
  valueHeader?: string
  emptyText?: string
  /** Tampilkan N teratas; sisanya dibuka lewat "Lihat semua". */
  limit?: number
}) {
  const [expanded, setExpanded] = useState(false)
  const total = rows.reduce((s, r) => s + Math.max(0, r.value), 0)
  const max = Math.max(0, ...rows.map((r) => r.value))
  const shown = limit && !expanded ? rows.slice(0, limit) : rows

  return (
    <div className="card overflow-hidden">
      <h3 className="px-4 pt-4 font-semibold text-ink-100">{title}</h3>
      <table className="mt-2 w-full text-sm">
        <thead className="text-left text-xs text-ink-300">
          <tr>
            <th className="px-4 py-1.5 font-medium">{labelHeader}</th>
            {detailHeader && <th className="px-2 py-1.5 text-right font-medium">{detailHeader}</th>}
            <th className="px-2 py-1.5 text-right font-medium">{valueHeader}</th>
            <th className="w-14 py-1.5 pl-2 pr-4 text-right font-medium">Porsi</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td className="px-4 py-3 text-ink-400" colSpan={detailHeader ? 4 : 3}>
                {emptyText}
              </td>
            </tr>
          )}
          {shown.map((r) => (
            <tr key={r.key} className="border-t border-ink-700">
              <td className="px-4 py-2">
                <span className="line-clamp-1 text-ink-100">{r.label}</span>
                <span className="mt-1 block h-1.5 rounded-full bg-ink-700">
                  <span className="block h-1.5 rounded-full bg-brand-500" style={{ width: `${max > 0 ? Math.max(0, (r.value / max) * 100) : 0}%` }} />
                </span>
              </td>
              {detailHeader && <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-ink-200">{r.detail ?? '-'}</td>}
              <td className="whitespace-nowrap px-2 py-2 text-right font-medium tabular-nums text-ink-100">{formatRupiah(r.value)}</td>
              <td className="whitespace-nowrap py-2 pl-2 pr-4 text-right tabular-nums text-ink-300">
                {total > 0 ? `${((Math.max(0, r.value) / total) * 100).toFixed(0)}%` : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {limit && rows.length > limit && (
        <button className="w-full border-t border-ink-700 py-2 text-xs font-medium text-brand-400 hover:bg-ink-800" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Tampilkan lebih sedikit' : `Lihat semua (${rows.length})`}
        </button>
      )}
    </div>
  )
}
