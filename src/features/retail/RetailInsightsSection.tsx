import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import Papa from 'papaparse'
import { buildRetailInsights } from '@/db/repositories/retailInsights'
import { PillTabs } from '@/features/retail/retailUi'
import { formatRupiah } from '@/lib/currency'
import { formatDate } from '@/lib/datetime'
import { saveTextFile } from '@/lib/saveFile'
import type { AbcClass } from '@/lib/retailAnalysis'

type View = 'abc' | 'margin' | 'mati' | 'kasir' | 'pajak'

const ABC_STYLE: Record<AbcClass, string> = {
  A: 'border-success-600 text-success-500',
  B: 'border-accent-500 text-accent-400',
  C: 'border-ink-400 text-ink-300',
}

const qty = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 3 })

function coverLabel(days: number | null): string {
  if (days === null) return '—'
  if (days < 1) return '< 1 hari'
  return `${Math.round(days).toLocaleString('id-ID')} hari`
}

/** Laporan (minimarket): analisis ABC, margin, stok mati, kontrol kasir, PPN. */
export function RetailInsightsSection({ range }: { range: { from: number; to: number } }) {
  const [view, setView] = useState<View>('abc')
  const [deadDays, setDeadDays] = useState(30)
  const data = useLiveQuery(() => buildRetailInsights(range, deadDays), [range.from, range.to, deadDays])

  function exportCsv() {
    if (!data) return
    const csv = Papa.unparse(
      data.products.map((p) => ({
        Produk: p.name,
        Kategori: p.categoryName,
        Kelas: p.abc,
        Terjual: p.qty,
        Omzet: p.revenue,
        HPP: p.cost,
        Laba: p.profit,
        'Margin %': p.marginPercent,
        'Porsi omzet %': Math.round(p.share * 1000) / 10,
        Stok: p.stockQty,
        'Stok cukup (hari)': p.coverDays === null ? '' : Math.round(p.coverDays),
      })),
    )
    void saveTextFile(`analisis-produk-${formatDate(range.from)}.csv`, csv, 'text/csv')
  }

  return (
    <div className="card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-ink-50">Analisis Toko</h3>
        <PillTabs<View>
          value={view}
          onChange={setView}
          tabs={[
            { id: 'abc', label: 'ABC & laku' },
            { id: 'margin', label: 'Margin' },
            { id: 'mati', label: 'Stok mati', dot: (data?.deadStock.length ?? 0) > 0 },
            { id: 'kasir', label: 'Kontrol kasir' },
            { id: 'pajak', label: 'PPN' },
          ]}
        />
      </div>
      {!data ? (
        <p className="py-6 text-center text-sm text-ink-300">Menghitung…</p>
      ) : (
        <>
          {view === 'abc' && (
            <>
              <p className="mb-2 text-xs text-ink-300">
                A = penyumbang ±80% omzet (jangan sampai kosong), B = 15% berikutnya, C = sisanya (kandidat dikurangi). "Stok cukup" = perkiraan dengan laju jual {data.days} hari ini.{' '}
                <button className="font-medium text-brand-400" onClick={exportCsv}>
                  Ekspor CSV
                </button>
              </p>
              <Table
                head={['Produk', 'Kelas', 'Terjual', 'Omzet', 'Porsi', 'Stok', 'Stok cukup']}
                rows={data.products.map((p) => [
                  p.name,
                  <span key="c" className={`inline-flex rounded-full border px-2 text-xs font-semibold ${ABC_STYLE[p.abc]}`}>
                    {p.abc}
                  </span>,
                  qty(p.qty),
                  formatRupiah(p.revenue),
                  `${(p.share * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`,
                  qty(p.stockQty),
                  <span key="d" className={p.coverDays !== null && p.coverDays < 3 ? 'font-semibold text-red-500' : p.coverDays !== null && p.coverDays > 60 ? 'text-accent-400' : ''}>
                    {coverLabel(p.coverDays)}
                  </span>,
                ])}
                empty="Belum ada penjualan di periode ini."
              />
            </>
          )}
          {view === 'margin' && (
            <>
              <Table
                head={['Kategori', 'Omzet', 'HPP', 'Laba kotor', 'Margin']}
                rows={data.categories.map((c) => [c.name, formatRupiah(c.revenue), formatRupiah(c.cost), formatRupiah(c.profit), `${c.marginPercent}%`])}
                empty="Belum ada penjualan."
              />
              <h4 className="mb-1 mt-4 text-sm font-semibold text-ink-100">Margin terendah per produk</h4>
              <Table
                head={['Produk', 'Omzet', 'Laba kotor', 'Margin']}
                rows={[...data.products]
                  .sort((a, b) => a.marginPercent - b.marginPercent)
                  .slice(0, 15)
                  .map((p) => [p.name, formatRupiah(p.revenue), formatRupiah(p.profit), <span key="m" className={p.marginPercent < 5 ? 'font-semibold text-red-500' : ''}>{p.marginPercent}%</span>])}
                empty="—"
              />
            </>
          )}
          {view === 'mati' && (
            <>
              <div className="mb-2 flex items-center gap-2 text-sm text-ink-200">
                Tidak terjual selama
                <select className="rounded-lg border border-ink-600 bg-ink-900 px-2 py-1" aria-label="Batas hari stok mati" value={deadDays} onChange={(e) => setDeadDays(Number(e.target.value))}>
                  {[14, 30, 60, 90].map((d) => (
                    <option key={d} value={d}>
                      {d} hari
                    </option>
                  ))}
                </select>
                · modal tertahan <span className="font-semibold text-ink-50">{formatRupiah(data.deadStockValue)}</span>
              </div>
              <Table
                head={['Produk', 'Stok', 'Nilai (HPP)', 'Terakhir terjual']}
                rows={data.deadStock.map((d) => [d.name, qty(d.stockQty), formatRupiah(d.stockValue), d.lastSoldAt ? formatDate(d.lastSoldAt) : 'Belum pernah'])}
                empty="Tidak ada stok mati. 👍"
              />
            </>
          )}
          {view === 'kasir' && (
            <>
              <p className="mb-2 text-xs text-ink-300">Hapus item & pengurangan qty sebelum bayar, pembatalan, retur, dan diskon per kasir — angka yang mencolok layak dicek.</p>
              <Table
                head={['Kasir', 'Transaksi', 'Omzet', 'Hapus item', 'Void', 'Retur', 'Diskon']}
                rows={data.cashiers.map((c) => [
                  c.name,
                  String(c.transactions),
                  formatRupiah(c.revenue),
                  `${c.removedCount}× · ${formatRupiah(c.removedValue)}`,
                  `${c.voidCount}× · ${formatRupiah(c.voidValue)}`,
                  `${c.returnCount}× · ${formatRupiah(c.returnValue)}`,
                  formatRupiah(c.discountValue),
                ])}
                empty="Belum ada aktivitas kasir."
              />
            </>
          )}
          {view === 'pajak' && (
            <div className="grid grid-cols-3 gap-3 text-sm">
              <Stat label="PPN keluaran" value={formatRupiah(data.tax.taxTotal)} />
              <Stat label="DPP (penjualan kena pajak)" value={formatRupiah(data.tax.taxableSales)} />
              <Stat label="Transaksi kena pajak" value={String(data.tax.orderCount)} />
              <p className="col-span-3 text-xs text-ink-300">Atur tarif di Pengaturan → Pajak & Struk. Angka ini untuk rekap SPT Masa PPN; cocokkan dengan faktur bila Anda PKP.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-ink-800 p-3">
      <p className="text-ink-300">{label}</p>
      <p className="mt-1 text-lg font-bold text-ink-50">{value}</p>
    </div>
  )
}

function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  return (
    <div className="max-h-[26rem] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-ink-900 text-left text-ink-300">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={`py-2 font-medium ${i > 0 ? 'text-right' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-ink-600">
              {r.map((cell, j) => (
                <td key={j} className={`py-2 ${j > 0 ? 'text-right text-ink-100' : 'text-ink-50'}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={head.length} className="py-6 text-center text-ink-300">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
