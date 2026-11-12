import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { listCategories } from '@/db/repositories/categories'
import { setProductArchived, setProductAvailability } from '@/db/repositories/products'
import { buildShoppingList, findProductByCode } from '@/db/repositories/retail'
import { createPurchase, listPurchases } from '@/db/repositories/purchasing'
import { StockOpnamePanel } from '@/features/inventory/StockOpnamePanel'
import { AdjustStockModal } from '@/features/retail/AdjustStockModal'
import { ScannerModal } from '@/features/retail/ScannerModal'
import { ScanButton } from '@/features/retail/ScanButton'
import { useBarcodeScanner } from '@/features/retail/useBarcodeScanner'
import { ReceivePurchaseModal } from '@/features/retail/RetailPurchasesScreen'
import { PillTabs, RETAIL_CARD, StockStatusBadge } from '@/features/retail/retailUi'
import { compactRupiah, packBreakdown, stockStatus } from '@/features/retail/retailHelpers'
import { Icon } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import { expiryLabel, formatDateKey, NEAR_EXPIRY_DAYS, productExpiry, sortedBatches, daysUntil, expiryStateFor } from '@/lib/expiryBatches'
import { STOCK_REASON_LABELS } from '@/lib/stockReasons'
import { formatDateTime } from '@/lib/datetime'
import { formatRupiah } from '@/lib/currency'
import { roleHasPermission } from '@/lib/permissions'
import { useSessionStore } from '@/state/sessionStore'
import { toast } from '@/state/toastStore'
import type { ExpiryBatch, Product, Purchase } from '@/types/domain'

type Tab = 'daftar' | 'kedaluwarsa' | 'penerimaan' | 'opname' | 'belanja' | 'riwayat'
type Filter = 'semua' | 'menipis' | 'habis' | 'hampir' | 'sudah'

export function RetailStockScreen() {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const [tab, setTab] = useState<Tab>('daftar')
  const products = useLiveQuery(() => db.products.filter((p) => p.trackOwnStock).sortBy('name'), []) ?? []
  const now = Date.now()
  const active = products.filter((p) => !p.archived)
  const expiredCount = active.filter((p) => productExpiry(p, now).expiredQty > 0).length
  const lowCount = active.filter((p) => stockStatus(p) !== 'aman').length

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto px-5 pb-5 pt-2">
      <div className="flex-none">
        <PillTabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'daftar', label: 'Daftar Stok' },
            { id: 'kedaluwarsa', label: 'Kedaluwarsa', dot: expiredCount > 0 },
            { id: 'penerimaan', label: 'Penerimaan' },
            { id: 'opname', label: 'Stok Opname' },
            { id: 'belanja', label: 'Daftar Belanja', dot: lowCount > 0 },
            { id: 'riwayat', label: 'Riwayat Pergerakan' },
          ]}
        />
      </div>
      {tab === 'daftar' && <StockList products={products} userId={currentUser.id} canEdit={roleHasPermission(currentUser.role, 'settings.manage')} />}
      {tab === 'kedaluwarsa' && <ExpiryList products={active} userId={currentUser.id} />}
      {tab === 'penerimaan' && <ReceivingList userId={currentUser.id} userName={currentUser.name} />}
      {tab === 'opname' && (
        <div className={`${RETAIL_CARD} p-5`}>
          <StockOpnamePanel userId={currentUser.id} userName={currentUser.name} />
        </div>
      )}
      {tab === 'belanja' && <ShoppingList userId={currentUser.id} />}
      {tab === 'riwayat' && <MovementList />}
    </div>
  )
}

// ---- Daftar Stok ----

