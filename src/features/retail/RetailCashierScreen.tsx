import { useEffect, useMemo, useRef, useState } from 'react'
import { useScreenState, useScrollMemory } from '@/lib/screenMemory'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { listCategories } from '@/db/repositories/categories'
import { searchProducts } from '@/db/repositories/products'
import { getOpenShift } from '@/db/repositories/shifts'
import { getSettings } from '@/db/repositories/settings'
import { addOrderItem, cancelEmptyOrder, getOrder, listOrderItems, removeOrderItem, setOrderDiscount, startOrder } from '@/db/repositories/orders'
import { canFulfillProductQty } from '@/db/repositories/stock'
import { listHeldOrders, resolveScanCode, setHeldLabel, setRetailItemQty, stackableLine } from '@/db/repositories/retail'
import { warmUpStationPrinters } from '@/db/repositories/printQueue'
import { featuresForBusinessType } from '@/lib/businessType'
import { formatRupiah } from '@/lib/currency'
import { formatTime } from '@/lib/datetime'
import { roleHasPermission } from '@/lib/permissions'
import { discountLinesOf } from '@/lib/promos'
import { parseQtyMultiplier, sellUnitLabel, tierUnitPrice, validSellUnits } from '@/lib/retailPricing'
import { publishCustomerDisplay } from '@/lib/customerDisplay'
import { usePosStore } from '@/state/posStore'
import { useSessionStore } from '@/state/sessionStore'
import { toast } from '@/state/toastStore'
import { Icon } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import { useConfirmDialog } from '@/components/ui/useConfirmDialog'
import { DiscountModal } from '@/features/pos/DiscountModal'
import { OrderPerks } from '@/features/pos/OrderPerks'
import { ScannerModal } from '@/features/retail/ScannerModal'
import { ScanButton } from '@/features/retail/ScanButton'
import { useBarcodeScanner } from '@/features/retail/useBarcodeScanner'
import { ProductThumb } from '@/features/retail/retailUi'
import { stockTone } from '@/features/retail/retailHelpers'
import { ProductGridSkeleton } from '@/components/ui/Skeleton'
import { Button } from '@/components/ui/Button'
import type { DiscountType, OrderItem, Product, SellUnit } from '@/types/domain'

/** Shortcut keyboard kasir ritel (ditampilkan di bawah kolom cari). */
const SHORTCUTS: Array<[string, string]> = [
  ['F2', 'Cari'],
  ['F4', 'Tahan'],
  ['F6', 'Ditahan'],
  ['F7', 'Diskon'],
  ['F9', 'Bayar'],
  ['Esc', 'Hapus cari'],
]

function qtyLabel(qty: number): string {
  return qty.toLocaleString('id-ID', { maximumFractionDigits: 3 })
}

/**
 * Kasir Minimarket: kartu produk + keranjang. Tap/pindai produk langsung membuka
 * transaksi (kasir cepat), produk yang sama menambah qty baris yang ada. Kolom cari
 * menerima pengali (`12*` lalu pindai), barcode pak/dus, dan barcode timbangan.
 */
