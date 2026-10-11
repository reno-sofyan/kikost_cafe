import { useMemo, useState } from 'react'
import { NavLink, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  buildOperationsReport,
  buildSalesReport,
  buildStockReport,
  previousRange,
  REPORT_SCOPE_LABELS,
  type DateRange,
  type ReportScope,
  type SalesReport,
} from '@/db/repositories/reports'
import { getSettings } from '@/db/repositories/settings'
import { formatRupiah, formatNumber } from '@/lib/currency'
import { formatDate, jakartaDateKey, jakartaDateTimeToEpoch, startOfJakartaDay, startOfJakartaMonth } from '@/lib/datetime'
import { featuresForBusinessType } from '@/lib/businessType'
import { ONLINE_PLATFORM_LABELS } from '@/lib/onlineOrders'
import { exportAccountingJournalCsv, exportSalesReportCsv, exportSalesReportPdf } from '@/features/reports/exportReport'
import { ColumnChart, ShareTable, type ColumnDatum } from '@/features/reports/ReportCharts'
import { toast } from '@/state/toastStore'
import type { OrderType } from '@/types/domain'

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'custom'

const PRESET_LABELS: Record<Preset, string> = {
  today: 'Hari Ini',
  yesterday: 'Kemarin',
  week: '7 Hari',
  month: 'Bulan Ini',
  custom: 'Kustom',
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer',
  card: 'Kartu',
  platform: 'Aplikasi Online',
}

const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  dine_in: 'Dine-in',
  takeaway: 'Takeaway',
  delivery: 'Online',
}

/** Tiga halaman laporan, urut seperti tab: per kanal dulu, lalu gabungan. */
const SCOPE_PAGES: { scope: ReportScope; to: string; hint: string }[] = [
  { scope: 'offline', to: '/laporan/dine-in-takeaway', hint: 'Penjualan di tempat & bawa pulang' },
  { scope: 'online', to: '/laporan/online', hint: 'GoFood, GrabFood, ShopeeFood, dan pesanan online lain' },
  { scope: 'all', to: '/laporan', hint: 'Gabungan semua kanal, termasuk pengeluaran, stok, & operasional' },
]

function scopeFromParam(param: string | undefined): ReportScope {
  return SCOPE_PAGES.find((s) => s.scope !== 'all' && s.to.endsWith(`/${param}`))?.scope ?? 'all'
}

const DAY_MS = 86_400_000
const SHORT_DAY = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short' })
const LONG_DAY = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

/** Tengah hari WIB dari kunci YYYY-MM-DD — aman untuk diformat sebagai tanggal. */
function dayKeyToEpoch(dateKey: string): number {
  return jakartaDateTimeToEpoch(dateKey, '12:00')
}

/** Rentang pembanding: periode yang sama, satu langkah ke belakang. */
function comparisonFor(preset: Preset, range: DateRange): { range: DateRange; label: string } {
  if (preset === 'today') return { range: { from: range.from - DAY_MS, to: range.to - DAY_MS }, label: 'kemarin, jam yang sama' }
  if (preset === 'yesterday') return { range: { from: range.from - DAY_MS, to: range.to - DAY_MS }, label: 'hari sebelumnya' }
  if (preset === 'week') return { range: { from: range.from - 7 * DAY_MS, to: range.to - 7 * DAY_MS }, label: '7 hari sebelumnya' }
  if (preset === 'month') {
    const d = new Date(range.from + 7 * 3_600_000)
    const prevStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1) - 7 * 3_600_000
    return { range: { from: prevStart, to: Math.min(prevStart + (range.to - range.from), range.from - 1) }, label: 'bulan lalu, s.d. tanggal yang sama' }
  }
  return { range: previousRange(range), label: 'periode sebelumnya' }
}