function StockList({ products, userId, canEdit }: { products: Product[]; userId: string; canEdit: boolean }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('semua')
  const [adjust, setAdjust] = useState<Product | null>(null)
  const [detail, setDetail] = useState<Product | null>(null)
  const [scanning, setScanning] = useState(false)
  const categories = useLiveQuery(() => listCategories(), [])
  const catName = useMemo(() => new Map((categories ?? []).map((c) => [c.id, c.name])), [categories])
  const now = Date.now()

  const active = products.filter((p) => !p.archived)
  const expiryOf = (p: Product) => productExpiry(p, now)
  const counts = {
    menipis: active.filter((p) => stockStatus(p) === 'menipis').length,
    habis: active.filter((p) => stockStatus(p) === 'habis').length,
    hampir: active.filter((p) => expiryOf(p).state === 'near').length,
    sudah: active.filter((p) => expiryOf(p).expiredQty > 0).length,
  }
  const stockValue = active.reduce((s, p) => s + Math.max(0, p.stockQty) * p.costPrice, 0)

  const q = search.trim().toLowerCase()
  const rows = products.filter((p) => {
    if (q && !(p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode ?? '').toLowerCase().includes(q))) return false
    if (filter === 'semua') return true
    if (p.archived) return false
    if (filter === 'menipis' || filter === 'habis') return stockStatus(p) === filter
    if (filter === 'hampir') return expiryOf(p).state === 'near'
    return expiryOf(p).expiredQty > 0
  })

  // Pemindai USB: langsung buka Sesuaikan Stok untuk barang yang dipindai.
  useBarcodeScanner((code) => void openByCode(code), { enabled: canEdit })

  async function openByCode(code: string) {
    const p = await findProductByCode(code)
    if (p?.trackOwnStock) {
      setSearch('')
      setAdjust(p)
    } else {
      setSearch(code)
      if (!p) toast.warning(`Barcode ${code} belum terdaftar`)
    }
  }

  async function toggle(p: Product, field: 'archived' | 'show', value: boolean) {
    try {
      if (field === 'archived') await setProductArchived(p.id, value)
      else await setProductAvailability(p.id, value)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan')
    }
  }

  return (
    <>
      <div className="grid flex-none grid-cols-4 gap-3">
        <Kpi label="Total SKU" value={String(active.length)} hint="Aktif dijual" />
        <Kpi label="Stok menipis" value={String(counts.menipis + counts.habis)} hint="Di bawah batas minimum" />
        <Kpi label="Hampir kedaluwarsa" value={String(counts.hampir)} hint={`Dalam ${NEAR_EXPIRY_DAYS} hari`} />
        <Kpi label="Nilai stok" value={compactRupiah(stockValue)} hint="Berdasarkan harga beli" />
      </div>

      <div className="flex flex-none flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
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
        <ScanButton className="!min-h-[3rem] !px-4 text-sm" onClick={() => setScanning(true)} />
        <PillTabs<Filter>
          value={filter}
          onChange={setFilter}
          tabs={[
            { id: 'semua', label: 'Semua' },
            { id: 'menipis', label: 'Menipis', dot: counts.menipis > 0 },
            { id: 'habis', label: 'Habis', dot: counts.habis > 0 },
            { id: 'hampir', label: 'Hampir Exp', dot: counts.hampir > 0 },
            { id: 'sudah', label: 'Sudah Exp', dot: counts.sudah > 0 },
          ]}
        />
      </div>

      <div className={`${RETAIL_CARD} flex-none overflow-hidden`}>
        <table className="w-full text-sm">
          <thead className="bg-ink-800 text-left text-ink-200">
            <tr>
              <th className="px-6 py-3.5 font-medium">Produk</th>
              <th className="px-2 py-3.5 text-center font-medium">Stok</th>
              <th className="px-2 py-3.5 text-center font-medium">Min</th>
              <th className="px-2 py-3.5 text-center font-medium">Status</th>
              <th className="px-2 py-3.5 text-center font-medium">Exp Produk</th>
              <th className="px-4 py-3.5 font-medium">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const exp = expiryOf(p)
              return (
                <tr key={p.id} className={`cursor-pointer border-t border-ink-600 hover:bg-ink-800/60 ${p.archived ? 'opacity-60' : ''}`} onClick={() => setDetail(p)}>
                  <td className="px-6 py-3">
                    <p className="text-[0.95rem] text-ink-50">{p.name}</p>
                    <p className="text-xs text-ink-300">
                      {catName.get(p.categoryId) ?? 'Tanpa kategori'}
                      {p.barcode ? ` · ${p.barcode}` : ''}
                    </p>
                  </td>
                  <td className="px-2 py-3 text-center">
                    <p className={`font-semibold ${p.stockQty < 0 ? 'text-red-500' : 'text-ink-50'}`}>
                      {p.stockQty.toLocaleString('id-ID')} {p.unit}
                    </p>
                    {packBreakdown(p.stockQty, p.packSize, p.unit) && <p className="text-xs text-ink-300">{packBreakdown(p.stockQty, p.packSize, p.unit)}</p>}
                  </td>
                  <td className="px-2 py-3 text-center text-ink-100">
                    {p.lowStockThreshold.toLocaleString('id-ID')} {p.unit}
                  </td>
                  <td className="px-2 py-3 text-center">
                    <StockStatusBadge product={p} />
                  </td>
                  <td className={`px-2 py-3 text-center ${exp.state === 'expired' ? 'font-semibold text-red-500' : exp.state === 'near' ? 'text-accent-400' : 'text-ink-100'}`}>
                    {exp.nearest ? expiryLabel(exp.nearest.expiryDate, now) : '—'}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-4">
                      <div className="space-y-1 text-xs text-ink-100">
                        <label className="flex items-center gap-2">
                          <input type="checkbox" className="h-4 w-4 accent-brand-600" disabled={!canEdit} checked={!!p.archived} onChange={(e) => void toggle(p, 'archived', e.target.checked)} />
                          Arsipkan
                        </label>
                        <label className="flex items-center gap-2" title="Tampil di kasir">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-brand-600"
                            disabled={!canEdit || !!p.archived}
                            checked={p.isAvailable && !p.archived}
                            onChange={(e) => void toggle(p, 'show', e.target.checked)}
                          />
                          Tampilkan
                        </label>
                      </div>
                      <button className="whitespace-nowrap rounded-full bg-ink-700 px-3 py-1.5 text-xs font-medium text-ink-100 hover:bg-ink-600" onClick={() => setAdjust(p)}>
                        Sesuaikan Stok
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-ink-300">
                  {products.length === 0 ? 'Belum ada produk ber-stok. Tambahkan di menu Produk.' : 'Tidak ada produk yang cocok.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="border-t border-ink-600 px-6 py-3.5 text-xs text-ink-300">
          Menampilkan {rows.length} dari {products.length} produk · klik baris untuk detail
        </p>
      </div>

      {adjust && <AdjustStockModal product={adjust} userId={userId} onClose={() => setAdjust(null)} />}
      {detail && (
        <ProductStockDetail
          productId={detail.id}
          onClose={() => setDetail(null)}
          onAdjust={(p) => {
            setDetail(null)
            setAdjust(p)
          }}
        />
      )}
      {scanning && (
        <ScannerModal
          title="Scan untuk sesuaikan stok"
          onClose={() => setScanning(false)}
          onDetected={(code) => {
            setScanning(false)
            void openByCode(code)
          }}
        />
      )}
    </>
  )
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className={`${RETAIL_CARD} px-5 py-4`}>
      <p className="text-sm text-ink-300">{label}</p>
      <p className="mt-1 text-[1.4rem] font-semibold leading-tight text-ink-100">{value}</p>
      <p className="mt-0.5 text-sm text-ink-200">{hint}</p>
    </div>
  )
}