export function RetailCashierScreen() {
  const navigate = useNavigate()
  const currentUser = useSessionStore((s) => s.currentUser)!
  const activeOrderId = usePosStore((s) => s.activeOrderId)
  const setActiveOrderId = usePosStore((s) => s.setActiveOrderId)
  const pendingScan = usePosStore((s) => s.pendingScan)
  const setPendingScan = usePosStore((s) => s.setPendingScan)
  const { confirm, dialog: confirmDialog } = useConfirmDialog()

  // Bertahan saat pindah modul lalu kembali (lihat screenMemory).
  const [search, setSearch] = useScreenState('ritel.search', '')
  const [categoryId, setCategoryId] = useScreenState('ritel.category', 'all')
  const [scanning, setScanning] = useState(false)
  const [showDiscount, setShowDiscount] = useState(false)
  const [showHeld, setShowHeld] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const openShift = useLiveQuery(() => getOpenShift(), [])
  const settings = useLiveQuery(() => getSettings(), [])
  const categories = useLiveQuery(() => listCategories(), []) ?? []
  // Teks pengali ("12*") bukan kata kunci — yang dicari hanya bagian setelahnya.
  const keyword = parseQtyMultiplier(search).code
  // "Tampilkan" dimatikan di Stok = disembunyikan dari kasir. Yang habis tetap tampil (redup).
  const loadedProducts =
    useLiveQuery(
      async () => (await searchProducts(keyword, categoryId))
          .filter((p) => p.isAvailable || (p.trackOwnStock && p.stockQty <= 0))
          .sort((a, b) => a.name.localeCompare(b.name, 'id')),
      [keyword, categoryId],
    )
  const products = loadedProducts ?? []
  const productScrollRef = useScrollMemory('ritel.products', loadedProducts !== undefined)
  const order = useLiveQuery(() => (activeOrderId ? getOrder(activeOrderId) : undefined), [activeOrderId])
  const items = useLiveQuery(() => (activeOrderId ? listOrderItems(activeOrderId) : []), [activeOrderId])
  const heldOrders = useLiveQuery(() => (openShift ? listHeldOrders(openShift.id, activeOrderId) : []), [openShift?.id, activeOrderId]) ?? []
  const activeItems = useMemo(() => (items ?? []).filter((i) => !i.voided && !i.removed), [items])
  const itemCount = activeItems.reduce((s, i) => s + (Number.isInteger(i.qty) ? i.qty : 1), 0)
  const features = featuresForBusinessType(settings?.businessType ?? 'minimarket')

  // Pesanan yang sudah lunas/batal tak pernah tinggal di keranjang.
  useEffect(() => {
    if (activeOrderId && order && order.status !== 'open') setActiveOrderId(null)
  }, [activeOrderId, order, setActiveOrderId])
  useEffect(() => {
    publishCustomerDisplay({ orderId: activeOrderId, stage: 'order' })
  }, [activeOrderId])
  useEffect(() => {
    void warmUpStationPrinters(['cashier']).catch(() => {})
  }, [])

  // Cegah tap/pindai beruntun membuka dua transaksi sekaligus.
  const startingRef = useRef<Promise<string> | null>(null)

  const hasItems = activeItems.length > 0 && !!order
  const total = hasItems ? order!.grandTotal : 0
  const canDiscount = roleHasPermission(currentUser.role, 'discount.apply')

  // Shortcut keyboard — handler terbaru lewat ref supaya listener cukup dipasang sekali.
  const shortcutRef = useRef<(e: KeyboardEvent) => void>(() => {})
  shortcutRef.current = (e: KeyboardEvent) => {
    if (scanning || showDiscount || showHeld) return
    switch (e.key) {
      case 'F2':
        searchRef.current?.focus()
        searchRef.current?.select()
        break
      case 'F4':
        if (hasItems) void holdCurrent()
        break
      case 'F6':
        if (heldOrders.length) setShowHeld(true)
        break
      case 'F7':
        if (hasItems && canDiscount) setShowDiscount(true)
        break
      case 'F9':
        if (hasItems) navigate(`/kasir/${order!.id}/bayar`)
        break
      case 'Escape':
        if (document.activeElement === searchRef.current) setSearch('')
        return
      default:
        return
    }
    e.preventDefault()
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => shortcutRef.current(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Pemindai USB (mode keyboard): kode masuk walau fokus tak di kolom cari. Pengali yang
  // sedang diketik di kolom cari ("12*") tetap berlaku untuk pindaian berikutnya.
  const scanRef = useRef<(code: string) => void>(() => {})
  scanRef.current = (code: string) => {
    const pending = /^\s*\d+(?:[.,]\d+)?\s*[*xX×]\s*$/.test(search) ? search.trim() : ''
    void handleCode(pending + code)
  }
  useBarcodeScanner((code) => scanRef.current(code), { enabled: !!openShift })
  // Pindaian dari layar sukses bayar (pelanggan berikutnya) diproses di sini.
  useEffect(() => {
    if (!pendingScan || !openShift) return
    setPendingScan(null)
    scanRef.current(pendingScan)
  }, [pendingScan, openShift, setPendingScan])

  if (!openShift) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <Icon name="cashDrawer" size={48} className="text-ink-400" />
        <h2 className="text-xl font-bold text-ink-50">Belum Ada Shift Aktif</h2>
        <p className="max-w-sm text-ink-400">Buka shift terlebih dahulu sebelum mulai mencatat transaksi.</p>
        <Button onClick={() => navigate('/shift')}>Buka Shift</Button>
      </div>
    )
  }

  async function ensureOrder(): Promise<string> {
    // `order` masih dimuat (undefined) = transaksi baru saja dibuat — pakai yang ada.
    if (activeOrderId && (order === undefined || order.status === 'open')) return activeOrderId
    if (!startingRef.current) {
      startingRef.current = startOrder({
        type: features.orderTypes[0] ?? 'takeaway',
        cashierId: currentUser.id,
        cashierName: currentUser.name,
        shiftId: openShift!.id,
      })
        .then((o) => {
          setActiveOrderId(o.id)
          return o.id
        })
        .finally(() => {
          startingRef.current = null
        })
    }
    return startingRef.current
  }

  /** Menambah `qty` satuan (dasar, atau `sellUnit`) ke keranjang. Barang timbang selalu baris baru. */
  async function addProduct(product: Product, qty = 1, sellUnit?: SellUnit, weighed = false) {
    if (!product.isAvailable) {
      toast.error(`${product.name} sedang habis / tidak ditampilkan`)
      return
    }
    const existing = weighed ? undefined : stackableLine(activeItems, product.id, sellUnit?.id ?? null)
    const nextQty = (existing?.qty ?? 0) + qty
    if (!(await canFulfillProductQty(product, nextQty * (sellUnit?.qty ?? 1)))) {
      toast.error(`Stok ${product.name} tidak mencukupi`)
      return
    }
    try {
      if (existing) {
        await setRetailItemQty(existing.id, nextQty)
        return
      }
      const orderId = await ensureOrder()
      const unitPrice = sellUnit ? sellUnit.price : tierUnitPrice(product, qty)
      await addOrderItem({
        orderId,
        productId: product.id,
        productName: sellUnit ? `${product.name} · ${sellUnitLabel(sellUnit)}` : product.name,
        unitPrice,
        qty,
        modifiers: [],
        notes: '',
        ...(sellUnit ? { sellUnit: { id: sellUnit.id, name: sellUnit.name, qty: sellUnit.qty } } : {}),
        tierApplied: !sellUnit && unitPrice !== product.price,
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menambah produk')
    }
  }

  async function handleCode(text: string) {
    const { qty, code } = parseQtyMultiplier(text)
    if (!code) return
    const match = await resolveScanCode(code)
    if (match) {
      // Pengali tak berlaku untuk barang timbang — beratnya sudah di barcode.
      await addProduct(match.product, match.weighed ? match.qty : qty * match.qty, match.sellUnit, match.weighed)
      setSearch('')
    } else {
      setSearch(text.trim())
      toast.error(`Barcode ${code} belum terdaftar`)
    }
  }

  /** Tap kartu produk: pakai pengali di kolom cari bila ada ("12*"). */
  async function tapProduct(product: Product, sellUnit?: SellUnit) {
    const { qty } = parseQtyMultiplier(search)
    await addProduct(product, qty, sellUnit)
    if (/[*xX×]/.test(search)) setSearch('')
  }

  async function changeQty(item: OrderItem, delta: number) {
    const next = item.qty + delta
    try {
      if (next <= 0 || !Number.isInteger(item.qty)) {
        await removeOrderItem(item.id)
        return
      }
      if (delta > 0) {
        const product = await db.products.get(item.productId)
        if (product && !(await canFulfillProductQty(product, next * (item.sellUnit?.qty ?? 1)))) {
          toast.error(`Stok ${item.productName} tidak mencukupi`)
          return
        }
      }
      await setRetailItemQty(item.id, next)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mengubah jumlah')
    }
  }

  async function clearCart() {
    if (!order) return
    const ok = await confirm({
      title: 'Kosongkan keranjang?',
      description: 'Semua produk di transaksi ini dihapus dan transaksi dibatalkan.',
      confirmLabel: 'Ya, Kosongkan',
      tone: 'danger',
    })
    if (!ok) return
    try {
      for (const item of activeItems) await removeOrderItem(item.id)
      await cancelEmptyOrder(order.id, { userId: currentUser.id, userName: currentUser.name }, { reason: 'Keranjang dikosongkan kasir' })
      setActiveOrderId(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mengosongkan keranjang')
    }
  }

  /** Tahan: transaksi tetap terbuka (stok belum dipotong), keranjang dikosongkan untuk pelanggan berikutnya. */
  async function holdCurrent() {
    if (!order) return
    setActiveOrderId(null)
    toast.success(`Transaksi ${formatRupiah(order.grandTotal)} ditahan — buka lagi lewat "Ditahan" (F6)`)
    searchRef.current?.focus()
  }

  function resumeHeld(orderId: string) {
    // Keranjang yang sedang berisi ikut ditahan, bukan hilang.
    setActiveOrderId(orderId)
    setShowHeld(false)
    searchRef.current?.focus()
  }

  async function handleDiscount(type: DiscountType | null, value: number) {
    setShowDiscount(false)
    if (!order) return
    try {
      await setOrderDiscount(order.id, type, value)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan diskon')
    }
  }

  return (
    <div className="flex h-full gap-3 px-5 pb-5 pt-2">
      {/* Katalog */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-none items-center gap-2">
          <div className="relative flex-1">
            <Icon name="search" size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-300" />
            <input
              ref={searchRef}
              className="input-field !rounded-xl !pl-11"
              placeholder="Cari produk / scan barcode (12* = 12 pcs)"
              aria-label="Cari produk atau scan barcode"
              data-scan-input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCode(search)
              }}
            />
          </div>
          <ScanButton className="!px-5" onClick={() => setScanning(true)} />
        </div>
        <div className="mt-1.5 hidden flex-none gap-3 text-[0.7rem] text-ink-300 lg:flex" aria-label="Shortcut keyboard">
          {SHORTCUTS.map(([key, label]) => (
            <span key={key}>
              <kbd className="rounded border border-ink-500 bg-ink-900 px-1 font-mono text-ink-200">{key}</kbd> {label}
            </span>
          ))}
        </div>

        <div className="flex flex-none gap-2 overflow-x-auto py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {[{ id: 'all', name: 'Semua' }, ...categories].map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoryId(c.id)}
              aria-pressed={categoryId === c.id}
              className={`min-h-[2.5rem] flex-none whitespace-nowrap rounded-xl border px-4 text-sm font-semibold transition-colors ${
                categoryId === c.id ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-400 bg-ink-900 text-ink-100 hover:bg-ink-800'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div ref={productScrollRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="grid grid-cols-3 gap-2.5 xl:grid-cols-4">
            {products.map((p) => {
              const tone = stockTone(p)
              const units = validSellUnits(p.sellUnits)
              return (
                <div key={p.id} className={`flex flex-col rounded-2xl border border-ink-600 bg-ink-900 p-3.5 ${p.isAvailable ? '' : 'opacity-55'}`}>
                  <button className="flex flex-col text-left" onClick={() => void tapProduct(p)} aria-label={`Tambah ${p.name}`}>
                    <ProductThumb product={p} className="mb-3 aspect-[5/4] w-full rounded-xl border border-ink-600" />
                    <span className="line-clamp-2 min-h-[2.5rem] text-[0.92rem] leading-tight text-ink-100">{p.name}</span>
                  </button>
                  <div className="mt-2 flex items-end justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[1rem] font-bold text-brand-400">{formatRupiah(p.price)}</p>
                      {p.trackOwnStock && <p className={`text-xs ${tone.text}`}>{p.stockQty <= 0 ? 'Stok habis' : `Stok ${qtyLabel(p.stockQty)}`}</p>}
                    </div>
                    <button
                      className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-brand-700 text-white hover:bg-brand-600 disabled:opacity-40"
                      aria-label={`Tambah ${p.name} ke keranjang`}
                      disabled={!p.isAvailable}
                      onClick={() => void tapProduct(p)}
                    >
                      <Icon name="plus" size={16} />
                    </button>
                  </div>
                  {units.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {units.map((u) => (
                        <button
                          key={u.id}
                          disabled={!p.isAvailable}
                          className="rounded-lg border border-brand-600/50 px-2 py-1 text-[0.7rem] font-semibold text-brand-400 hover:bg-brand-600/10 disabled:opacity-40"
                          aria-label={`Tambah ${p.name} per ${u.name}`}
                          onClick={() => void tapProduct(p, u)}
                        >
                          + {sellUnitLabel(u)} {formatRupiah(u.price)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            {loadedProducts === undefined && <ProductGridSkeleton variant="retail" count={8} />}
            {loadedProducts?.length === 0 && <p className="col-span-full py-10 text-center text-ink-300">Produk tidak ditemukan</p>}
          </div>
        </div>
      </div>

      {/* Keranjang */}
      <div className="flex w-[22rem] flex-none flex-col rounded-2xl border border-ink-600 bg-ink-900 lg:w-[26rem] xl:w-[29rem]">
        <div className="flex flex-none items-center justify-between px-5 pb-2 pt-5">
          <h2 className="text-lg font-semibold text-ink-100">Keranjang</h2>
          <div className="flex items-center gap-3 text-sm text-ink-200">
            {heldOrders.length > 0 && (
              <button className="rounded-full bg-accent-500/15 px-2.5 py-1 text-xs font-semibold text-accent-500" onClick={() => setShowHeld(true)}>
                Ditahan ({heldOrders.length})
              </button>
            )}
            {hasItems && (
              <button className="font-medium text-ink-200 hover:text-ink-50" onClick={() => void holdCurrent()}>
                Tahan
              </button>
            )}
            {hasItems && (
              <button className="font-medium text-red-400 hover:text-red-300" onClick={() => void clearCart()}>
                Kosongkan
              </button>
            )}
            <span>{itemCount} item</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          {!hasItems ? (
            <div className="flex h-full items-center justify-center text-center text-sm text-ink-300">Belum ada produk yang ditambahkan</div>
          ) : (
            activeItems.map((item) => {
              const weighed = !Number.isInteger(item.qty)
              return (
                <div key={item.id} className="border-b border-ink-600 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 text-[0.95rem] text-ink-100">{item.productName}</p>
                    <span className="flex-none font-semibold text-ink-100">{formatRupiah(item.lineTotal)}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-300">
                    {weighed ? `${qtyLabel(item.qty)} × ` : ''}
                    {formatRupiah(item.unitPrice)} / {item.sellUnit?.name.toLowerCase() ?? 'pcs'}
                    {item.tierApplied && <span className="ml-1.5 rounded bg-success-600/15 px-1.5 py-0.5 font-semibold text-success-500">Harga grosir</span>}
                  </p>
                  {weighed ? (
                    <button className="mt-2 text-xs font-medium text-red-400" onClick={() => void changeQty(item, -item.qty)}>
                      Hapus
                    </button>
                  ) : (
                    <div className="mt-2.5 inline-flex items-center rounded-full border border-ink-500">
                      <button className="flex h-9 w-10 items-center justify-center text-ink-100" aria-label={`Kurangi ${item.productName}`} onClick={() => void changeQty(item, -1)}>
                        <Icon name="minus" size={14} />
                      </button>
                      <span className="w-8 text-center text-sm font-medium text-ink-100">{item.qty}</span>
                      <button className="flex h-9 w-10 items-center justify-center text-ink-100" aria-label={`Tambah ${item.productName}`} onClick={() => void changeQty(item, 1)}>
                        <Icon name="plus" size={14} />
                      </button>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        <div className="flex-none space-y-1.5 px-5 pb-5 pt-3">
          <div className="border-t border-ink-600 pt-3" />
          {order && <OrderPerks order={order} features={features} />}
          <div className="flex justify-between text-sm text-ink-200">
            <span>Subtotal</span>
            <span>{formatRupiah(hasItems ? order!.subtotal : 0)}</span>
          </div>
          {hasItems &&
            discountLinesOf(order!).map((d) => (
              <div key={d.label} className="flex justify-between text-sm text-ink-200">
                <span>{d.label}</span>
                <span>-{formatRupiah(d.amount)}</span>
              </div>
            ))}
          {hasItems && order!.taxAmount > 0 && (
            <div className="flex justify-between text-sm text-ink-200">
              <span>Pajak ({order!.taxPercent}%)</span>
              <span>{formatRupiah(order!.taxAmount)}</span>
            </div>
          )}
          {hasItems && order!.roundingAdjustment !== 0 && (
            <div className="flex justify-between text-sm text-ink-200">
              <span>Pembulatan</span>
              <span>{formatRupiah(order!.roundingAdjustment)}</span>
            </div>
          )}
          <div className="flex items-center justify-between pb-2 text-xl font-bold text-ink-100">
            <span>Total</span>
            <span>{formatRupiah(total)}</span>
          </div>
          {hasItems && canDiscount && (
            <Button variant="ghost" size="sm" fullWidth className="mb-1 font-medium text-brand-400 hover:text-brand-700" onClick={() => setShowDiscount(true)}>
              {order!.discountType ? 'Ubah diskon' : '+ Diskon'}
            </Button>
          )}
          {/* Gaya ritel: biru pekat, tetap biru (bukan pudar) saat keranjang kosong. */}
          <Button
            size="lg"
            fullWidth
            className="bg-brand-700 text-base hover:bg-brand-600 disabled:bg-brand-600/60 disabled:opacity-100"
            disabled={!hasItems}
            onClick={() => order && navigate(`/kasir/${order.id}/bayar`)}
          >
            Bayar · {formatRupiah(total)}
          </Button>
        </div>
      </div>

      {scanning && (
        <ScannerModal
          onClose={() => setScanning(false)}
          onDetected={(code) => {
            setScanning(false)
            void handleCode(code)
            searchRef.current?.focus()
          }}
        />
      )}
      {showDiscount && order && (
        <DiscountModal
          initialType={order.discountType}
          initialValue={order.discountValue}
          controlled={false}
          maxPercent={100}
          subtotal={order.subtotal}
          onCancel={() => setShowDiscount(false)}
          onConfirm={(type, value) => void handleDiscount(type, value)}
        />
      )}
      {showHeld && (
        <Modal onClose={() => setShowHeld(false)} className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-ink-900 p-6">
          <h2 className="mb-1 text-lg font-bold text-ink-50">Transaksi Ditahan</h2>
          <p className="mb-4 text-sm text-ink-300">Stok belum dipotong sampai transaksi dibayar.{hasItems ? ' Keranjang sekarang ikut ditahan saat Anda membuka yang lain.' : ''}</p>
          <div className="space-y-2">
            {heldOrders.map((o) => (
              <div key={o.id} className="flex items-center gap-3 rounded-xl border border-ink-600 p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink-100">{formatRupiah(o.grandTotal)}</p>
                  <p className="text-xs text-ink-300">
                    {o.orderNumber} · {o.itemCount} produk · {formatTime(o.updatedAt)}
                  </p>
                  <input
                    className="mt-1.5 w-full rounded-lg border border-ink-600 bg-transparent px-2 py-1 text-sm text-ink-100 placeholder:text-ink-400"
                    placeholder="Catatan (mis. ibu baju merah)"
                    aria-label={`Catatan transaksi ${o.orderNumber}`}
                    defaultValue={o.notes}
                    onBlur={(e) => e.target.value !== o.notes && void setHeldLabel(o.id, e.target.value)}
                  />
                </div>
                <Button size="sm" className="flex-none" onClick={() => resumeHeld(o.id)}>
                  Buka
                </Button>
              </div>
            ))}
            {heldOrders.length === 0 && <p className="py-6 text-center text-sm text-ink-300">Tidak ada transaksi ditahan.</p>}
          </div>
        </Modal>
      )}
      {confirmDialog}
    </div>
  )
}
