import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import Papa from 'papaparse'
import { listCategories } from '@/db/repositories/categories'
import { createProduct, exportProductsCsv, searchProducts, setProductAvailability, toggleFavorite } from '@/db/repositories/products'
import { formatRupiah } from '@/lib/currency'
import { saveTextFile } from '@/lib/saveFile'
import { ProductFormModal } from '@/features/products/ProductFormModal'
import { CategoryManager } from '@/features/products/CategoryManager'
import { ModifierManager } from '@/features/products/ModifierManager'
import { Icon } from '@/components/ui/Icon'
import type { Product } from '@/types/domain'

type Tab = 'produk' | 'kategori' | 'modifier'

interface ProductCsvRow {
  sku: string
  barcode?: string
  name: string
  category: string
  price: string
  cost: string
  stock: string
  unit: string
  available?: string
  favorite?: string
}

export function ProductsScreen() {
  const [tab, setTab] = useState<Tab>('produk')
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('all')
  const [editing, setEditing] = useState<Product | null>(null)
  const [showForm, setShowForm] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const categories = useLiveQuery(() => listCategories(), []) ?? []
  const products = useLiveQuery(() => searchProducts(search, categoryId), [search, categoryId]) ?? []

  async function handleExport() {
    const csv = await exportProductsCsv()
    await saveTextFile('produk-kikost-cafe.csv', csv, 'text/csv')
  }

  function handleImportClick() {
    fileInputRef.current?.click()
  }

  async function handleImportFile(file: File) {
    const text = await file.text()
    const parsed = Papa.parse<ProductCsvRow>(text, { header: true, skipEmptyLines: true })
    const categoryByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]))
    for (const row of parsed.data) {
      if (!row.sku || !row.name) continue
      const categoryId = categoryByName.get((row.category ?? '').toLowerCase()) ?? categories[0]?.id
      if (!categoryId) continue
      await createProduct({
        categoryId,
        name: row.name,
        sku: row.sku,
        barcode: row.barcode || null,
        price: Number(row.price) || 0,
        costPrice: Number(row.cost) || 0,
        unit: (row.unit as Product['unit']) || 'pcs',
        photoDataUrl: null,
        trackOwnStock: true,
        stockQty: Number(row.stock) || 0,
        lowStockThreshold: 10,
        isFavorite: row.favorite === '1',
        isAvailable: row.available !== '0',
        modifierGroupIds: [],
      })
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-ink-800 px-6 py-4">
        <h1 className="mr-4 text-xl font-bold text-ink-50">Produk</h1>
        {(['produk', 'kategori', 'modifier'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`btn !min-h-0 !px-4 !py-2 text-sm capitalize ${tab === t ? 'btn-primary' : 'btn-secondary'}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'produk' && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <input className="input-field max-w-xs" placeholder="Cari produk..." value={search} onChange={(e) => setSearch(e.target.value)} />
              <select className="input-field max-w-[10rem]" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="all">Semua Kategori</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true) }}>
                + Produk Baru
              </button>
              <button className="btn-secondary" onClick={() => void handleExport()}>
                Ekspor CSV
              </button>
              <button className="btn-secondary" onClick={handleImportClick}>
                Impor CSV
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleImportFile(file)
                  e.target.value = ''
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {products.map((product) => (
                <div key={product.id} className="card p-3">
                  <div className="mb-2 flex h-16 items-center justify-center rounded-lg bg-ink-800 text-2xl">
                    {product.photoDataUrl ? (
                      <img src={product.photoDataUrl} className="h-full w-full rounded-lg object-cover" alt={product.name} />
                    ) : (
                      <Icon name="coffee" size={28} className="text-ink-400" />
                    )}
                  </div>
                  <p className="truncate text-sm font-semibold text-ink-50">{product.name}</p>
                  <p className="text-xs text-ink-500">{product.sku}</p>
                  <p className="mt-1 font-bold text-brew-400">{formatRupiah(product.price)}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <button
                      className={`flex items-center gap-1 text-xs ${product.isFavorite ? 'text-brown-500' : 'text-ink-400'}`}
                      onClick={() => void toggleFavorite(product.id)}
                    >
                      <Icon name="star" size={14} fill={product.isFavorite ? 'currentColor' : 'none'} />
                      Favorit
                    </button>
                    <label className="flex items-center gap-1 text-xs text-ink-400">
                      <input
                        type="checkbox"
                        checked={product.isAvailable}
                        onChange={(e) => void setProductAvailability(product.id, e.target.checked)}
                      />
                      Tersedia
                    </label>
                  </div>
                  <button
                    className="btn-secondary mt-2 w-full !min-h-0 !py-1.5 text-xs"
                    onClick={() => {
                      setEditing(product)
                      setShowForm(true)
                    }}
                  >
                    Edit
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'kategori' && <CategoryManager />}
        {tab === 'modifier' && <ModifierManager />}
      </div>

      {showForm && <ProductFormModal initial={editing} onClose={() => setShowForm(false)} />}
    </div>
  )
}
