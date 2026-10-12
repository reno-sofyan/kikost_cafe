import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listCategories } from '@/db/repositories/categories'
import { listModifierGroups } from '@/db/repositories/modifiers'
import { createProduct, getRecipeForProduct, listProducts, saveRecipe, updateProduct } from '@/db/repositories/products'
import { listIngredients } from '@/db/repositories/stock'
import { getSettings } from '@/db/repositories/settings'
import { featuresForBusinessType } from '@/lib/businessType'
import { parseRupiahInput, formatRupiah } from '@/lib/currency'
import { compatibleUnits } from '@/lib/units'
import { readFileAsResizedDataUrl } from '@/lib/image'
import { Icon } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import { db } from '@/db/schema'
import { ONLINE_PLATFORM_LABELS } from '@/lib/onlineOrders'
import { normalizeProductTags, PRODUCT_TAGS } from '@/lib/productTags'
import type { OnlinePlatform, Product, RecipeItem, UnitOfMeasure } from '@/types/domain'

const PRICED_PLATFORMS: OnlinePlatform[] = ['gofood', 'grabfood', 'shopeefood']

const UNITS: UnitOfMeasure[] = ['pcs', 'g', 'kg', 'ml', 'l']

export function ProductFormModal({ initial, onClose }: { initial: Product | null; onClose: () => void }) {
  const categories = useLiveQuery(() => listCategories(), []) ?? []
  const modifierGroups = useLiveQuery(() => listModifierGroups(), []) ?? []
  const ingredients = useLiveQuery(() => listIngredients(), []) ?? []
  const settings = useLiveQuery(() => getSettings(), [])
  const features = featuresForBusinessType(settings?.businessType ?? 'lainnya')
  const existingRecipe = useLiveQuery(() => (initial ? getRecipeForProduct(initial.id) : undefined), [initial?.id])

  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? categories[0]?.id ?? '')
  // Daftar kategori dimuat async (useLiveQuery) — saat form pertama dirender masih
  // kosong, jadi default di atas tak pernah terisi sementara <select> TAMPAK sudah
  // memilih kategori pertama. Isi default begitu kategorinya tersedia.
  const firstCategoryId = categories[0]?.id
  useEffect(() => {
    if (!categoryId && firstCategoryId) setCategoryId(firstCategoryId)
  }, [categoryId, firstCategoryId])
  const [sku, setSku] = useState(initial?.sku ?? '')
  const [barcode, setBarcode] = useState(initial?.barcode ?? '')
  const [price, setPrice] = useState(initial?.price ?? 0)
  const [onlinePrice, setOnlinePrice] = useState(initial?.onlinePrice ?? 0)
  const [platformPrices, setPlatformPrices] = useState<Partial<Record<OnlinePlatform, number>>>(initial?.platformPrices ?? {})
  const [costPrice, setCostPrice] = useState(initial?.costPrice ?? 0)
  const [unit, setUnit] = useState<UnitOfMeasure>(initial?.unit ?? 'pcs')
  const [stockQty, setStockQty] = useState(initial?.stockQty ?? 0)
  const [lowStockThreshold, setLowStockThreshold] = useState(initial?.lowStockThreshold ?? 10)
  const [isAvailable, setIsAvailable] = useState(initial?.isAvailable ?? true)
  const [isFavorite, setIsFavorite] = useState(initial?.isFavorite ?? false)
  const [tags, setTags] = useState<string[]>(normalizeProductTags(initial?.tags))
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(initial?.photoDataUrl ?? null)
  const [selectedModifierGroupIds, setSelectedModifierGroupIds] = useState<string[]>(initial?.modifierGroupIds ?? [])
  // Menu paket: isi paket = produk lain (bukan paket) beserta jumlahnya.
  const [comboItems, setComboItems] = useState<{ productId: string; qty: number }[]>(initial?.comboItems ?? [])
  const comboCandidates = (useLiveQuery(() => listProducts(), []) ?? []).filter((p) => p.id !== initial?.id && !p.comboItems?.length)
  const comboNormalPrice = comboItems.reduce((s, c) => s + (comboCandidates.find((p) => p.id === c.productId)?.price ?? 0) * c.qty, 0)
  const comboCost = comboItems.reduce((s, c) => s + (comboCandidates.find((p) => p.id === c.productId)?.costPrice ?? 0) * c.qty, 0)
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
    const missing = [!name.trim() && 'Nama', !categoryId && 'Kategori', !sku.trim() && 'SKU'].filter(Boolean)
    if (missing.length > 0) {
      setError(
        !categoryId && categories.length === 0
          ? 'Belum ada kategori — buat dulu di tab Kategori.'
          : `${missing.join(', ')} wajib diisi.`,
      )
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
      description: description.trim(),
      sku: sku.trim(),
      barcode: barcode.trim() || null,
      price,
      // 0 = kosong → pesanan online memakai harga jual biasa.
      onlinePrice: onlinePrice > 0 ? onlinePrice : null,
      platformPrices: Object.values(platformPrices).some((v) => (v ?? 0) > 0)
        ? (Object.fromEntries(Object.entries(platformPrices).filter(([, v]) => (v ?? 0) > 0)) as Partial<Record<OnlinePlatform, number>>)
        : null,
      costPrice,
      unit,
      photoDataUrl,
      // Menu paket tak punya stok sendiri — stok dipotong dari produk isinya.
      trackOwnStock: recipeItems.length === 0 && comboItems.length === 0,
      comboItems: comboItems.filter((c) => c.qty > 0),
      stockQty,
      lowStockThreshold,
      isFavorite,
      isAvailable,
      tags: normalizeProductTags(tags),
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
    <Modal onClose={onClose} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-ink-900 p-6">
        <h2 className="mb-4 text-lg font-bold text-ink-50">{initial ? 'Edit Produk' : 'Produk Baru'}</h2>

        <div className="grid grid-cols-2 gap-4">
          <label className="col-span-2 sm:col-span-1">
            <span className="mb-1 block text-sm text-ink-300">Nama Produk</span>
            <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="col-span-2">
            <span className="mb-1 block text-sm text-ink-300">Deskripsi (opsional, tampil di halaman pesan-mandiri QR)</span>
            <textarea
              className="input-field min-h-0"
              rows={2}
              maxLength={300}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="mis. Satu shot kopi pekat dengan crema lembut di atasnya."
            />
          </label>
          <label className="col-span-2 sm:col-span-1">
            <span className="mb-1 block text-sm text-ink-300">Kategori</span>
            <select className="input-field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {!categoryId && <option value="">— Pilih kategori —</option>}
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
          {(features.onlineOrders || onlinePrice > 0) && (
            <div>
            <label>
              <span className="mb-1 block text-sm text-ink-300">Harga Online (opsional)</span>
              <input
                className="input-field"
                inputMode="numeric"
                placeholder="Sama dengan harga jual"
                value={onlinePrice > 0 ? formatRupiah(onlinePrice) : ''}
                onChange={(e) => setOnlinePrice(parseRupiahInput(e.target.value))}
              />
              <span className="mt-1 block text-xs text-ink-500">
                {onlinePrice > 0 && price > 0
                  ? `Dipakai untuk pesanan GoFood/GrabFood/ShopeeFood — ${onlinePrice >= price ? '+' : ''}${(((onlinePrice - price) / price) * 100).toFixed(0)}% dari harga jual.`
                  : 'Dipakai untuk pesanan GoFood/GrabFood/ShopeeFood. Kosongkan bila sama.'}
              </span>
            </label>
              <details className="mt-2" open={Object.values(platformPrices).some((v) => (v ?? 0) > 0)}>
                <summary className="cursor-pointer text-xs font-semibold text-brand-400">Harga berbeda per aplikasi</summary>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {PRICED_PLATFORMS.map((platform) => (
                    <label key={platform}>
                      <span className="mb-1 block text-xs text-ink-300">{ONLINE_PLATFORM_LABELS[platform]}</span>
                      <input
                        className="input-field"
                        inputMode="numeric"
                        aria-label={`Harga ${ONLINE_PLATFORM_LABELS[platform]}`}
                        placeholder="Ikut harga online"
                        value={(platformPrices[platform] ?? 0) > 0 ? formatRupiah(platformPrices[platform] ?? 0) : ''}
                        onChange={(e) => setPlatformPrices((p) => ({ ...p, [platform]: parseRupiahInput(e.target.value) }))}
                      />
                    </label>
                  ))}
                </div>
              </details>
            </div>
          )}
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
                if (file) setPhotoDataUrl(await readFileAsResizedDataUrl(file))
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

        {(features.proTools || tags.length > 0) && (
          <div className="mt-4">
            <span className="mb-2 block text-sm text-ink-300">Label menu & info alergen (tampil di kasir dan halaman pesan QR)</span>
            <div className="flex flex-wrap gap-2">
              {PRODUCT_TAGS.map((t) => {
                const on = tags.includes(t.id)
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTags((current) => (on ? current.filter((x) => x !== t.id) : [...current, t.id]))}
                    className={`rounded-full border px-3 py-1.5 text-sm ${on ? (t.allergen ? 'border-yellow-500 bg-yellow-900/30 text-yellow-300' : 'border-brand-500 bg-brand-600/20 text-brand-300') : 'border-ink-700 text-ink-300'}`}
                  >
                    {t.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {(features.combos || comboItems.length > 0) && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-ink-300">Menu Paket / Combo (opsional)</h3>
            <p className="mb-2 text-xs text-ink-500">
              Isi paket dijual dengan satu Harga Jual di atas. Stok dipotong dari tiap produk isinya, dan isinya ikut tercetak di tiket dapur & struk.
            </p>
            <div className="space-y-2">
              {comboItems.map((c, index) => (
                <div key={index} className="flex items-center gap-2">
                  <select
                    className="input-field flex-1"
                    aria-label={`Produk isi paket ${index + 1}`}
                    value={c.productId}
                    onChange={(e) => setComboItems((list) => list.map((x, i) => (i === index ? { ...x, productId: e.target.value } : x)))}
                  >
                    {comboCandidates.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {formatRupiah(p.price)}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    className="input-field !w-20"
                    aria-label={`Jumlah isi paket ${index + 1}`}
                    value={c.qty}
                    onChange={(e) => setComboItems((list) => list.map((x, i) => (i === index ? { ...x, qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) } : x)))}
                  />
                  <button className="btn-ghost btn-compact !px-3 !text-red-400" aria-label={`Hapus isi paket ${index + 1}`} onClick={() => setComboItems((list) => list.filter((_, i) => i !== index))}>
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
                className="btn-secondary btn-compact !px-3 text-sm"
                disabled={comboCandidates.length === 0}
                onClick={() => setComboItems((list) => [...list, { productId: comboCandidates.find((p) => !list.some((x) => x.productId === p.id))?.id ?? comboCandidates[0].id, qty: 1 }])}
              >
                + Tambah Isi Paket
              </button>
              {comboItems.length > 0 && (
                <span className="text-xs text-ink-400">
                  Harga normal isi {formatRupiah(comboNormalPrice)}
                  {price > 0 && comboNormalPrice > price ? ` • hemat ${formatRupiah(comboNormalPrice - price)}` : ''} • HPP isi {formatRupiah(comboCost)}
                  {costPrice !== comboCost && (
                    <button className="ml-2 text-brand-400 underline-offset-2 hover:underline" onClick={() => setCostPrice(comboCost)}>
                      Pakai sebagai HPP
                    </button>
                  )}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Disembunyikan bila tak relevan untuk jenis usaha, kecuali produk ini sudah memakainya. */}
        {(features.modifiers || selectedModifierGroupIds.length > 0) && (
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-semibold text-ink-300">Modifier</h3>
            <div className="flex flex-wrap gap-2">
              {modifierGroups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => toggleModifierGroup(g.id)}
                  className={`rounded-full border px-3 py-1.5 text-sm ${
                    selectedModifierGroupIds.includes(g.id) ? 'border-brand-500 bg-brand-600 text-white' : 'border-ink-700 bg-ink-800 text-ink-300'
                  }`}
                >
                  {g.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {(features.recipes || recipeItems.length > 0) && (
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink-300">Resep / BOM (opsional)</h3>
              <button type="button" className="btn-secondary !min-h-[2.75rem] !px-3 !py-1.5 text-xs" onClick={addRecipeItem} disabled={ingredients.length === 0}>
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
                  step="any"
                  className="input-field w-20"
                  value={item.qty}
                  onChange={(e) => setRecipeItems((prev) => prev.map((it, i) => (i === index ? { ...it, qty: Number(e.target.value) } : it)))}
                />
                <select
                  className="input-field w-20"
                  value={item.unit ?? ingredients.find((g) => g.id === item.ingredientId)?.unit ?? 'g'}
                  onChange={(e) =>
                    setRecipeItems((prev) =>
                      prev.map((it, i) => (i === index ? { ...it, unit: e.target.value as UnitOfMeasure } : it)),
                    )
                  }
                >
                  {compatibleUnits(ingredients.find((g) => g.id === item.ingredientId)?.unit ?? 'g').map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="flex h-11 w-11 flex-none items-center justify-center rounded-lg text-red-400 hover:bg-ink-700"
                  aria-label="Hapus bahan resep"
                  onClick={() => setRecipeItems((prev) => prev.filter((_, i) => i !== index))}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            ))}
            {recipeItems.length > 0 && (
              <p className="text-xs text-ink-500">Jika resep diisi, stok produk otomatis dikelola lewat stok bahan baku.</p>
            )}
          </div>
        )}

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <div className="mt-6 flex gap-3">
          <button className="btn-ghost flex-1" onClick={onClose}>
            Batal
          </button>
          <button className="btn-primary flex-[2]" onClick={() => void handleSave()}>
            Simpan
          </button>
        </div>
    </Modal>
  )
}
