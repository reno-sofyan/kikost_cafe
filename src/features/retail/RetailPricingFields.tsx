import { formatRupiah, parseRupiahInput } from '@/lib/currency'
import { newId } from '@/lib/id'
import { Icon } from '@/components/ui/Icon'
import type { SellUnit, TierPrice } from '@/types/domain'

/**
 * Form produk (minimarket): satuan jual tambahan (pak/dus dengan harga & barcode
 * sendiri), harga grosir bertingkat per satuan dasar, dan kode PLU timbangan.
 */
export function RetailPricingFields({
  basePrice,
  sellUnits,
  onSellUnits,
  tierPrices,
  onTierPrices,
  scaleCode,
  onScaleCode,
}: {
  basePrice: number
  sellUnits: SellUnit[]
  onSellUnits: (v: SellUnit[]) => void
  tierPrices: TierPrice[]
  onTierPrices: (v: TierPrice[]) => void
  scaleCode: string
  onScaleCode: (v: string) => void
}) {
  const patchUnit = (id: string, patch: Partial<SellUnit>) => onSellUnits(sellUnits.map((u) => (u.id === id ? { ...u, ...patch } : u)))
  const patchTier = (i: number, patch: Partial<TierPrice>) => onTierPrices(tierPrices.map((t, n) => (n === i ? { ...t, ...patch } : t)))

  return (
    <div className="mt-4 space-y-4 rounded-xl border border-ink-600 p-4">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-semibold text-ink-100">Satuan jual lain (pak / dus)</span>
          <button
            type="button"
            className="text-sm font-medium text-brand-400"
            onClick={() => onSellUnits([...sellUnits, { id: newId(), name: sellUnits.length ? 'Dus' : 'Pak', qty: 0, price: 0, barcode: null }])}
          >
            + Tambah satuan
          </button>
        </div>
        <p className="mb-2 text-xs text-ink-400">Dijual utuh dengan harga sendiri. Stok dipotong sebanyak isinya.</p>
        {sellUnits.map((u) => (
          <div key={u.id} className="mb-2 grid grid-cols-[1fr_5rem_1fr_1.3fr_auto] items-center gap-2">
            <input className="input-field" aria-label="Nama satuan" placeholder="Dus" value={u.name} onChange={(e) => patchUnit(u.id, { name: e.target.value })} />
            <input type="number" min={2} className="input-field" aria-label={`Isi ${u.name}`} placeholder="Isi" value={u.qty || ''} onChange={(e) => patchUnit(u.id, { qty: Math.floor(Number(e.target.value) || 0) })} />
            <input className="input-field" inputMode="numeric" aria-label={`Harga ${u.name}`} placeholder="Harga" value={u.price ? formatRupiah(u.price) : ''} onChange={(e) => patchUnit(u.id, { price: parseRupiahInput(e.target.value) })} />
            <input className="input-field" aria-label={`Barcode ${u.name}`} placeholder="Barcode (opsional)" value={u.barcode ?? ''} onChange={(e) => patchUnit(u.id, { barcode: e.target.value.trim() || null })} />
            <button type="button" className="p-2 text-red-400" aria-label={`Hapus satuan ${u.name}`} onClick={() => onSellUnits(sellUnits.filter((x) => x.id !== u.id))}>
              <Icon name="trash" size={16} />
            </button>
            {u.qty > 1 && u.price > 0 && basePrice > 0 && (
              <p className="col-span-5 -mt-1 text-xs text-ink-400">
                {formatRupiah(Math.round(u.price / u.qty))}/pcs · hemat {formatRupiah(Math.max(0, basePrice * u.qty - u.price))} dibanding eceran
              </p>
            )}
          </div>
        ))}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-semibold text-ink-100">Harga grosir</span>
          <button
            type="button"
            className="text-sm font-medium text-brand-400"
            onClick={() => onTierPrices([...tierPrices, { minQty: (tierPrices[tierPrices.length - 1]?.minQty ?? 5) * 2, price: 0 }])}
          >
            + Tambah tingkat
          </button>
        </div>
        <p className="mb-2 text-xs text-ink-400">Harga per pcs otomatis turun di kasir saat jumlah beli mencapai minimal.</p>
        {tierPrices.map((t, i) => (
          <div key={i} className="mb-2 grid grid-cols-[auto_6rem_auto_1fr_auto] items-center gap-2 text-sm text-ink-300">
            <span>Beli ≥</span>
            <input type="number" min={2} className="input-field" aria-label={`Minimal beli tingkat ${i + 1}`} value={t.minQty || ''} onChange={(e) => patchTier(i, { minQty: Math.floor(Number(e.target.value) || 0) })} />
            <span>harga/pcs</span>
            <input className="input-field" inputMode="numeric" aria-label={`Harga grosir tingkat ${i + 1}`} value={t.price ? formatRupiah(t.price) : ''} onChange={(e) => patchTier(i, { price: parseRupiahInput(e.target.value) })} />
            <button type="button" className="p-2 text-red-400" aria-label={`Hapus tingkat ${i + 1}`} onClick={() => onTierPrices(tierPrices.filter((_, n) => n !== i))}>
              <Icon name="trash" size={16} />
            </button>
          </div>
        ))}
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-ink-100">Kode PLU timbangan (opsional)</span>
        <input className="input-field max-w-[12rem]" inputMode="numeric" placeholder="mis. 00123" value={scaleCode} onChange={(e) => onScaleCode(e.target.value.replace(/\D/g, ''))} />
        <span className="mt-1 block text-xs text-ink-400">Untuk barang timbang (sayur, daging). Atur format barcode di Pengaturan → Barcode Timbangan.</span>
      </label>
    </div>
  )
}
