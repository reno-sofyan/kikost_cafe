import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listCategories } from '@/db/repositories/categories'
import { listModifierGroups } from '@/db/repositories/modifiers'
import { createProduct, getRecipeForProduct, saveRecipe, updateProduct } from '@/db/repositories/products'
import { listIngredients } from '@/db/repositories/stock'
import { parseRupiahInput, formatRupiah } from '@/lib/currency'
import { Icon } from '@/components/ui/Icon'
import { db } from '@/db/schema'
import type { Product, RecipeItem, UnitOfMeasure } from '@/types/domain'

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

const UNITS: UnitOfMeasure[] = ['pcs', 'g', 'kg', 'ml', 'l']

export function ProductFormModal({ initial, onClose }: { initial: Product | null; onClose: () => void }) {
  const categories = useLiveQuery(() => listCategories(), []) ?? []
  const modifierGroups = useLiveQuery(() => listModifierGroups(), []) ?? []
  const ingredients = useLiveQuery(() => listIngredients(), []) ?? []
  const existingRecipe = useLiveQuery(() => (initial ? getRecipeForProduct(initial.id) : undefined), [initial?.id])

  const [name, setName] = useState(initial?.name ?? '')
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? categories[0]?.id ?? '')
  const [sku, setSku] = useState(initial?.sku ?? '')
  const [barcode, setBarcode] = useState(initial?.barcode ?? '')
  const [price, setPrice] = useState(initial?.price ?? 0)
  const [costPrice, setCostPrice] = useState(initial?.costPrice ?? 0)
  const [unit, setUnit] = useState<UnitOfMeasure>(initial?.unit ?? 'pcs')
  const [stockQty, setStockQty] = useState(initial?.stockQty ?? 0)
  const [lowStockThreshold, setLowStockThreshold] = useState(initial?.lowStockThreshold ?? 10)
  const [isAvailable, setIsAvailable] = useState(initial?.isAvailable ?? true)
  const [isFavorite, setIsFavorite] = useState(initial?.isFavorite ?? false)
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(initial?.photoDataUrl ?? null)
  const [selectedModifierGroupIds, setSelectedModifierGroupIds] = useState<string[]>(initial?.modifierGroupIds ?? [])
  const [recipeItems, setRecipeItems] = useState<RecipeItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const recipeLoadedRef = useRef(false)

  useEffect(() => {
    if (recipeLoadedRef.current) return
    if (existingRecipe === undefined) return
    recipeLoadedRef.current = true
    setRecipeItems(existingRecipe.items)
  }, [existingRecipe])

  function toggleModifierGroup(id: string) {
    setSelectedModifierGroupIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]))
  }

  function addRecipeItem() {
    const firstIngredient = ingredients[0]
    if (!firstIngredient) return
    setRecipeItems((prev) => [...prev, { ingredientId: firstIngredient.id, qty: 1 }])
  }

  async function handleSave() {
    if (!name.trim() || !categoryId || !sku.trim()) {
      setError('Nama, kategori, dan SKU wajib diisi')
      return
    }
    const normalizedSku = sku.trim().toLowerCase()
    const normalizedBarcode = barcode.trim().toLowerCase()
    const allProducts = await db.products.toArray()
    const skuTaken = allProducts.some((p) => p.id !== initial?.id && p.sku.toLowerCase() === normalizedSku)
    if (skuTaken) {
      setError('SKU sudah digunakan produk lain')
      return
    }
    if (normalizedBarcode) {
      const barcodeTaken = allProducts.some((p) => p.id !== initial?.id && (p.barcode ?? '').toLowerCase() === normalizedBarcode)
      if (barcodeTaken) {
        setError('Barcode sudah digunakan produk lain')
        return
      }
    }
    const payload = {
      categoryId,
      name: name.trim(),
      sku: sku.trim(),
      barcode: barcode.trim() || null,
      price,
      costPrice,
      unit,
      photoDataUrl,
      trackOwnStock: recipeItems.length === 0,
      stockQty,
      lowStockThreshold,
      isFavorite,
      isAvailable,
      modifierGroupIds: selectedModifierGroupIds,
    }
    let productId = initial?.id
    if (initial) {
      await updateProduct(initial.id, payload)
    } else {
      const created = await createProduct(payload)
      productId = created.id
    }
    if (productId && recipeItems.length > 0) {
      await saveRecipe(productId, recipeItems)
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-ink-900 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-ink-50">{initial ? 'Edit Produk' : 'Produk Baru'}</h2>

        <div className="grid grid-cols-2 gap-4">
          <label className="col-span-2 sm:col-span-1">
            <span className="mb-1 block text-sm text-ink-300">Nama Produk</span>
            <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="col-span-2 sm:col-span-1">
            <span className="mb-1 block text-sm text-ink-300">Kategori</span>
            <select className="input-field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-sm text-ink-300">SKU</span>
            <input className="input-field" value={sku} onChange={(e) => setSku(e.target.value)} />
          </label>
          <label>
            <span className="mb-1 block text-sm text-ink-300">Barcode (opsional)</span>
            <input className="input-field" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          </label>
          <label>
            <span className="mb-1 block text-sm text-ink-300">Harga Jual</span>
            <input className="input-field" inputMode="numeric" value={formatRupiah(price)} onChange={(e) => setPrice(parseRupiahInput(e.target.value))} />
          </label>
          <label>
            <span className="mb-1 block text-sm text-ink-300">HPP (Harga Pokok)</span>
            <input className="input-field" inputMode="numeric" value={formatRupiah(costPrice)} onChange={(e) => setCostPrice(parseRupiahInput(e.target.value))} />
          </label>
          <label>
            <span className="mb-1 block text-sm text-ink-300">Satuan</span>
            <select className="input-field" value={unit} onChange={(e) => setUnit(e.target.value as UnitOfMeasure)}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-sm text-ink-300">Foto</span>
            <input
              type="file"
              accept="image/*"
              className="text-sm text-ink-300"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (file) setPhotoDataUrl(await readFileAsDataUrl(file))
              }}
            />
          </label>
        </div>

        {recipeItems.length === 0 && (
          <div className="mt-4 grid grid-cols-2 gap-4">
            <label>
              <span className="mb-1 block text-sm text-ink-300">Stok</span>
              <input type="number" className="input-field" value={stockQty} onChange={(e) => setStockQty(Number(e.target.value))} />
            </label>
            <label>
              <span className="mb-1 block text-sm text-ink-300">Batas Stok Menipis</span>
              <input type="number" className="input-field" value={lowStockThreshold} onChange={(e) => setLowStockThreshold(Number(e.target.value))} />
            </label>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-ink-300">
            <input type="checkbox" checked={isAvailable} onChange={(e) => setIsAvailable(e.target.checked)} />
            Tersedia
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-300">
            <input type="checkbox" checked={isFavorite} onChange={(e) => setIsFavorite(e.target.checked)} />
            Favorit
          </label>
        </div>

        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-ink-300">Modifier</h3>
          <div className="flex flex-wrap gap-2">
            {modifierGroups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => toggleModifierGroup(g.id)}
                className={`rounded-full border px-3 py-1.5 text-sm ${
                  selectedModifierGroupIds.includes(g.id) ? 'border-brew-500 bg-brew-600 text-white' : 'border-ink-700 bg-ink-800 text-ink-300'
                }`}
              >
                {g.name}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink-300">Resep / BOM (opsional)</h3>
            <button type="button" className="btn-secondary !min-h-0 !px-3 !py-1.5 text-xs" onClick={addRecipeItem} disabled={ingredients.length === 0}>
              + Bahan
            </button>
          </div>
          {recipeItems.map((item, index) => (
            <div key={index} className="mb-2 flex items-center gap-2">
              <select
                className="input-field flex-1"
                value={item.ingredientId}
                onChange={(e) =>
                  setRecipeItems((prev) => prev.map((it, i) => (i === index ? { ...it, ingredientId: e.target.value } : it)))
                }
              >
                {ingredients.map((ing) => (
                  <option key={ing.id} value={ing.id}>
                    {ing.name} ({ing.unit})
                  </option>
                ))}
              </select>
              <input
                type="number"
                className="input-field w-24"
                value={item.qty}
                onChange={(e) => setRecipeItems((prev) => prev.map((it, i) => (i === index ? { ...it, qty: Number(e.target.value) } : it)))}
              />
              <button type="button" className="text-red-400" onClick={() => setRecipeItems((prev) => prev.filter((_, i) => i !== index))}>
                <Icon name="close" size={16} />
              </button>
            </div>
          ))}
          {recipeItems.length > 0 && (
            <p className="text-xs text-ink-500">Jika resep diisi, stok produk otomatis dikelola lewat stok bahan baku.</p>
          )}
        </div>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <div className="mt-6 flex gap-3">
          <button className="btn-ghost flex-1" onClick={onClose}>
            Batal
          </button>
          <button className="btn-primary flex-[2]" onClick={() => void handleSave()}>
            Simpan
          </button>
        </div>
      </div>
    </div>
  )
}