function ProductStockDetail({ productId, onClose, onAdjust }: { productId: string; onClose: () => void; onAdjust: (p: Product) => void }) {
  const product = useLiveQuery(() => db.products.get(productId), [productId])
  const movements = useLiveQuery(() => db.stockMovements.filter((m) => m.itemType === 'product' && m.itemId === productId).reverse().sortBy('createdAt'), [productId]) ?? []
  if (!product) return null
  const now = Date.now()
  const batches = sortedBatches(product.expiryBatches)
  const batched = batches.reduce((s, b) => s + b.qty, 0)
  return (
    <Modal onClose={onClose} className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-ink-900 p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink-50">{product.name}</h2>
          <p className="text-sm text-ink-300">
            {product.sku}
            {product.barcode ? ` · ${product.barcode}` : ''} · HPP {formatRupiah(product.costPrice)}
          </p>
        </div>
        <button className="btn-primary !min-h-[2.75rem] flex-none !rounded-xl text-sm" onClick={() => onAdjust(product)}>
          Sesuaikan Stok
        </button>
      </div>
      <div className="mb-5 grid grid-cols-3 gap-3 text-sm">
        <div className="rounded-xl bg-ink-800 p-3">
          <p className="text-ink-300">Stok</p>
          <p className="font-semibold text-ink-50">
            {product.stockQty.toLocaleString('id-ID')} {product.unit}
          </p>
          {packBreakdown(product.stockQty, product.packSize, product.unit) && <p className="text-xs text-ink-300">{packBreakdown(product.stockQty, product.packSize, product.unit)}</p>}
        </div>
        <div className="rounded-xl bg-ink-800 p-3">
          <p className="text-ink-300">Batas minimum</p>
          <p className="font-semibold text-ink-50">
            {product.lowStockThreshold.toLocaleString('id-ID')} {product.unit}
          </p>
        </div>
        <div className="rounded-xl bg-ink-800 p-3">
          <p className="text-ink-300">Nilai stok</p>
          <p className="font-semibold text-ink-50">{formatRupiah(Math.max(0, product.stockQty) * product.costPrice)}</p>
        </div>
      </div>

      <h3 className="mb-2 text-sm font-semibold text-ink-100">Kedaluwarsa per penerimaan</h3>
      {batches.length === 0 ? (
        <p className="mb-5 text-sm text-ink-300">Belum ada tanggal kedaluwarsa. Isi saat Stok Masuk atau Penerimaan barang.</p>
      ) : (
        <div className="mb-5 space-y-1.5">
          {batches.map((b) => (
            <BatchRow key={b.id} batch={b} unit={product.unit} now={now} />
          ))}
          {product.stockQty - batched > 0 && (
            <p className="text-xs text-ink-300">
              + {(product.stockQty - batched).toLocaleString('id-ID')} {product.unit} tanpa tanggal kedaluwarsa
            </p>
          )}
        </div>
      )}

      <h3 className="mb-2 text-sm font-semibold text-ink-100">Pergerakan terakhir</h3>
      <div className="divide-y divide-ink-600 text-sm">
        {movements.slice(0, 30).map((m) => (
          <div key={m.id} className="flex items-center justify-between py-2">
            <div>
              <p className="text-ink-100">{STOCK_REASON_LABELS[m.reason]}</p>
              <p className="text-xs text-ink-300">
                {formatDateTime(m.createdAt)}
                {m.note ? ` · ${m.note}` : ''}
              </p>
            </div>
            <div className="text-right">
              <p className={`font-semibold ${m.qtyDelta >= 0 ? 'text-success-500' : 'text-red-500'}`}>
                {m.qtyDelta >= 0 ? '+' : ''}
                {m.qtyDelta.toLocaleString('id-ID')}
              </p>
              <p className="text-xs text-ink-300">sisa {m.resultingQty.toLocaleString('id-ID')}</p>
            </div>
          </div>
        ))}
        {movements.length === 0 && <p className="py-2 text-ink-300">Belum ada pergerakan.</p>}
      </div>
    </Modal>
  )
}

