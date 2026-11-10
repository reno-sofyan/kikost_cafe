import { Icon } from '@/components/ui/Icon'
import { stockTone } from '@/features/retail/retailHelpers'
import type { Product } from '@/types/domain'

export function StockStatusBadge({ product }: { product: Pick<Product, 'stockQty' | 'lowStockThreshold'> }) {
  const s = stockTone(product)
  return <span className={`inline-flex min-w-[3.6rem] justify-center rounded-full border bg-ink-900 px-3 py-0.5 text-xs font-medium ${s.badge}`}>{s.label}</span>
}

/** Foto produk, atau ikon kotak di latar netral. */
export function ProductThumb({ product, className = '' }: { product: Pick<Product, 'name' | 'photoDataUrl'>; className?: string }) {
  return (
    <div className={`flex items-center justify-center overflow-hidden bg-ink-900 ${className}`}>
      {product.photoDataUrl ? (
        <img src={product.photoDataUrl} alt={product.name} loading="lazy" decoding="async" className="h-full w-full object-contain p-2" />
      ) : (
        <Icon name="box" size={30} className="text-ink-400" />
      )}
    </div>
  )
}

/** Tab bergaya pil di dalam wadah putih (Stok, Produk). */
export function PillTabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; dot?: boolean }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl border border-ink-600 bg-ink-900 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          aria-pressed={value === t.id}
          className={`relative flex min-h-[2.4rem] flex-none items-center gap-1 whitespace-nowrap rounded-xl px-3.5 text-sm font-medium transition-colors ${
            value === t.id ? 'bg-brand-600/80 text-white' : 'text-[#14306e] hover:bg-ink-800'
          }`}
        >
          {t.label}
          {t.dot && <span className={`mb-2 flex h-2.5 w-2.5 items-center justify-center rounded-full border text-[7px] font-bold leading-none ${value === t.id ? 'border-white text-white' : 'border-red-500 text-red-500'}`}>!</span>}
        </button>
      ))}
    </div>
  )
}

export const RETAIL_CARD = 'rounded-2xl border border-ink-600 bg-ink-900'