function buildTrendData(report: SalesReport, singleDay: boolean): ColumnDatum[] {
  if (singleDay) {
    // Pangkas jam sepi di awal/akhir supaya batang tak menyempit sia-sia.
    const active = report.byHour.filter((h) => h.transactionCount > 0)
    if (active.length === 0) return []
    const first = Math.max(0, active[0].hour - 1)
    const last = Math.min(23, active[active.length - 1].hour + 1)
    return report.byHour.slice(first, last + 1).map((h) => ({
      key: String(h.hour),
      label: String(h.hour).padStart(2, '0'),
      fullLabel: `${String(h.hour).padStart(2, '0')}.00 – ${String(h.hour).padStart(2, '0')}.59`,
      value: h.revenue,
      secondary: `${h.transactionCount} transaksi`,
    }))
  }
  // Isi hari tanpa transaksi dengan 0 supaya jarak antar batang = jarak waktu.
  const byKey = new Map(report.byDay.map((d) => [d.dateKey, d]))
  const out: ColumnDatum[] = []
  for (let t = report.range.from; t <= report.range.to && out.length < 92; t += DAY_MS) {
    const key = jakartaDateKey(t)
    if (out.some((o) => o.key === key)) continue
    const row = byKey.get(key)
    out.push({
      key,
      label: SHORT_DAY.format(new Date(dayKeyToEpoch(key))),
      fullLabel: LONG_DAY.format(new Date(dayKeyToEpoch(key))),
      value: row?.revenue ?? 0,
      secondary: `${row?.transactionCount ?? 0} transaksi`,
    })
  }
  return out
}