function BatchRow({ batch, unit, now }: { batch: ExpiryBatch; unit: string; now: number }) {
  const state = expiryStateFor(daysUntil(batch.expiryDate, now))
  return (
    <div className="flex items-center justify-between rounded-xl bg-ink-800 px-3 py-2 text-sm">
      <span className="text-ink-100">{formatDateKey(batch.expiryDate)}</span>
      <span className={state === 'expired' ? 'font-semibold text-red-500' : state === 'near' ? 'text-accent-400' : 'text-ink-300'}>{expiryLabel(batch.expiryDate, now)}</span>
      <span className="font-semibold text-ink-50">
        {batch.qty.toLocaleString('id-ID')} {unit}
      </span>
    </div>
  )
}

// ---- Kedaluwarsa ----

function ExpiryList({ products, userId }: { products: Product[]; userId: string }) {
  const [waste, setWaste] = useState<{ product: Product; batch: ExpiryBatch } | null>(null)
  const now = Date.now()
  const rows = products
    .flatMap((p) => sortedBatches(p.expiryBatches).map((batch) => ({ product: p, batch, days: daysUntil(batch.expiryDate, now) })))
    .sort((a, b) => a.days - b.days || a.product.name.localeCompare(b.product.name))

  return (
    <div className={`${RETAIL_CARD} overflow-hidden`}>
      <table className="w-full text-sm">
        <thead className="bg-ink-800 text-left text-ink-200">
          <tr>
            <th className="px-6 py-3.5 font-medium">Produk</th>
            <th className="px-2 py-3.5 text-center font-medium">Tanggal Exp</th>
            <th className="px-2 py-3.5 text-center font-medium">Sisa waktu</th>
            <th className="px-2 py-3.5 text-center font-medium">Jumlah</th>
            <th className="px-4 py-3.5 font-medium">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ product, batch, days }) => {
            const state = expiryStateFor(days)
            return (
              <tr key={`${product.id}-${batch.id}`} className="border-t border-ink-600">
                <td className="px-6 py-3">
                  <p className="text-ink-50">{product.name}</p>
                  <p className="text-xs text-ink-300">{product.barcode ?? product.sku}</p>
                </td>
                <td className="px-2 py-3 text-center text-ink-100">{formatDateKey(batch.expiryDate)}</td>
                <td className="px-2 py-3 text-center">
                  <span
                    className={`inline-flex rounded-full border px-3 py-0.5 text-xs font-medium ${
                      state === 'expired' ? 'border-red-500 text-red-500' : state === 'near' ? 'border-accent-500 text-accent-400' : 'border-success-600 text-success-500'
                    }`}
                  >
                    {expiryLabel(batch.expiryDate, now)}
                  </span>
                </td>
                <td className="px-2 py-3 text-center font-semibold text-ink-50">
                  {batch.qty.toLocaleString('id-ID')} {product.unit}
                </td>
                <td className="px-4 py-3">
                  <button className="rounded-full bg-ink-700 px-3 py-1.5 text-xs font-medium text-ink-100 hover:bg-ink-600" onClick={() => setWaste({ product, batch })}>
                    {state === 'expired' ? 'Buang (Waste)' : 'Keluarkan'}
                  </button>
                </td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-6 py-10 text-center text-ink-300">
                Belum ada stok bertanggal kedaluwarsa. Isi tanggal saat Stok Masuk atau Penerimaan barang.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {waste && (
        <AdjustStockModal
          product={waste.product}
          userId={userId}
          initialMode="waste"
          batchId={waste.batch.id}
          initialQty={waste.batch.qty}
          onClose={() => setWaste(null)}
        />
      )}
    </div>
  )
}

