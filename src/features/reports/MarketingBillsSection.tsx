import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { buildMarketingBillReport, MARKETING_BILL_STATUS_LABELS, type MarketingBillStatus } from '@/db/repositories/marketingBills'
import { listMarketingSales } from '@/db/repositories/customers'
import type { DateRange } from '@/db/repositories/reports'
import { SalesAvatar } from '@/features/customers/SalesAvatar'
import { exportMarketingBillsCsv } from '@/features/reports/exportReport'
import { formatNumber, formatRupiah } from '@/lib/currency'
import { formatDateTime } from '@/lib/datetime'

const STATUS_TONE: Record<MarketingBillStatus, string> = {
  unpaid: 'bg-red-500/15 text-red-400',
  settled: 'bg-success-600/20 text-success-500',
  direct: 'bg-ink-700 text-ink-200',
}

/** Laporan → Tagihan Marketing: jamuan klien oleh sales, terpisah dari penjualan biasa. */
export function MarketingBillsSection({ range }: { range: DateRange }) {
  const [salesId, setSalesId] = useState('')
  const report = useLiveQuery(() => buildMarketingBillReport(range, salesId || null), [range.from, range.to, salesId])
  const salesList = useLiveQuery(() => listMarketingSales(), []) ?? []
  const photoOf = new Map(salesList.map((s) => [s.id, s.marketingSales?.photoDataUrl ?? null]))
  if (!report || (report.rows.length === 0 && !salesId)) return null

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-bold text-ink-50">Tagihan Marketing</h2>
        <select className="input-field max-w-[14rem]" aria-label="Saring sales" value={salesId} onChange={(e) => setSalesId(e.target.value)}>
          <option value="">Semua sales</option>
          {salesList.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button className="btn-secondary" onClick={() => void exportMarketingBillsCsv(report, range)}>
          Ekspor CSV
        </button>
      </div>
      <p className="-mt-2 text-xs text-ink-400">
        Jamuan klien oleh tim marketing yang ditagihkan ke kantor. Sudah termasuk omzet (tanggal pesanan); yang belum dibayar kantor tercatat sebagai piutang.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Total Tagihan" value={formatRupiah(report.total)} note={`${formatNumber(report.rows.length)} kunjungan`} />
        <Stat
          label="Belum Dibayar Kantor"
          value={formatRupiah(report.outstanding)}
          note={`${formatNumber(report.outstandingCount)} tagihan`}
          bad={report.outstanding > 0}
        />
        <Stat label="Sudah Dibayar" value={formatRupiah(report.total - report.outstanding)} />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-ink-800 text-left text-ink-300">
            <tr>
              <th className="px-4 py-2">Sales</th>
              <th className="px-4 py-2 text-right">Kunjungan</th>
              <th className="px-4 py-2 text-right">Total</th>
              <th className="px-4 py-2 text-right">Belum Dibayar</th>
            </tr>
          </thead>
          <tbody>
            {report.bySales.map((s) => (
              <tr key={s.salesId} className="border-t border-ink-800">
                <td className="px-4 py-2">
                  <span className="flex items-center gap-2.5">
                    <SalesAvatar name={s.salesName} photo={photoOf.get(s.salesId) ?? null} size={30} />
                    <span>
                      <span className="block font-medium text-ink-50">{s.salesName}</span>
                      {s.salesDivision && <span className="block text-xs text-ink-400">{s.salesDivision}</span>}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-100">{formatNumber(s.count)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-100">{formatRupiah(s.total)}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${s.outstanding > 0 ? 'text-red-400' : 'text-ink-300'}`}>{formatRupiah(s.outstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-ink-800 text-left text-ink-300">
            <tr>
              <th className="px-4 py-2">Tanggal & Jam</th>
              <th className="px-4 py-2">Sales / Klien</th>
              <th className="px-4 py-2">Item</th>
              <th className="px-4 py-2 text-right">Total</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 && (
              <tr>
                <td className="px-4 py-3 text-ink-500" colSpan={5}>
                  Tidak ada tagihan marketing
                </td>
              </tr>
            )}
            {report.rows.map((r) => (
              <tr key={r.orderId} className="border-t border-ink-800 align-top">
                <td className="whitespace-nowrap px-4 py-2 text-ink-100">
                  {formatDateTime(r.orderedAt)}
                  <span className="block text-xs text-ink-400">
                    {r.orderNumber} • kasir {r.cashierName}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span className="block font-medium text-ink-50">{r.salesName}</span>
                  <span className="block text-xs text-ink-400">
                    {[r.clientName && `Klien: ${r.clientName}`, r.purpose].filter(Boolean).join(' • ') || '—'}
                  </span>
                </td>
                <td className="max-w-[16rem] px-4 py-2 text-xs text-ink-300">{r.itemsLabel}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-ink-100">
                  {formatRupiah(r.total)}
                  {r.discountAmount > 0 && <span className="block text-xs text-ink-400">diskon {formatRupiah(r.discountAmount)}</span>}
                </td>
                <td className="px-4 py-2">
                  <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[r.status]}`}>
                    {MARKETING_BILL_STATUS_LABELS[r.status]}
                  </span>
                  {r.status !== 'unpaid' && r.paidAt && <span className="block text-xs text-ink-400">{formatDateTime(r.paidAt)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Stat({ label, value, note, bad }: { label: string; value: string; note?: string; bad?: boolean }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-xs text-ink-300">{label}</p>
      <p className={`mt-0.5 text-lg font-bold tabular-nums ${bad ? 'text-red-400' : 'text-ink-50'}`}>{value}</p>
      {note && <p className="text-xs text-ink-300">{note}</p>}
    </div>
  )
}