export function ReportsScreen() {
  const scope = scopeFromParam(useParams().scope)
  const [preset, setPreset] = useState<Preset>('today')
  const [customFrom, setCustomFrom] = useState(() => jakartaDateKey(startOfJakartaDay(6)))
  const [customTo, setCustomTo] = useState(() => jakartaDateKey(Date.now()))

  const range = useMemo<DateRange>(() => {
    const now = Date.now()
    if (preset === 'today') return { from: startOfJakartaDay(), to: now }
    if (preset === 'yesterday') return { from: startOfJakartaDay(1), to: startOfJakartaDay() - 1 }
    if (preset === 'week') return { from: startOfJakartaDay(6), to: now }
    if (preset === 'month') return { from: startOfJakartaMonth(), to: now }
    // Tanggal kustom dibaca sebagai hari WIB penuh, apa pun zona waktu perangkat.
    const from = jakartaDateTimeToEpoch(customFrom, '00:00')
    const to = jakartaDateTimeToEpoch(customTo, '23:59') + 59_999
    return Number.isFinite(from) && Number.isFinite(to) && to >= from ? { from, to } : { from: startOfJakartaDay(), to: now }
  }, [preset, customFrom, customTo])
  const comparison = useMemo(() => comparisonFor(preset, range), [preset, range])

  const loaded = useLiveQuery(async () => ({ scope, report: await buildSalesReport(range, scope) }), [range.from, range.to, scope])
  const loadedPrevious = useLiveQuery(
    async () => ({ scope, report: await buildSalesReport(comparison.range, scope) }),
    [comparison.range.from, comparison.range.to, scope],
  )
  // Saat pindah halaman, hasil lama masih milik cakupan sebelumnya — jangan ditampilkan.
  const report = loaded?.scope === scope ? loaded.report : undefined
  const previous = loadedPrevious?.scope === scope ? loadedPrevious.report : undefined
  const stockReport = useLiveQuery(() => buildStockReport(), [])
  const ops = useLiveQuery(() => buildOperationsReport(range), [range.from, range.to])
  const settings = useLiveQuery(() => getSettings(), [])
  const features = featuresForBusinessType(settings?.businessType ?? 'lainnya')
  // Usaha tanpa pesanan online (kantin, minimarket) cukup satu halaman gabungan.
  const showScopeTabs = features.onlineOrders || scope !== 'all' || (report?.channelSplit.online.transactionCount ?? 0) > 0
  const isAll = scope === 'all'
  const isOnline = scope === 'online'

  const singleDay = jakartaDateKey(range.from) === jakartaDateKey(range.to)
  const trend = useMemo(() => (report ? buildTrendData(report, singleDay) : []), [report, singleDay])
  const hourly = useMemo<ColumnDatum[]>(
    () =>
      report && !singleDay
        ? buildTrendData(report, true)
        : [],
    [report, singleDay],
  )
  const peakHour = report ? [...report.byHour].sort((a, b) => b.revenue - a.revenue)[0] : undefined
  const rangeLabel = singleDay ? formatDate(range.from) : `${formatDate(range.from)} – ${formatDate(range.to)}`

  return (
    <div className="h-full overflow-y-auto p-6">
      {showScopeTabs && (
        <nav aria-label="Halaman laporan" className="mb-4 flex flex-wrap gap-1 border-b border-ink-800">
          {SCOPE_PAGES.map((s) => (
            <NavLink
              key={s.scope}
              to={s.to}
              end
              title={s.hint}
              className={({ isActive }) =>
                `-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                  isActive ? 'border-brand-500 text-ink-50' : 'border-transparent text-ink-300 hover:text-ink-100'
                }`
              }
            >
              {REPORT_SCOPE_LABELS[s.scope]}
            </NavLink>
          ))}
        </nav>
      )}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h1 className="mr-4 text-xl font-bold text-ink-50">{showScopeTabs ? `Laporan ${REPORT_SCOPE_LABELS[scope]}` : 'Laporan'}</h1>
        {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => (
          <button key={p} onClick={() => setPreset(p)} className={`btn btn-compact !px-4 text-sm ${preset === p ? 'btn-primary' : 'btn-secondary'}`}>
            {PRESET_LABELS[p]}
          </button>
        ))}
        {preset === 'custom' && (
          <>
            <input type="date" aria-label="Dari tanggal" className="input-field max-w-[10rem]" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} />
            <span className="text-ink-400">–</span>
            <input type="date" aria-label="Sampai tanggal" className="input-field max-w-[10rem]" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} />
          </>
        )}
        {report && (
          <div className="ml-auto flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => void exportSalesReportCsv(report)}>
              Ekspor CSV
            </button>
            <button className="btn-secondary" onClick={() => void exportSalesReportPdf(report, { businessName: settings?.businessName ?? '', showService: features.tables })}>
              Ekspor PDF
            </button>
            {isAll && (
              <button
                className="btn-secondary"
                onClick={async () => {
                  const { balanced } = await exportAccountingJournalCsv(range)
                  if (!balanced) toast.error('Peringatan: jurnal tidak seimbang. Periksa data transaksi.')
                }}
              >
                Jurnal Akuntansi
              </button>
            )}
          </div>
        )}
      </div>
      <p className="mb-5 text-sm text-ink-300">
        {rangeLabel} · dibandingkan dengan {comparison.label}
      </p>

      {!report ? (
        <p className="text-ink-500">Memuat laporan...</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              label="Omzet"
              value={formatRupiah(report.revenue)}
              current={report.revenue}
              previous={previous?.revenue}
              hint={isOnline ? 'Total harga pesanan di aplikasi, sebelum komisi' : 'Total diterima, termasuk pajak & service charge'}
            />
            <KpiCard label="Transaksi" value={formatNumber(report.transactionCount)} current={report.transactionCount} previous={previous?.transactionCount} hint={`${formatNumber(report.itemsSold)} item terjual`} />
            <KpiCard label="Rata-rata per Transaksi" value={formatRupiah(Math.round(report.averageTransaction))} current={report.averageTransaction} previous={previous?.averageTransaction} />
            {isOnline ? (
              <KpiCard
                label="Diterima Bersih"
                value={formatRupiah(report.onlineNetReceived)}
                current={report.onlineNetReceived}
                previous={previous?.onlineNetReceived}
                hint={`Estimasi setelah komisi ${formatRupiah(report.onlineCommissionTotal)}`}
              />
            ) : (
              <KpiCard
                label="Laba Kotor"
                value={formatRupiah(report.grossMargin)}
                current={report.grossMargin}
                previous={previous?.grossMargin}
                hint={`Margin ${report.grossMarginPercent.toFixed(1)}% dari penjualan bersih`}
              />
            )}
          </div>

          {isOnline && report.transactionCount > 0 && report.onlineCommissionTotal === 0 && (
            <p className="rounded-xl border border-ink-700 px-4 py-3 text-sm text-ink-300">
              Komisi platform belum diisi, jadi "Diterima Bersih" masih sama dengan omzet. Isi persen komisi tiap platform di Pengaturan → Pajak & Struk; berlaku untuk pesanan berikutnya.
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <ColumnChart
                title={singleDay ? 'Omzet per Jam' : 'Tren Omzet Harian'}
                subtitle={
                  singleDay
                    ? peakHour && peakHour.revenue > 0
                      ? `Jam tersibuk ${String(peakHour.hour).padStart(2, '0')}.00 · ${peakHour.transactionCount} transaksi`
                      : undefined
                    : `${report.byDay.length} hari dengan penjualan · rata-rata ${formatRupiah(Math.round(report.revenue / Math.max(1, report.byDay.length)))}/hari`
                }
                data={trend}
                secondaryHeader="Transaksi"
              />
            </div>
            <div className="lg:col-span-2">
              <ProfitStatement report={report} showTips={features.tips || report.tipTotal > 0} />
            </div>
          </div>

          {(isAll || isOnline) && report.channelSplit.online.transactionCount > 0 && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {isAll && (
                <ShareTable
                  title="Kanal Penjualan"
                  labelHeader="Kanal"
                  detailHeader="Transaksi"
                  rows={[
                    { key: 'offline', label: REPORT_SCOPE_LABELS.offline, detail: formatNumber(report.channelSplit.offline.transactionCount), value: report.channelSplit.offline.revenue },
                    { key: 'online', label: REPORT_SCOPE_LABELS.online, detail: formatNumber(report.channelSplit.online.transactionCount), value: report.channelSplit.online.revenue },
                  ]}
                />
              )}
              <div className={isAll ? '' : 'lg:col-span-2'}>
                <ReportTable
                  title="Rekap per Platform"
                  headers={['Platform', 'Pesanan', 'Omzet', 'Komisi (est.)', 'Diterima Bersih']}
                  rows={report.byPlatform.map((pl) => [
                    ONLINE_PLATFORM_LABELS[pl.platform],
                    formatNumber(pl.transactionCount),
                    formatRupiah(pl.revenue),
                    pl.commission > 0 ? `−${formatRupiah(pl.commission)}` : formatRupiah(0),
                    formatRupiah(pl.net),
                  ])}
                />
              </div>
            </div>
          )}

          {(report.guestCount > 0 || report.returnTotal > 0 || report.voidCount > 0 || report.tipTotal > 0) && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {report.guestCount > 0 && <MiniStat label="Tamu Dine-in" value={formatNumber(report.guestCount)} />}
              {report.guestCount > 0 && <MiniStat label="Rata-rata per Tamu" value={formatRupiah(Math.round(report.averagePerGuest))} />}
              {report.tipTotal > 0 && <MiniStat label="Tip Diterima" value={formatRupiah(report.tipTotal)} note="bukan omzet" />}
              {report.returnTotal > 0 && <MiniStat label="Retur" value={formatRupiah(report.returnTotal)} tone="bad" />}
              {report.voidCount > 0 && <MiniStat label="Pesanan Dibatalkan" value={formatNumber(report.voidCount)} tone="bad" />}
            </div>
          )}

          {!singleDay && hourly.length > 0 && (
            <ColumnChart
              title="Pola Jam Sibuk"
              subtitle={peakHour && peakHour.revenue > 0 ? `Akumulasi seluruh rentang · puncak jam ${String(peakHour.hour).padStart(2, '0')}.00` : undefined}
              data={hourly}
              secondaryHeader="Transaksi"
            />
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ShareTable
              title="Produk Terlaris"
              labelHeader="Produk"
              detailHeader="Qty"
              limit={10}
              rows={report.allProductSales.map((p) => ({ key: p.productId, label: p.productName, detail: `${formatNumber(p.qtySold)}×`, value: p.revenue }))}
            />
            <div className="space-y-4">
              <ShareTable
                title="Penjualan per Kategori"
                labelHeader="Kategori"
                rows={report.byCategory.map((c) => ({ key: c.categoryName, label: c.categoryName, value: c.revenue }))}
              />
              <ShareTable
                title="Metode Pembayaran"
                labelHeader="Metode"
                detailHeader="Transaksi"
                valueHeader="Jumlah"
                rows={report.byPaymentMethod.map((m) => ({ key: m.method, label: PAYMENT_METHOD_LABELS[m.method] ?? m.method, detail: formatNumber(m.count), value: m.amount }))}
              />
            </div>
            {report.byOrderType.length > 1 && (
              <ShareTable
                title="Jenis Pesanan"
                labelHeader="Jenis"
                detailHeader="Transaksi"
                rows={report.byOrderType.map((t) => ({ key: t.type, label: ORDER_TYPE_LABELS[t.type], detail: formatNumber(t.transactionCount), value: t.revenue }))}
              />
            )}
            <ShareTable
              title="Penjualan per Kasir"
              labelHeader="Kasir"
              detailHeader="Transaksi"
              rows={report.byCashier.map((c) => ({ key: c.cashierName, label: c.cashierName, detail: formatNumber(c.transactionCount), value: c.revenue }))}
            />
            {report.byWaiter.length > 0 && (
              <ShareTable
                title="Penjualan per Pelayan"
                labelHeader="Pelayan"
                detailHeader="Trx · Tamu · Tip"
                rows={report.byWaiter.map((w) => ({
                  key: w.waiterName,
                  label: w.waiterName,
                  detail: `${formatNumber(w.transactionCount)} · ${formatNumber(w.guestCount)} · ${w.tips > 0 ? formatRupiah(w.tips) : '-'}`,
                  value: w.revenue,
                }))}
              />
            )}
          </div>

          {isAll && (
          <div>
            <h3 className="mb-2 font-semibold text-ink-100">Laporan Stok</h3>
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-ink-800 text-left text-ink-300">
                  <tr>
                    <th className="px-4 py-2">Item</th>
                    <th className="px-4 py-2">Stok</th>
                    <th className="px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(stockReport ?? []).map((row) => (
                    <tr key={row.name} className="border-t border-ink-800">
                      <td className="px-4 py-2 text-ink-100">{row.name}</td>
                      <td className="px-4 py-2 text-ink-200">
                        {row.stockQty} {row.unit}
                      </td>
                      <td className={`px-4 py-2 ${row.isLow ? 'text-red-400' : 'text-success-500'}`}>{row.isLow ? 'Menipis' : 'Aman'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          )}

          {isAll && ops && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label="Nilai Waste" value={formatRupiah(ops.wasteTotalCost)} accent="text-red-400" />
                <StatCard label="Rata-rata Waktu Dapur" value={`${ops.avgKitchenMinutes} mnt`} />
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <ReportTable
                  title="Waste per Item"
                  rows={ops.wasteByItem.map((r) => [r.itemName, `${formatNumber(r.qty)} ${r.unit}`, formatRupiah(r.estCost)])}
                  headers={['Item', 'Jumlah', 'Est. Biaya']}
                />
                <ReportTable
                  title="Hasil Produksi"
                  rows={ops.productionOutput.map((r) => [r.itemName, `${formatNumber(r.qty)} ${r.unit}`, formatRupiah(r.estCost)])}
                  headers={['Item', 'Jumlah', 'Est. Biaya']}
                />
                <ReportTable
                  title="Pemakaian Bahan"
                  rows={ops.ingredientUsage.map((u) => [
                    `${u.itemName} (${u.unit})`,
                    formatNumber(u.sale),
                    formatNumber(u.production),
                    formatNumber(u.waste),
                  ])}
                  headers={['Bahan', 'Penjualan', 'Produksi', 'Waste']}
                />
                <ReportTable
                  title="Durasi Penyiapan Dapur"
                  rows={ops.kitchenDuration.map((k) => [k.productName, `${k.count}x`, `${k.avgPrepMinutes} mnt`])}
                  headers={['Produk', 'Porsi', 'Rata-rata']}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Kartu KPI dengan selisih terhadap periode pembanding. Naik = baik untuk semua KPI di sini. */
function KpiCard({ label, value, current, previous, hint }: { label: string; value: string; current: number; previous?: number; hint?: string }) {
  let delta: { text: string; className: string } | null = null
  if (previous !== undefined) {
    if (previous === 0 && current === 0) delta = null
    else if (previous === 0) delta = { text: '▲ baru', className: 'bg-success-600/15 text-success-400' }
    else {
      const pct = ((current - previous) / Math.abs(previous)) * 100
      const flat = Math.abs(pct) < 0.5
      delta = {
        text: flat ? '● stabil' : `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(Math.abs(pct) >= 100 ? 0 : 1)}%`,
        className: flat ? 'bg-ink-700 text-ink-200' : pct > 0 ? 'bg-success-600/15 text-success-400' : 'bg-red-900/30 text-red-400',
      }
    }
  }
  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-ink-300">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-ink-50">{value}</p>
      <div className="mt-1.5 flex min-h-[1.25rem] flex-wrap items-center gap-2">
        {delta && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${delta.className}`}>{delta.text}</span>}
        {hint && <span className="text-xs text-ink-300">{hint}</span>}
      </div>
    </div>
  )
}

function MiniStat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'bad' }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-xs text-ink-300">{label}</p>
      <p className={`mt-0.5 text-lg font-bold tabular-nums ${tone === 'bad' ? 'text-red-400' : 'text-ink-50'}`}>{value}</p>
      {note && <p className="text-xs text-ink-300">{note}</p>}
    </div>
  )
}

/** Ringkasan laba-rugi sederhana: dari penjualan kotor sampai laba operasional. */
function ProfitStatement({ report, showTips }: { report: SalesReport; showTips: boolean }) {
  const Line = ({ label, value, minus, strong, note }: { label: string; value: number; minus?: boolean; strong?: boolean; note?: string }) => (
    <div className={`flex items-baseline justify-between gap-3 py-1 ${strong ? 'border-t border-ink-600 font-semibold text-ink-50' : 'text-ink-200'}`}>
      <span>
        {label}
        {note && <span className="ml-1.5 text-xs font-normal text-ink-300">{note}</span>}
      </span>
      <span className="whitespace-nowrap tabular-nums">
        {minus && value !== 0 ? '−' : ''}
        {formatRupiah(Math.abs(value))}
      </span>
    </div>
  )
  return (
    <div className="card h-full p-4 text-sm">
      <h3 className="mb-2 font-semibold text-ink-100">Ringkasan Laba-Rugi</h3>
      <Line label="Penjualan kotor" value={report.grossSales} />
      <Line label="Diskon" value={report.discountTotal} minus />
      <Line label="Retur" value={report.returnTotal} minus />
      <Line label="Penjualan bersih" value={report.netSales} strong />
      <Line label="HPP" value={report.costOfGoodsSold} minus note="harga pokok" />
      <Line label="Laba kotor" value={report.grossMargin} strong note={`${report.grossMarginPercent.toFixed(1)}%`} />
      {(report.onlineCommissionTotal > 0 || report.scope === 'online') && <Line label="Komisi platform" value={report.onlineCommissionTotal} minus note="estimasi" />}
      {report.scope === 'all' && <Line label="Pengeluaran" value={report.expenseTotal} minus />}
      {report.scope !== 'offline' && (
        <div className={`flex items-baseline justify-between gap-3 border-t border-ink-600 py-1.5 text-base font-bold ${report.operatingProfit < 0 ? 'text-red-400' : 'text-ink-50'}`}>
          <span>{report.scope === 'all' ? 'Laba operasional' : 'Laba setelah komisi'}</span>
          <span className="whitespace-nowrap tabular-nums">
            {report.operatingProfit < 0 ? '−' : ''}
            {formatRupiah(Math.abs(report.operatingProfit))}
          </span>
        </div>
      )}
      <p className="eyebrow mb-1 mt-3">Dipungut di luar penjualan</p>
      <Line label="Pajak" value={report.taxTotal} />
      <Line label="Service charge" value={report.serviceChargeTotal} />
      {report.roundingTotal !== 0 && <Line label="Pembulatan" value={report.roundingTotal} minus={report.roundingTotal < 0} />}
      {showTips && <Line label="Tip" value={report.tipTotal} note="untuk staf" />}
      <p className="mt-2 text-xs text-ink-300">
        HPP dihitung dari harga pokok produk saat ini; laba bersifat estimasi.
        {report.scope !== 'all' && ' Pengeluaran operasional hanya dihitung di laporan Keseluruhan.'}
      </p>
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-ink-400">{label}</p>
      <p className={`mt-1 text-lg font-bold ${accent ?? 'text-ink-50'}`}>{value}</p>
    </div>
  )
}

function ReportTable({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) {
  return (
    <div>
      <h3 className="mb-2 font-semibold text-ink-100">{title}</h3>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-800 text-left text-ink-300">
            <tr>
              {headers.map((h) => (
                <th key={h} className="px-4 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="px-4 py-3 text-ink-500" colSpan={headers.length}>
                  Tidak ada data
                </td>
              </tr>
            )}
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-ink-800">
                {row.map((cell, j) => (
                  <td key={j} className="px-4 py-2 text-ink-100">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