// ---- Penerimaan ----

function ReceivingList({ userId, userName }: { userId: string; userName: string }) {
  const navigate = useNavigate()
  const purchases = useLiveQuery(() => listPurchases(200), []) ?? []
  const [receiving, setReceiving] = useState<Purchase | null>(null)
  const drafts = purchases.filter((p) => p.status === 'draft')
  const received = purchases.filter((p) => p.status === 'received').slice(0, 20)

  return (
    <div className="space-y-3">
      <div className={`${RETAIL_CARD} p-5`}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-ink-100">Menunggu diterima</h3>
          <button className="text-sm font-medium text-brand-400 hover:text-brand-700" onClick={() => navigate('/pembelian')}>
            + Buat pembelian
          </button>
        </div>
        {drafts.length === 0 && <p className="text-sm text-ink-300">Tidak ada pembelian yang menunggu. Barang tanpa pesanan bisa dicatat lewat "Sesuaikan Stok → Stok Masuk".</p>}
        <div className="divide-y divide-ink-600">
          {drafts.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-ink-50">{p.supplierName || 'Tanpa pemasok'}</p>
                <p className="text-xs text-ink-300">
                  {p.invoiceNo ? `${p.invoiceNo} · ` : ''}
                  {formatDateTime(p.createdAt)} · {p.lines.length} produk · {formatRupiah(p.totalCost)}
                </p>
              </div>
              <button className="btn-primary !min-h-[2.75rem] flex-none !rounded-xl text-sm" onClick={() => setReceiving(p)}>
                Terima Barang
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className={`${RETAIL_CARD} p-5`}>
        <h3 className="mb-2 font-semibold text-ink-100">Riwayat penerimaan</h3>
        {received.length === 0 && <p className="text-sm text-ink-300">Belum ada penerimaan.</p>}
        <div className="divide-y divide-ink-600 text-sm">
          {received.map((p) => (
            <div key={p.id} className="flex items-center justify-between py-2.5">
              <div className="min-w-0">
                <p className="truncate text-ink-100">{p.supplierName || 'Tanpa pemasok'}</p>
                <p className="text-xs text-ink-300">
                  Diterima {p.receivedAt ? formatDateTime(p.receivedAt) : '-'} · {p.lines.length} produk
                  {p.lines.some((l) => l.expiryDate) ? ' · dengan tanggal exp' : ''}
                </p>
              </div>
              <span className="font-semibold text-ink-50">{formatRupiah(p.totalCost)}</span>
            </div>
          ))}
        </div>
      </div>
      {receiving && <ReceivePurchaseModal purchase={receiving} userId={userId} userName={userName} onClose={() => setReceiving(null)} />}
    </div>
  )
}

// ---- Daftar Belanja ----

function ShoppingList({ userId }: { userId: string }) {
  const navigate = useNavigate()
  const rows = useLiveQuery(() => buildShoppingList(), []) ?? []
  const [qty, setQty] = useState<Record<string, number>>({})
  const [skip, setSkip] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const chosen = rows.filter((r) => !skip[r.product.id])

  async function createDraft() {
    const lines = chosen
      .map((r) => ({ r, q: qty[r.product.id] ?? r.suggestedQty }))
      .filter(({ q }) => q > 0)
      .map(({ r, q }) => ({ itemType: 'product' as const, itemId: r.product.id, itemName: r.product.name, qty: q, unit: r.product.unit, unitCost: r.product.costPrice }))
    if (lines.length === 0) return
    setSaving(true)
    try {
      await createPurchase({ supplierName: '', invoiceNo: '', note: 'Dari Daftar Belanja', createdBy: userId, lines })
      toast.success(`Draf pembelian ${lines.length} produk dibuat.`)
      navigate('/pembelian')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal membuat draf pembelian')
    } finally {
      setSaving(false)
    }
  }

  const estimate = chosen.reduce((s, r) => s + (qty[r.product.id] ?? r.suggestedQty) * r.product.costPrice, 0)

  return (
    <div className={`${RETAIL_CARD} overflow-hidden`}>
      <div className="flex items-center justify-between gap-3 px-6 py-4">
        <div>
          <h3 className="font-semibold text-ink-100">Perlu dibeli</h3>
          <p className="text-sm text-ink-300">Produk habis atau di bawah batas minimum. Saran jumlah menaikkan stok ke 2× minimum (dibulatkan per dus).</p>
        </div>
        <button className="btn-primary !min-h-[2.75rem] flex-none !rounded-xl text-sm" disabled={saving || chosen.length === 0} onClick={() => void createDraft()}>
          Buat Draf Pembelian ({chosen.length}) · {formatRupiah(estimate)}
        </button>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-ink-800 text-left text-ink-200">
          <tr>
            <th className="w-10 px-4 py-3" />
            <th className="px-2 py-3 font-medium">Produk</th>
            <th className="px-2 py-3 text-center font-medium">Stok</th>
            <th className="px-2 py-3 text-center font-medium">Min</th>
            <th className="px-2 py-3 text-center font-medium">Beli</th>
            <th className="px-4 py-3 text-right font-medium">Estimasi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ product: p, suggestedQty }) => {
            const q = qty[p.id] ?? suggestedQty
            return (
              <tr key={p.id} className={`border-t border-ink-600 ${skip[p.id] ? 'opacity-50' : ''}`}>
                <td className="px-4 py-2.5">
                  <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!skip[p.id]} onChange={(e) => setSkip((s) => ({ ...s, [p.id]: !e.target.checked }))} aria-label={`Pilih ${p.name}`} />
                </td>
                <td className="px-2 py-2.5">
                  <p className="text-ink-50">{p.name}</p>
                  <p className="text-xs text-ink-300">HPP {formatRupiah(p.costPrice)}</p>
                </td>
                <td className="px-2 py-2.5 text-center">
                  <StockStatusBadge product={p} /> <span className="ml-1 text-ink-100">{p.stockQty.toLocaleString('id-ID')}</span>
                </td>
                <td className="px-2 py-2.5 text-center text-ink-100">{p.lowStockThreshold.toLocaleString('id-ID')}</td>
                <td className="px-2 py-2.5 text-center">
                  <input
                    className="w-20 rounded-lg border border-ink-600 px-2 py-1.5 text-center text-ink-50"
                    inputMode="numeric"
                    value={q}
                    onChange={(e) => setQty((s) => ({ ...s, [p.id]: Number(e.target.value.replace(/\D/g, '')) || 0 }))}
                    aria-label={`Jumlah beli ${p.name}`}
                  />
                  {p.packSize && p.packSize > 1 ? <p className="mt-0.5 text-[11px] text-ink-300">{packBreakdown(q, p.packSize, p.unit)}</p> : null}
                </td>
                <td className="px-4 py-2.5 text-right text-ink-100">{formatRupiah(q * p.costPrice)}</td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-6 py-10 text-center text-ink-300">
                Semua stok aman.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ---- Riwayat Pergerakan ----

function MovementList() {
  const [search, setSearch] = useState('')
  const movements = useLiveQuery(() => db.stockMovements.orderBy('createdAt').reverse().filter((m) => m.itemType === 'product').limit(500).toArray(), []) ?? []
  const q = search.trim().toLowerCase()
  const rows = q ? movements.filter((m) => m.itemName.toLowerCase().includes(q) || m.note.toLowerCase().includes(q)) : movements
  return (
    <div className={`${RETAIL_CARD} overflow-hidden`}>
      <div className="px-6 py-4">
        <div className="relative max-w-md">
          <Icon name="search" size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-300" />
          <input className="input-field !rounded-xl !pl-11" placeholder="Cari produk atau catatan..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-ink-800 text-left text-ink-200">
          <tr>
            <th className="px-6 py-3 font-medium">Waktu</th>
            <th className="px-2 py-3 font-medium">Produk</th>
            <th className="px-2 py-3 font-medium">Jenis</th>
            <th className="px-2 py-3 text-right font-medium">Perubahan</th>
            <th className="px-6 py-3 text-right font-medium">Sisa</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id} className="border-t border-ink-600">
              <td className="px-6 py-2.5 text-ink-200">{formatDateTime(m.createdAt)}</td>
              <td className="px-2 py-2.5">
                <p className="text-ink-50">{m.itemName}</p>
                {m.note && <p className="text-xs text-ink-300">{m.note}</p>}
              </td>
              <td className="px-2 py-2.5 text-ink-100">{STOCK_REASON_LABELS[m.reason]}</td>
              <td className={`px-2 py-2.5 text-right font-semibold ${m.qtyDelta >= 0 ? 'text-success-500' : 'text-red-500'}`}>
                {m.qtyDelta >= 0 ? '+' : ''}
                {m.qtyDelta.toLocaleString('id-ID')}
              </td>
              <td className="px-6 py-2.5 text-right text-ink-100">{m.resultingQty.toLocaleString('id-ID')}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-6 py-10 text-center text-ink-300">
                Belum ada pergerakan stok.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
