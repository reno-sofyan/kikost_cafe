import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { Modal } from '@/components/ui/Modal'
import { formatRupiah } from '@/lib/currency'
import { sellUnitLabel, sortedTiers, validSellUnits } from '@/lib/retailPricing'
import { savePriceLabelsPdf, type PriceLabel } from '@/features/retail/priceLabels'
import { toast } from '@/state/toastStore'
import type { Product } from '@/types/domain'

/** Label harga per produk: harga eceran + catatan grosir, barcode produk (atau SKU). */
function labelsFor(p: Product, copies: number, withUnits: boolean): PriceLabel[] {
  const tier = sortedTiers(p.tierPrices)[0]
  const base: PriceLabel = {
    name: p.name,
    price: p.price,
    code: p.barcode?.trim() || p.sku.trim() || null,
    ...(tier ? { note: `Beli ≥ ${tier.minQty}: ${formatRupiah(tier.price)}/pcs` } : {}),
  }
  const units: PriceLabel[] = withUnits
    ? validSellUnits(p.sellUnits).map((u) => ({ name: `${p.name} · ${sellUnitLabel(u)}`, price: u.price, code: u.barcode?.trim() || null }))
    : []
  return Array.from({ length: copies }, () => [base, ...units]).flat()
}

export function PriceLabelModal({ onClose }: { onClose: () => void }) {
  const products = useLiveQuery(() => db.products.filter((p) => !p.archived).sortBy('name'), []) ?? []
  const [query, setQuery] = useState('')
  const [copies, setCopies] = useState<Record<string, number>>({})
  const [withUnits, setWithUnits] = useState(true)
  const [onlyRecent, setOnlyRecent] = useState(false)
  const [busy, setBusy] = useState(false)

  // "Harga berubah 7 hari terakhir" — label rak yang perlu diganti.
  const weekAgo = Date.now() - 7 * 86_400_000
  const q = query.trim().toLowerCase()
  const shown = products.filter((p) => (!q || p.name.toLowerCase().includes(q) || (p.barcode ?? '').includes(q) || p.sku.toLowerCase().includes(q)) && (!onlyRecent || p.updatedAt >= weekAgo))
  const selected = products.filter((p) => (copies[p.id] ?? 0) > 0)
  const labelCount = selected.reduce((s, p) => s + labelsFor(p, copies[p.id]!, withUnits).length, 0)

  async function print() {
    setBusy(true)
    try {
      await savePriceLabelsPdf(selected.flatMap((p) => labelsFor(p, copies[p.id]!, withUnits)))
      toast.success(`${labelCount} label disimpan sebagai PDF`)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal membuat label')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-3xl bg-ink-900 p-6">
      <h2 className="text-xl font-semibold text-ink-50">Cetak label harga & barcode</h2>
      <p className="mb-3 text-sm text-ink-300">PDF A4, 24 label per halaman (70 × 37 mm). Produk tanpa barcode memakai SKU.</p>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input className="input-field flex-1" placeholder="Cari produk..." value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-ink-200">
          <input type="checkbox" checked={onlyRecent} onChange={(e) => setOnlyRecent(e.target.checked)} /> Diubah 7 hari terakhir
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-200">
          <input type="checkbox" checked={withUnits} onChange={(e) => setWithUnits(e.target.checked)} /> Sertakan label pak/dus
        </label>
        <button className="text-sm font-medium text-brand-400" onClick={() => setCopies((c) => ({ ...c, ...Object.fromEntries(shown.map((p) => [p.id, Math.max(1, c[p.id] ?? 0)])) }))}>
          Pilih semua
        </button>
      </div>
      <div className="min-h-0 flex-1 divide-y divide-ink-600 overflow-y-auto">
        {shown.map((p) => (
          <div key={p.id} className="flex items-center gap-3 py-2">
            <input
              type="checkbox"
              aria-label={`Pilih ${p.name}`}
              checked={(copies[p.id] ?? 0) > 0}
              onChange={(e) => setCopies((c) => ({ ...c, [p.id]: e.target.checked ? 1 : 0 }))}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-ink-50">{p.name}</p>
              <p className="text-xs text-ink-300">
                {formatRupiah(p.price)} · {p.barcode || p.sku || 'tanpa kode'}
              </p>
            </div>
            <input
              type="number"
              min={0}
              className="w-16 rounded-lg border border-ink-600 px-2 py-1 text-center text-ink-50"
              aria-label={`Jumlah label ${p.name}`}
              value={copies[p.id] ?? 0}
              onChange={(e) => setCopies((c) => ({ ...c, [p.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
            />
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-ink-600 pt-4">
        <p className="text-sm text-ink-200">{labelCount} label · {Math.ceil(labelCount / 24)} halaman</p>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Batal
          </button>
          <button className="btn-primary !rounded-xl" disabled={busy || labelCount === 0} onClick={() => void print()}>
            {busy ? 'Membuat…' : 'Simpan PDF'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
