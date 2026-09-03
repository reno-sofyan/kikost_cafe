import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { buildOperationsReport, buildSalesReport, buildStockReport } from '@/db/repositories/reports'
import { formatRupiah, formatNumber } from '@/lib/currency'
import { startOfJakartaDay, startOfJakartaMonth } from '@/lib/datetime'
import { exportSalesReportCsv, exportSalesReportPdf } from '@/features/reports/exportReport'

type Preset = 'today' | 'week' | 'month' | 'custom'

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer',
  card: 'Kartu',
}

export function ReportsScreen() {
  const [preset, setPreset] = useState<Preset>('today')
  const [customFrom, setCustomFrom] = useState(() => new Date(startOfJakartaDay()).toISOString().slice(0, 10))
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10))

  const range = useMemo(() => {
    const now = Date.now()
    if (preset === 'today') return { from: startOfJakartaDay(), to: now }
    if (preset === 'week') return { from: startOfJakartaDay(6), to: now }
    if (preset === 'month') return { from: startOfJakartaMonth(), to: now }
    return { from: new Date(customFrom).getTime(), to: new Date(customTo).getTime() + 86_400_000 - 1 }
  }, [preset, customFrom, customTo])

  const report = useLiveQuery(() => buildSalesReport(range), [range.from, range.to])
  const stockReport = useLiveQuery(() => buildStockReport(), [])
  const ops = useLiveQuery(() => buildOperationsReport(range), [range.from, range.to])

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <h1 className="mr-4 text-xl font-bold text-ink-50">Laporan</h1>
        {(['today', 'week', 'month', 'custom'] as Preset[]).map((p) => (
          <button key={p} onClick={() => setPreset(p)} className={`btn !min-h-0 !px-4 !py-2 text-sm ${preset === p ? 'btn-primary' : 'btn-secondary'}`}>
            {p === 'today' ? 'Hari Ini' : p === 'week' ? '7 Hari' : p === 'month' ? 'Bulan Ini' : 'Kustom'}
          </button>
        ))}
        {preset === 'custom' && (
          <>
            <input type="date" className="input-field max-w-[10rem]" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <span className="text-ink-400">-</span>
            <input type="date" className="input-field max-w-[10rem]" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </>
        )}
        {report && (
          <div className="ml-auto flex gap-2">
            <button className="btn-secondary" onClick={() => void exportSalesReportCsv(report)}>
              Ekspor CSV
            </button>
            <button className="btn-secondary" onClick={() => void exportSalesReportPdf(report)}>
              Ekspor PDF
            </button>
          </div>
        )}
      </div>

      {!report ? (
        <p className="text-ink-500">Memuat laporan...</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Omzet" value={formatRupiah(report.revenue)} />
            <StatCard label="Jumlah Transaksi" value={String(report.transactionCount)} />
            <StatCard label="Rata-rata Transaksi" value={formatRupiah(report.averageTransaction)} />
            <StatCard label="Laba Kotor" value={formatRupiah(report.grossProfit)} accent="text-sage-500" />
            <StatCard label="Diskon" value={formatRupiah(report.discountTotal)} />
            <StatCard label="Pajak" value={formatRupiah(report.taxTotal)} />
            <StatCard label="Service Charge" value={formatRupiah(report.serviceChargeTotal)} />
            <StatCard label="Retur" value={formatRupiah(report.returnTotal)} />
            <StatCard label="Pembatalan" value={String(report.voidCount)} />
            <StatCard label="Pengeluaran" value={formatRupiah(report.expenseTotal)} accent="text-red-400" />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ReportTable
              title="Produk Terlaris"
              rows={report.topProducts.map((p) => [p.productName, `${p.qtySold}x`, formatRupiah(p.revenue)])}
              headers={['Produk', 'Qty', 'Omzet']}
            />
            <ReportTable
              title="Penjualan per Kategori"
              rows={report.byCategory.map((c) => [c.categoryName, formatRupiah(c.revenue)])}
              headers={['Kategori', 'Omzet']}
            />
            <ReportTable
              title="Penjualan per Kasir"
              rows={report.byCashier.map((c) => [c.cashierName, String(c.transactionCount), formatRupiah(c.revenue)])}
              headers={['Kasir', 'Transaksi', 'Omzet']}
            />
            <ReportTable
              title="Penjualan per Metode Pembayaran"
              rows={report.byPaymentMethod.map((m) => [PAYMENT_METHOD_LABELS[m.method] ?? m.method, formatRupiah(m.amount)])}
              headers={['Metode', 'Jumlah']}
            />
          </div>

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
                      <td className={`px-4 py-2 ${row.isLow ? 'text-red-400' : 'text-sage-500'}`}>{row.isLow ? 'Menipis' : 'Aman'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {ops && (
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
