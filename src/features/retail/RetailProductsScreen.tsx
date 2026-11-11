import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listCategories } from '@/db/repositories/categories'
import { deleteProductIfUnused, listArchivedProducts, searchProducts, setProductArchived } from '@/db/repositories/products'
import { findProductByCode } from '@/db/repositories/retail'
import { ProductFormModal } from '@/features/products/ProductFormModal'
import { CategoryManager } from '@/features/products/CategoryManager'
import { ProductsScreen } from '@/features/products/ProductsScreen'
import { BarcodeScanModal } from '@/features/retail/BarcodeScanModal'
import { PriceLabelModal } from '@/features/retail/PriceLabelModal'
import { useBarcodeScanner } from '@/features/retail/useBarcodeScanner'
import { PillTabs, RETAIL_CARD } from '@/features/retail/retailUi'
import { initialsOf } from '@/features/retail/retailHelpers'
import { Icon } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import { useConfirmDialog } from '@/components/ui/useConfirmDialog'
import { expiryLabel, productExpiry } from '@/lib/expiryBatches'
import { formatRupiah } from '@/lib/currency'
import { toast } from '@/state/toastStore'
import type { Product } from '@/types/domain'

const ARCHIVE = '__arsip'

export function RetailProductsScreen() {
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('all')
  const [editing, setEditing] = useState<Product | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showCategories, setShowCategories] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [classic, setClassic] = useState(false)
  const [showLabels, setShowLabels] = useState(false)
  /** Barcode hasil scan yang belum terdaftar → diisikan ke form produk baru. */
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null)
  const { confirm, dialog: confirmDialog } = useConfirmDialog()

  const categoryRows = useLiveQuery(() => listCategories(), [])
  const categories = useMemo(() => categoryRows ?? [], [categoryRows])
  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories])
  const archived = categoryId === ARCHIVE
  const products =
    useLiveQuery(
      async () => {
        if (!archived) return searchProducts(search, categoryId)
        const q = search.trim().toLowerCase()
        return (await listArchivedProducts()).filter((p) => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode ?? '').includes(q))
      },
      [search, categoryId, archived],
    ) ?? []
  const total = useLiveQuery(() => searchProducts('', 'all').then((r) => r.length), []) ?? 0
  const now = Date.now()

  // Pemindai USB: buka produk (atau buat baru) walau fokus tak di kolom cari.
  useBarcodeScanner((code) => void openByCode(code), { enabled: !classic })

  if (classic) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex-none px-5 pt-1">
          <button className="btn-ghost !min-h-[2.5rem] text-sm" onClick={() => setClassic(false)}>
            <Icon name="arrowLeft" size={16} /> Kembali ke daftar produk
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <ProductsScreen />
        </div>
      </div>
    )
  }

  async function openByCode(code: string) {
    const p = await findProductByCode(code)
    if (p) {
      setSearch('')
      setEditing(p)
    } else {
      setSearch(code)
      const ok = await confirm({ title: 'Barcode belum terdaftar', description: `Buat produk baru dengan barcode ${code}?`, confirmLabel: 'Buat Produk' })
      if (ok) {
        setScannedBarcode(code)
        setShowForm(true)
      }
    }
  }

  async function handleDelete(p: Product) {
    const ok = await confirm({ title: `Hapus ${p.name}?`, description: 'Produk yang belum pernah terjual dihapus permanen.', confirmLabel: 'Hapus', tone: 'danger' })
    if (!ok) return
    try {
      await deleteProductIfUnused(p.id)
      toast.success(`${p.name} dihapus`)
    } catch (e) {
      const archive = await confirm({
        title: 'Produk sudah pernah terjual',
        description: `${e instanceof Error ? e.message : ''} Arsipkan ${p.name}? Produk hilang dari kasir, riwayat & laporan tetap utuh.`,
        confirmLabel: 'Arsipkan',
      })
      if (archive) {
        await setProductArchived(p.id, true)
        toast.success(`${p.name} diarsipkan`)
      }
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto px-5 pb-5 pt-2">
      <div className="flex flex-none items-center gap-2">
        <div className="relative flex-1">
          <Icon name="search" size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-300" />
          <input
            className="input-field !rounded-xl !pl-11"
            placeholder="Cari produk atau scan barcode..."
            data-scan-input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && search.trim()) void openByCode(search.trim())
            }}
          />
        </div>
        <button className="btn-primary !min-h-[3rem] flex-none !rounded-xl !px-4 text-sm" onClick={() => setScanning(true)}>
          <Icon name="barcode" size={16} /> Scan
        </button>
        <button className="btn-secondary !min-h-[3rem] flex-none !rounded-xl !px-4 text-sm" onClick={() => setShowLabels(true)}>
          <Icon name="printer" size={16} /> Label harga
        </button>
        <button
          className="btn-primary !min-h-[3rem] flex-none !rounded-xl !px-4 text-sm"
          onClick={() => {
            setScannedBarcode(null)
            setShowForm(true)
          }}
        >
          + Produk baru
        </button>
      </div>

      <div className="flex flex-none flex-wrap items-center gap-2">
        <PillTabs<string>
          value={categoryId}
          onChange={setCategoryId}
          tabs={[{ id: 'all', label: 'Semua' }, ...categories.map((c) => ({ id: c.id, label: c.name })), { id: ARCHIVE, label: 'Arsip' }]}
        />
        <button className="text-sm font-medium text-brand-400 hover:text-brand-700" onClick={() => setShowCategories(true)}>
          Kelola kategori
        </button>
        <button className="ml-auto text-sm font-medium text-ink-300 hover:text-ink-100" onClick={() => setClassic(true)}>
          Impor / ekspor CSV
        </button>
      </div>

      <div className={`${RETAIL_CARD} flex-none overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className="bg-ink-800 text-left text-ink-200">
            <tr>
              <th className="px-6 py-3.5 font-medium">Produk</th>
              <th className="px-2 py-3.5 text-center font-medium">SKU</th>
              <th className="px-2 py-3.5 text-center font-medium">HPP</th>
              <th className="px-2 py-3.5 text-center font-medium">Harga Jual</th>
              <th className="px-2 py-3.5 text-center font-medium">Status</th>
              <th className="px-2 py-3.5 text-center font-medium">Exp Produk</th>
              <th className="px-6 py-3.5" />
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const exp = productExpiry(p, now)
              return (
                <tr key={p.id} className="cursor-pointer border-t border-ink-600 hover:bg-ink-800/60" onClick={() => setEditing(p)}>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                      {p.photoDataUrl ? (
                        <img src={p.photoDataUrl} alt="" className="h-10 w-10 flex-none rounded-lg border border-ink-600 object-contain" />
                      ) : (
                        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg border border-ink-600 bg-ink-800 text-xs text-ink-300">{initialsOf(p.name)}</span>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-[0.95rem] text-ink-50">{p.name}</p>
                        <p className="truncate text-xs text-ink-300">{catName.get(p.categoryId) ?? 'Tanpa kategori'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-3 text-center text-ink-200">{p.sku}</td>
                  <td className="px-2 py-3 text-center font-semibold text-ink-50">{formatRupiah(p.costPrice)}</td>
                  <td className="px-2 py-3 text-center font-semibold text-ink-50">{formatRupiah(p.price)}</td>
                  <td className="px-2 py-3 text-center">
                    <span
                      className={`inline-flex rounded-full border px-3 py-0.5 text-xs font-medium ${
                        p.archived ? 'border-ink-500 text-ink-300' : p.isAvailable ? 'border-ink-500 bg-ink-800 text-ink-100' : 'border-ink-100 text-ink-100'
                      }`}
                    >
                      {p.archived ? 'Arsip' : p.isAvailable ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </td>
                  <td className={`px-2 py-3 text-center ${exp.state === 'expired' ? 'font-semibold text-red-500' : exp.state === 'near' ? 'text-accent-400' : 'text-ink-100'}`}>
                    {exp.nearest ? expiryLabel(exp.nearest.expiryDate, now) : '—'}
                  </td>
                  <td className="px-6 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-2">
                      <button className="flex items-center gap-1 rounded-lg border border-ink-400 px-2.5 py-1 text-xs text-ink-100 hover:bg-ink-800" onClick={() => setEditing(p)}>
                        <Icon name="edit" size={12} /> Edit
                      </button>
                      {p.archived ? (
                        <button className="rounded-lg border border-ink-400 px-2.5 py-1 text-xs text-ink-100 hover:bg-ink-800" onClick={() => void setProductArchived(p.id, false)}>
                          Pulihkan
                        </button>
                      ) : (
                        <button className="flex items-center gap-1 rounded-lg bg-red-500 px-2.5 py-1 text-xs text-white hover:bg-red-600" onClick={() => void handleDelete(p)}>
                          <Icon name="trash" size={12} /> Hapus
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {products.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-ink-300">
                  {archived ? 'Tidak ada produk diarsipkan.' : 'Produk tidak ditemukan.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="border-t border-ink-600 px-6 py-3.5 text-xs text-ink-300">
          Menampilkan {products.length} dari {total} produk · klik baris untuk detail
        </p>
      </div>

      {(showForm || editing) && (
        <ProductFormModal
          initial={editing}
          initialBarcode={editing ? undefined : (scannedBarcode ?? undefined)}
          onClose={() => {
            setShowForm(false)
            setEditing(null)
            setScannedBarcode(null)
          }}
        />
      )}
      {showCategories && (
        <Modal onClose={() => setShowCategories(false)} className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-ink-900 p-6">
          <CategoryManager />
        </Modal>
      )}
      {scanning && (
        <BarcodeScanModal
          onClose={() => setScanning(false)}
          onDetected={(code) => {
            setScanning(false)
            void openByCode(code)
          }}
        />
      )}
      {showLabels && <PriceLabelModal onClose={() => setShowLabels(false)} />}
      {confirmDialog}
    </div>
  )
}
