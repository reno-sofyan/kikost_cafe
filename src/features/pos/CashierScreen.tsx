import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { warmUpStationPrinters } from '@/db/repositories/printQueue'
import { db } from '@/db/schema'
import { listCategories } from '@/db/repositories/categories'
import { searchProducts } from '@/db/repositories/products'
import { getOpenShift } from '@/db/repositories/shifts'
import { getSettings } from '@/db/repositories/settings'
import {
  addOrderItem,
  clearOrderItems,
  cancelUnsentOrder,
  getOrder,
  isItemSentToKitchen,
  listOrderItems,
  markOrderPayLater,
  removeOrderItem,
  setOrderDiscount,
  setOrderItemCourse,
  setOrderWaiter,
  discountRequirements,
  DEFAULT_CASHIER_DISCOUNT_MAX_PERCENT,
  updateOrderItemNotes,
  updateOrderItemQty,
  startOrder,
  voidOrderItem,
} from '@/db/repositories/orders'
import { canFulfillProductQty } from '@/db/repositories/stock'
import { defaultWaiterFor } from '@/db/repositories/users'
import { prepareReceiptData } from '@/features/printing/printReceipt'
import { PrintPreviewModal } from '@/features/printing/PrintPreviewModal'
import { WaiterPickerModal } from '@/features/pos/WaiterPickerModal'
import type { ReceiptData } from '@/features/printing/receiptData'
import { sendOrderToKitchen } from '@/db/repositories/kitchenDispatch'
import { COURSE_LABELS, cycleCourse, nextCourseToFire } from '@/lib/courses'
import { voidOrder } from '@/db/repositories/checkout'
import { ITEM_CORRECTION_REASONS, ORDER_CANCEL_REASONS } from '@/lib/orderState'
import { usePosStore } from '@/state/posStore'
import { useSessionStore } from '@/state/sessionStore'
import { formatRupiah } from '@/lib/currency'
import { roleHasPermission } from '@/lib/permissions'
import { featuresForBusinessType } from '@/lib/businessType'
import { isOnlineOrder, onlineChannelLabel, onlinePlatformOf, productPriceFor } from '@/lib/onlineOrders'
import { discountLinesOf } from '@/lib/promos'
import { OrderPerks } from '@/features/pos/OrderPerks'
import { ModifierPickerModal } from '@/features/pos/ModifierPickerModal'
import { NewOrderModal } from '@/features/pos/NewOrderModal'
import { OpenBillsDrawer } from '@/features/pos/OpenBillsDrawer'
import { DiscountModal } from '@/features/pos/DiscountModal'
import { PayLaterModal } from '@/features/pos/PayLaterModal'
import { ItemNoteModal } from '@/features/pos/ItemNoteModal'
import { useEmptyOrderCancel } from '@/features/pos/useEmptyOrderCancel'
import { ReasonPromptModal } from '@/components/ui/ReasonPromptModal'
import { SupervisorPinModal } from '@/components/ui/SupervisorPinModal'
import { OwnerCancelCodeModal } from '@/components/ui/OwnerCancelCodeModal'
import type { OwnerApproval } from '@/db/repositories/cancelCodes'
import { Icon } from '@/components/ui/Icon'
import { useConfirmDialog } from '@/components/ui/useConfirmDialog'
import { usePromptDialog } from '@/components/ui/usePromptDialog'
import { setOrderPagerNumber } from '@/features/pager/pagerEngine'
import { toast } from '@/state/toastStore'
import { productTagsOf } from '@/lib/productTags'
import { publishCustomerDisplay } from '@/lib/customerDisplay'
import type { DiscountType, OnlinePlatform, OrderItem, OrderType, Product, User } from '@/types/domain'

const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  dine_in: 'Dine-in',
  takeaway: 'Takeaway',
  delivery: 'Online',
}

export function CashierScreen() {
  const navigate = useNavigate()
  const currentUser = useSessionStore((s) => s.currentUser)!
  const activeOrderId = usePosStore((s) => s.activeOrderId)
  const setActiveOrderId = usePosStore((s) => s.setActiveOrderId)

  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('all')
  const [showNewOrder, setShowNewOrder] = useState(false)
  const [showOpenBills, setShowOpenBills] = useState(false)
  const [showDiscount, setShowDiscount] = useState(false)
  const [showPayLater, setShowPayLater] = useState(false)
  const [showWaiterPicker, setShowWaiterPicker] = useState(false)
  const [preBill, setPreBill] = useState<ReceiptData | null>(null)
  const [discountOwner, setDiscountOwner] = useState<{ type: DiscountType; value: number; reason: string; percent: number } | null>(null)
  /** Kantin: kurangi/hapus item butuh alasan. `nextQty` 0 = hapus. */
  const [itemCorrection, setItemCorrection] = useState<{ item: OrderItem; nextQty: number } | null>(null)
  const [clearFlow, setClearFlow] = useState<null | { step: 'reason' } | { step: 'owner'; reason: string }>(null)
  const cancelEmpty = useEmptyOrderCancel(() => setActiveOrderId(null))
  const [pickerProduct, setPickerProduct] = useState<Product | null>(null)
  /** Produk yang ditap saat belum ada pesanan — dimasukkan begitu pesanan baru dibuat. */
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null)
  const [editingItem, setEditingItem] = useState<OrderItem | null>(null)
  const [noteItem, setNoteItem] = useState<OrderItem | null>(null)
  const [removeReasonFor, setRemoveReasonFor] = useState<OrderItem | null>(null)
  const [voidItemApproval, setVoidItemApproval] = useState<{ item: OrderItem; reason: string } | null>(null)
  const [cancelOrderFlow, setCancelOrderFlow] = useState<
    null | { step: 'reason' } | { step: 'approval'; reason: string } | { step: 'owner'; reason: string }
  >(null)
  const { confirm, dialog: confirmDialog } = useConfirmDialog()

  const openShift = useLiveQuery(() => getOpenShift(), [])
  const categories = useLiveQuery(() => listCategories(), []) ?? []
  const products = useLiveQuery(() => searchProducts(search, categoryId), [search, categoryId]) ?? []
  const order = useLiveQuery(() => (activeOrderId ? getOrder(activeOrderId) : undefined), [activeOrderId])
  // Layar pelanggan (jendela kedua) mengikuti pesanan yang sedang dikerjakan kasir.
  useEffect(() => {
    publishCustomerDisplay({ orderId: activeOrderId, stage: 'order' })
  }, [activeOrderId])
  const items = useLiveQuery(() => (activeOrderId ? listOrderItems(activeOrderId) : []), [activeOrderId])
  // Pesanan yang sudah lunas/batal tak pernah tinggal di keranjang: membuka Kasir
  // lagi selalu siap untuk pesanan baru. Yang sudah selesai ada di Riwayat.
  useEffect(() => {
    if (activeOrderId && order && order.status !== 'open') setActiveOrderId(null)
  }, [activeOrderId, order, setActiveOrderId])

  const settings = useLiveQuery(() => getSettings(), [])
  const { prompt, dialog: promptDialog } = usePromptDialog()
  // Sebelum `settings` termuat, anggap semua fitur relevan (perilaku kafe lama).
  const features = featuresForBusinessType(settings?.businessType ?? 'lainnya')
  // Sambungkan printer kasir (dan dapur/bar) sejak layar Kasir dibuka, supaya struk &
  // tiket tak menunggu Bluetooth menyambung saat dibayar / "Kirim ke Dapur".
  const hasKitchen = !!settings && features.kitchen
  useEffect(() => {
    void warmUpStationPrinters(hasKitchen ? ['cashier', 'kitchen', 'bar'] : ['cashier']).catch(() => {})
  }, [hasKitchen])
  // Cegah tap/pindai beruntun membuka dua transaksi sekaligus di mode kasir cepat.
  const quickStartRef = useRef<Promise<string> | null>(null)

  const activeItems = useMemo(() => (items ?? []).filter((i) => !i.voided && !i.removed), [items])
  // Urutan saji (pembuka/utama/penutup) hanya untuk layanan meja.
  const courseMode = features.kitchen && features.preBill && order?.type === 'dine_in'
  const heldCourse = courseMode ? nextCourseToFire(activeItems) : null
  // Pesanan online memakai Harga Online produk (bila diisi).
  const orderIsOnline = !!order && !!activeOrderId && isOnlineOrder(order)
  const orderPlatform = order && orderIsOnline ? onlinePlatformOf(order) : null

  if (!openShift) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <Icon name="cashDrawer" size={48} className="text-ink-400" />
        <h2 className="text-xl font-bold text-ink-50">Belum Ada Shift Aktif</h2>
        <p className="max-w-sm text-ink-400">Buka shift terlebih dahulu sebelum mulai mencatat transaksi.</p>
        <button className="btn-primary" onClick={() => navigate('/shift')}>
          Buka Shift
        </button>
      </div>
    )
  }

  async function handleStartOrder(params: {
    type: OrderType
    customerId?: string
    guestCount?: number
    notes?: string
    tableId?: string
    waiter?: { id: string; name: string } | null
    onlinePlatform?: OnlinePlatform
    onlineOrderRef?: string
  }) {
    const newOrder = await startOrder({
      onlinePlatform: params.onlinePlatform,
      onlineOrderRef: params.onlineOrderRef,
      type: params.type,
      customerId: params.customerId,
      guestCount: params.guestCount,
      notes: params.notes,
      tableId: params.tableId,
      // `undefined` = jalur cepat tanpa modal → pramusaji otomatis jadi pelayannya.
      waiter: params.waiter === undefined ? defaultWaiterFor(currentUser, features.waiterTracking) : params.waiter,
      cashierId: currentUser.id,
      cashierName: currentUser.name,
      shiftId: openShift!.id,
    })
    setActiveOrderId(newOrder.id)
    setShowNewOrder(false)
    return newOrder.id
  }

  /** "+ Pesanan Baru": kasir cepat langsung membuka transaksi, selain itu tampilkan dialog. */
  function handleNewOrderClick() {
    if (features.quickSale) void handleStartOrder({ type: features.orderTypes[0] })
    else setShowNewOrder(true)
  }

  /** Order aktif; di mode kasir cepat dibuat otomatis bila belum ada. */
  async function ensureActiveOrder(justStartedId?: string): Promise<string | null> {
    if (justStartedId) return justStartedId
    if (activeOrderId) return activeOrderId
    if (!features.quickSale) return null
    if (!quickStartRef.current) {
      quickStartRef.current = handleStartOrder({ type: features.orderTypes[0] }).finally(() => {
        quickStartRef.current = null
      })
    }
    return quickStartRef.current
  }

  async function handleProductTap(product: Product, justStartedId?: string) {
    if (!product.isAvailable) {
      toast.error(`${product.name} sedang habis / tidak tersedia`)
      return
    }
    // Belum ada pesanan: tap produk langsung membuka dialog Pesanan Baru, lalu
    // produk ini masuk keranjang begitu pesanan dibuat.
    if (!activeOrderId && !justStartedId && !features.quickSale) {
      setPendingProduct(product)
      setShowNewOrder(true)
      return
    }
    if (product.modifierGroupIds.length > 0) {
      if (!(await ensureActiveOrder(justStartedId))) return
      setPickerProduct(product)
      return
    }
    // Kantin/minimarket: pindai/tap ulang produk yang sama → qty baris yang ada +1.
    // Hanya baris polos yang belum diteruskan ke dapur & belum didiskon per item.
    const stackTarget = features.stackSameItems && !justStartedId
      ? activeItems.find(
          (i) =>
            i.productId === product.id &&
            i.modifiers.length === 0 &&
            !i.notes &&
            i.discountAmount === 0 &&
            (i.skipKitchen || (i.kitchenStatus === 'new' && i.kitchenPrintedAt == null)),
        )
      : undefined
    const canFulfill = await canFulfillProductQty(product, (stackTarget?.qty ?? 0) + 1)
    if (!canFulfill) {
      toast.error(`Stok bahan untuk ${product.name} tidak mencukupi`)
      return
    }
    if (stackTarget) {
      await updateOrderItemQty(stackTarget.id, stackTarget.qty + 1)
      return
    }
    const orderId = await ensureActiveOrder(justStartedId)
    if (!orderId) return
    await addOrderItem({
      orderId,
      productId: product.id,
      productName: product.name,
      unitPrice: productPriceFor(product, orderIsOnline, orderPlatform),
      qty: 1,
      modifiers: [],
      notes: '',
    })
  }

  async function handleBarcodeScan(code: string) {
    const trimmed = code.trim()
    if (!trimmed) return
    const all = await db.products.toArray()
    const match = all.find((p) => p.barcode?.toLowerCase() === trimmed.toLowerCase() || p.sku.toLowerCase() === trimmed.toLowerCase())
    if (match) {
      await handleProductTap(match)
      setSearch('')
    } else {
      setSearch(trimmed)
    }
  }

  async function handleClearCart() {
    if (!activeOrderId) return
    // Kantin: kosongkan = alasan + kode Pemilik (lihat clearOrderItems).
    if (features.ownerPinCancel) {
      setClearFlow({ step: 'reason' })
      return
    }
    if (!(await confirm({ title: 'Kosongkan Keranjang?', description: 'Semua item pada pesanan ini akan dihapus. Tindakan ini tidak dapat dibatalkan.', confirmLabel: 'Ya, Kosongkan', tone: 'danger' }))) {
      return
    }
    // Hanya item yang belum dikirim ke dapur yang bisa dikosongkan massal.
    // Item yang sudah di dapur harus dibatalkan satu per satu (butuh approval supervisor).
    for (const item of activeItems) {
      if (item.kitchenStatus === 'new') await removeOrderItem(item.id)
    }
    const stillHasKitchenItems = activeItems.some((i) => i.kitchenStatus !== 'new')
    if (stillHasKitchenItems) {
      toast.error('Item yang sudah di dapur harus dibatalkan satu per satu dengan persetujuan supervisor.')
    }
  }

  async function handleClearApproved(reason: string, approval: OwnerApproval) {
    if (!activeOrderId) return
    setClearFlow(null)
    try {
      const n = await clearOrderItems(activeOrderId, reason, { userId: currentUser.id, userName: currentUser.name }, approval)
      toast.success(`${n} item dihapus dari keranjang.`)
      if (activeItems.some((i) => i.kitchenStatus !== 'new')) {
        toast.error('Item yang sudah di dapur harus dibatalkan satu per satu dengan persetujuan supervisor.')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mengosongkan keranjang')
    }
  }

  /** Kantin: terapkan koreksi item (kurangi/hapus) setelah alasan diisi. */
  async function applyItemCorrection(item: OrderItem, nextQty: number, reason: string) {
    setItemCorrection(null)
    const correction = { reason, actor: { userId: currentUser.id, userName: currentUser.name } }
    try {
      if (nextQty <= 0) await removeOrderItem(item.id, correction)
      else await updateOrderItemQty(item.id, nextQty, correction)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mengubah item')
    }
  }

  /**
   * Batalkan pesanan aktif (belum dibayar). Kosong → langsung; belum ada item di
   * dapur → kasir cukup isi alasan; sudah di dapur → butuh persetujuan supervisor.
   */
  async function handleCancelOrderClick() {
    if (!order) return
    if (activeItems.length === 0) {
      await cancelEmpty.start(order)
      return
    }
    setCancelOrderFlow({ step: 'reason' })
  }

  async function handleCancelReason(reason: string) {
    if (!order) return
    // Kantin: setiap pembatalan pesanan berisi item butuh kode sekali pakai dari Pemilik.
    if (features.ownerPinCancel) {
      setCancelOrderFlow({ step: 'owner', reason })
      return
    }
    if (activeItems.some(isItemSentToKitchen)) {
      setCancelOrderFlow({ step: 'approval', reason })
      return
    }
    try {
      await cancelUnsentOrder(order.id, reason, { userId: currentUser.id, userName: currentUser.name })
      setActiveOrderId(null)
      toast.success(`Pesanan ${order.orderNumber} dibatalkan.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal membatalkan pesanan')
    } finally {
      setCancelOrderFlow(null)
    }
  }

  async function handleCancelApproved(approver: User, reason: string) {
    if (!order) return
    setCancelOrderFlow(null)
    try {
      await voidOrder({
        orderId: order.id,
        reason,
        approverUserId: approver.id,
        approverName: approver.name,
        requestedBy: { userId: currentUser.id, userName: currentUser.name },
      })
      setActiveOrderId(null)
      toast.success(`Pesanan ${order.orderNumber} dibatalkan.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal membatalkan pesanan')
    }
  }

  async function handleCancelOwnerApproved(approval: OwnerApproval, reason: string) {
    if (!order) return
    setCancelOrderFlow(null)
    try {
      if (activeItems.some(isItemSentToKitchen)) {
        await voidOrder({
          orderId: order.id,
          reason,
          approverUserId: approval.approverUserId,
          approverName: approval.approverName,
          ownerApproval: approval,
          requestedBy: { userId: currentUser.id, userName: currentUser.name },
        })
      } else {
        await cancelUnsentOrder(order.id, reason, { userId: currentUser.id, userName: currentUser.name }, approval)
      }
      setActiveOrderId(null)
      toast.success(`Pesanan ${order.orderNumber} dibatalkan.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal membatalkan pesanan')
    }
  }

  /** Kantin: diskon wajib alasan; di atas batas lewat kode Pemilik. */
  async function handleDiscountConfirm(type: DiscountType | null, value: number, reason: string) {
    if (!order) return
    setShowDiscount(false)
    const actor = { userId: currentUser.id, userName: currentUser.name }
    try {
      if (!features.cashierControls) return void (await setOrderDiscount(order.id, type, value))
      if (type && value > 0) {
        const req = await discountRequirements(order.id, type, value)
        if (req.needsOwnerCode) return setDiscountOwner({ type, value, reason, percent: req.percent })
      }
      await setOrderDiscount(order.id, type, value, { reason, actor })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan diskon')
    }
  }

  async function handlePayLaterConfirm(params: { name: string; note: string }) {
    if (!order) return
    setShowPayLater(false)
    try {
      await markOrderPayLater(order.id, { ...params, shiftId: openShift?.id ?? null }, { userId: currentUser.id, userName: currentUser.name })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan tagihan tertunda')
      return
    }
    // Makanan tetap dibuat sekarang — teruskan ke dapur seperti saat pesanan dibayar.
    if (features.kitchen && settings?.printerConfig.autoPrintKitchenOrder) {
      await sendOrderToKitchen(order.id, { userId: currentUser.id, userName: currentUser.name }).catch(() => {})
    }
    setActiveOrderId(null)
    toast.success(`Tagihan tertunda ${params.name} tersimpan.`)
  }

  async function handlePagerClick() {
    if (!order) return
    const value = await prompt({
      title: 'Nomor Pager',
      description: `Nomor coaster yang diberikan ke pelanggan (1–${settings?.pagerConfig.maxPagerNumber ?? 30}). Pager berbunyi otomatis saat pesanan siap. Kosongkan untuk melepas.`,
      initialValue: order.pagerNumber != null ? String(order.pagerNumber) : '',
      inputMode: 'numeric',
      allowEmpty: true,
      confirmLabel: 'Simpan',
    })
    if (value == null) return
    try {
      await setOrderPagerNumber(order.id, value.trim() ? Number(value.trim()) : null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan nomor pager')
    }
  }

  async function handleModifierConfirm(params: { qty: number; notes: string; modifiers: { groupId: string; groupName: string; optionId: string; optionName: string; priceDelta: number }[] }) {
    if (!activeOrderId || !pickerProduct) return
    const canFulfill = await canFulfillProductQty(pickerProduct, params.qty)
    if (!canFulfill) {
      toast.error(`Stok bahan untuk ${pickerProduct.name} tidak mencukupi`)
      setPickerProduct(null)
      return
    }
    if (editingItem) {
      if (features.ownerPinCancel && params.qty < editingItem.qty) {
        setItemCorrection({ item: editingItem, nextQty: params.qty })
      } else {
        await updateOrderItemQty(editingItem.id, params.qty)
      }
    } else {
      await addOrderItem({
        orderId: activeOrderId,
        productId: pickerProduct.id,
        productName: pickerProduct.name,
        unitPrice: productPriceFor(pickerProduct, orderIsOnline, orderPlatform),
        qty: params.qty,
        modifiers: params.modifiers,
        notes: params.notes,
      })
    }
    setPickerProduct(null)
    setEditingItem(null)
  }

  async function handleQtyChange(item: OrderItem, delta: number) {
    const nextQty = item.qty + delta
    if (nextQty <= 0) {
      if (item.kitchenStatus === 'new') {
        if (features.ownerPinCancel) setItemCorrection({ item, nextQty: 0 })
        else await removeOrderItem(item.id)
      } else {
        setRemoveReasonFor(item)
      }
      return
    }
    if (features.ownerPinCancel && delta < 0) {
      setItemCorrection({ item, nextQty })
      return
    }
    await updateOrderItemQty(item.id, nextQty)
  }

  const canDiscount = roleHasPermission(currentUser.role, 'discount.apply')

  const pagerOn = features.pager && !!settings && settings.pagerConfig.connectionType !== 'none'

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-none flex-wrap items-center gap-2.5 px-3 pb-3 pt-5">
          <div className="relative min-w-[12rem] flex-1">
            <input
              className="input-field !rounded-full !px-5"
              placeholder="Cari produk yang sudah terdaftar.."
              aria-label="Cari produk, SKU, atau pindai barcode"
              autoFocus={features.quickSale}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleBarcodeScan(search)
              }}
            />
          </div>
          <button
            className="btn btn-compact whitespace-nowrap border-2 border-brand-600 bg-ink-900 px-4 text-sm text-brand-400 hover:bg-brand-600/5"
            onClick={() => setShowOpenBills(true)}
          >
            Pesanan Terbuka
          </button>
          <button
            className="btn-primary btn-compact whitespace-nowrap !px-4 text-sm"
            onClick={handleNewOrderClick}
          >
            <Icon name="plus" size={18} />
            {features.quickSale ? 'Transaksi Baru' : 'Pesanan Baru'}
          </button>
        </div>

        <div className="flex flex-none gap-1.5 overflow-x-auto px-3 pb-2">
          {[{ id: 'all', name: 'Semua' }, ...categories].map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoryId(c.id)}
              aria-pressed={categoryId === c.id}
              className={`btn btn-compact min-w-[5.6rem] whitespace-nowrap border !px-4 text-sm ${
                categoryId === c.id ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-600 bg-ink-900 text-ink-100 hover:bg-ink-800'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4 pt-1">
          <div className="grid grid-cols-3 gap-2.5">
            {products.map((product) => (
              <button
                key={product.id}
                onClick={() => void handleProductTap(product)}
                className={`card relative flex flex-col items-stretch p-2.5 text-left transition-shadow hover:shadow-pop ${product.isAvailable ? '' : 'opacity-50'}`}
              >
                <div className="mb-2.5 flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-lg bg-ink-800">
                  {product.photoDataUrl ? (
                    <img src={product.photoDataUrl} alt={product.name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  ) : (
                    <Icon name={features.quickSale ? 'box' : 'coffee'} size={30} className="text-ink-400" />
                  )}
                </div>
                <span className="line-clamp-2 px-1 text-[0.95rem] font-semibold leading-snug text-ink-50">{product.name}</span>
                <span className="px-1 text-sm font-bold text-brand-400">{formatRupiah(productPriceFor(product, orderIsOnline, orderPlatform))}</span>
                {orderIsOnline && productPriceFor(product, true, orderPlatform) !== product.price ? <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-accent-400">Harga online</span> : null}
                {productTagsOf(product.tags).length > 0 && (
                  <span className="mt-1 flex flex-wrap gap-1 px-1">
                    {productTagsOf(product.tags).map((t) => (
                      <span key={t.id} title={t.label} className={`rounded px-1 py-0.5 text-[10px] font-semibold ${t.allergen ? 'bg-yellow-900/40 text-yellow-300' : 'bg-ink-800 text-ink-200'}`}>
                        {t.short}
                      </span>
                    ))}
                  </span>
                )}
                {!product.isAvailable && <span className="px-1 text-xs font-semibold text-red-400">Habis</span>}
                {product.isFavorite && (
                  <span className="absolute right-4 top-4 rounded-full bg-ink-900/90 p-1 text-accent-500">
                    <Icon name="star" size={13} fill="currentColor" />
                  </span>
                )}
              </button>
            ))}
            {products.length === 0 && <p className="col-span-full py-8 text-center text-ink-300">Produk tidak ditemukan</p>}
          </div>
        </div>
      </div>

      <div className="flex w-[24rem] flex-none flex-col border-l border-ink-700 bg-ink-900 lg:w-[28rem] xl:w-[32rem]">
        {!activeOrderId || !order ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-600/12 text-brand-400">
              <Icon name="receipt" size={30} />
            </span>
            <div>
              <p className="text-lg font-semibold text-ink-50">Siap untuk pesanan baru</p>
              <p className="mt-1 text-sm text-ink-300">
                {features.quickSale ? 'Pindai barcode atau tap produk untuk memulai transaksi.' : 'Tap produk untuk langsung memulai pesanan baru. Pesanan yang sudah selesai ada di Riwayat.'}
              </p>
            </div>
            {!features.quickSale && (
              <button className="flex min-h-[3rem] items-center gap-2 rounded-full bg-brand-600 px-6 font-semibold text-white hover:bg-brand-700" onClick={handleNewOrderClick}>
                <Icon name="plus" size={18} /> Buat Pesanan
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="flex-none border-b border-ink-700 px-4 pb-2.5 pt-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[1.2rem] font-semibold text-ink-50">
                  {features.queueNumbers && order.queueNumber ? `Antrean #${order.queueNumber}` : order.orderNumber}
                </span>
                {features.orderTypes.length > 1 && <span className="text-sm text-brand-400">{ORDER_TYPE_LABELS[order.type]}</span>}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-1.5 text-[0.85rem] text-ink-300">
                <span>{order.orderNumber}</span>
                {order.type === 'dine_in' && order.guestCount ? <span>• {order.guestCount} tamu</span> : null}
                {order.notes ? <span className="text-ink-200">• {order.notes}</span> : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                {((features.waiterTracking && !isOnlineOrder(order)) || order.waiterName) && (
                  <button className="flex items-center gap-1.5 text-[0.85rem] text-ink-300 hover:text-ink-100" onClick={() => setShowWaiterPicker(true)}>
                    <Icon name="user" size={15} />
                    {order.waiterName ? `Pelayan: ${order.waiterName}` : 'Pilih Pelayan'}
                  </button>
                )}
                {pagerOn && (
                  <button
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.8rem] font-semibold ${
                      order.pagerNumber != null ? 'border-brand-600 bg-brand-600 text-white' : 'border-dashed border-brand-500 text-brand-400'
                    }`}
                    disabled={order.pagerCalledAt != null}
                    onClick={() => void handlePagerClick()}
                    aria-label="Nomor pager"
                  >
                    <Icon name="bell" size={14} />
                    {order.pagerNumber != null ? `Pager #${order.pagerNumber}` : 'Isi No. Pager'}
                  </button>
                )}
              </div>
              {isOnlineOrder(order) && (
                <div className="mt-2 rounded-lg bg-brand-600/12 px-2 py-1 text-xs font-semibold text-brand-400">
                  Pesanan Online • {onlineChannelLabel(order)}
                </div>
              )}
              {order.billPrintCount ? (
                <div className="mt-2 rounded-lg bg-yellow-900/25 px-2 py-1 text-xs font-semibold text-yellow-400">
                  Tagihan sudah dicetak{order.billPrintCount > 1 ? ` ${order.billPrintCount}×` : ''} — menunggu pembayaran
                </div>
              ) : null}
              {order.payLater && (
                <div className="mt-2 rounded-lg bg-accent-500/15 px-2 py-1 text-xs font-semibold text-accent-500">
                  Tagihan Tertunda • {order.payLater.name}
                  {order.payLater.note ? ` — ${order.payLater.note}` : ''}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-2.5 py-3">
              {activeItems.length === 0 && <p className="py-6 text-center text-sm text-ink-300">Keranjang kosong — tap produk di kiri.</p>}
              <div className="space-y-3">
                {activeItems.map((item) => (
                  <div key={item.id} className="rounded-xl bg-ink-800 px-3.5 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 text-[1.05rem] font-semibold leading-snug text-ink-50">{item.productName}</p>
                      <span className="flex-none text-[1.05rem] font-semibold text-ink-50">{formatRupiah(item.lineTotal)}</span>
                    </div>
                    <div className="mt-1 flex items-end justify-between gap-2">
                      <div className="min-w-0 space-y-0.5">
                        {item.modifiers.map((m) => (
                          <p key={m.optionId} className="text-[0.8rem] text-ink-200">
                            {m.groupName} : {m.optionName}
                            {m.priceDelta > 0 ? ` (+${formatRupiah(m.priceDelta)})` : ''}
                          </p>
                        ))}
                        {item.notes && <p className="text-[0.8rem] italic text-ink-300">"{item.notes}"</p>}
                        {(item.skipKitchen || (item.kitchenStatus === 'new' && item.kitchenPrintedAt == null)) && (
                          <button
                            className="flex items-center gap-1 pt-0.5 text-[0.8rem] font-medium text-brand-500 hover:text-brand-600"
                            aria-label={`${item.notes ? 'Ubah' : 'Tambah'} catatan ${item.productName}`}
                            onClick={() => setNoteItem(item)}
                          >
                            <Icon name="edit" size={12} />
                            {item.notes ? 'Ubah catatan' : 'Tambah catatan'}
                          </button>
                        )}
                        {item.kitchenStatus !== 'new' && (
                          <span className="inline-block rounded bg-success-600/20 px-2 py-0.5 text-[10px] text-success-500">Dapur: {item.kitchenStatus}</span>
                        )}
                      </div>
                      <div className="flex flex-none flex-col items-end gap-2">
                        {courseMode && !item.skipKitchen && (
                          <button
                            className="text-[0.8rem] text-ink-300 disabled:opacity-60"
                            disabled={item.kitchenPrintedAt != null}
                            aria-label={`Urutan saji ${item.productName}`}
                            onClick={() => void setOrderItemCourse(item.id, cycleCourse(item.course)).catch((e) => toast.error(e instanceof Error ? e.message : 'Gagal'))}
                          >
                            Urutan Saji : {item.course ? COURSE_LABELS[item.course] : '-'}
                            {item.course && item.kitchenPrintedAt == null && heldCourse != null && item.course > heldCourse ? ' • ditahan' : ''}
                          </button>
                        )}
                        <div className="flex items-center gap-1">
                          <button
                            className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-white hover:bg-brand-700"
                            aria-label={`Kurangi jumlah ${item.productName}`}
                            onClick={() => void handleQtyChange(item, -1)}
                          >
                            <Icon name="minus" size={14} />
                          </button>
                          <span className="w-9 text-center text-[1rem] font-semibold text-ink-50">{item.qty}</span>
                          <button
                            className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-white hover:bg-brand-700"
                            aria-label={`Tambah jumlah ${item.productName}`}
                            onClick={() => void handleQtyChange(item, 1)}
                          >
                            <Icon name="plus" size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex-none space-y-2 px-2 pb-3 pt-2">
              <OrderPerks order={order} features={features} />
              <div className="space-y-1 px-1.5 text-[0.95rem] text-ink-300">
                <SummaryRow label="Subtotal" value={order.subtotal} />
                {discountLinesOf(order).map((d) => (
                  <SummaryRow key={d.label} label={d.label} value={-d.amount} />
                ))}
                {order.serviceChargeAmount > 0 && <SummaryRow label={`Service Charge (${order.serviceChargePercent}%)`} value={order.serviceChargeAmount} />}
                {order.taxAmount > 0 && <SummaryRow label={`Pajak (${order.taxPercent}%)`} value={order.taxAmount} />}
                {order.roundingAdjustment !== 0 && <SummaryRow label="Pembulatan" value={order.roundingAdjustment} />}
              </div>
              <div className="mx-1.5 flex items-center justify-between border-t border-ink-700 pt-2 text-[1.1rem] font-bold text-ink-50">
                <span>Total</span>
                <span>{formatRupiah(order.grandTotal)}</span>
              </div>

              <div className="grid grid-cols-3 gap-1.5 px-1.5 pt-1">
                <button className={CART_OUTLINE_BTN} disabled={!canDiscount} onClick={() => setShowDiscount(true)}>
                  Diskon
                </button>
                <button
                  className={CART_OUTLINE_BTN}
                  title="Pesanan sudah tersimpan otomatis — ini hanya menutup layar keranjang"
                  onClick={() => {
                    setActiveOrderId(null)
                  }}
                >
                  Tutup
                </button>
                <button className={CART_OUTLINE_BTN} disabled={activeItems.length === 0} onClick={() => void handleClearCart()}>
                  Kosongkan
                </button>
              </div>
              {(() => {
                const showKitchen = features.kitchen && activeItems.some((i) => !i.skipKitchen && i.kitchenPrintedAt == null)
                if (!showKitchen && !features.preBill) return null
                return (
                  <div className={`grid gap-1.5 px-1.5 ${showKitchen && features.preBill ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    {showKitchen && (
                      <button
                        className="min-h-[2.6rem] rounded-xl border-2 border-brand-600 bg-ink-900 px-2 text-[0.95rem] font-semibold text-brand-400 hover:bg-brand-600/5"
                        onClick={async () => {
                          const res = await sendOrderToKitchen(order.id, { userId: currentUser.id, userName: currentUser.name }, { holdCourses: courseMode })
                          toast.success(
                            res.itemCount === 0
                              ? 'Semua item sudah dikirim ke dapur.'
                              : `${res.itemCount} item dikirim ke ${res.stations.join(', ') || 'dapur'}${res.heldCount > 0 ? ` • ${res.heldCount} item ditahan untuk tahap berikutnya` : ''}.`,
                          )
                        }}
                      >
                        {heldCourse != null ? `Lepas ${COURSE_LABELS[heldCourse]} ke Dapur/Bar` : 'Kirim ke Dapur/Bar'}
                      </button>
                    )}
                    {features.preBill && (
                      <button
                        className="min-h-[2.6rem] rounded-xl bg-brand-600 px-2 text-[0.95rem] font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                        disabled={activeItems.length === 0}
                        onClick={() => void prepareReceiptData(order, { preBill: true }).then(setPreBill)}
                      >
                        {order.billPrintCount ? 'Cetak Ulang Tagihan' : 'Cetak Tagihan'}
                      </button>
                    )}
                  </div>
                )
              })()}
              <div className="px-1 pt-1.5">
                <button
                  className="min-h-[3.5rem] w-full rounded-full bg-brand-600 text-[1.2rem] font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
                  disabled={activeItems.length === 0}
                  onClick={() => navigate(`/kasir/${order.id}/bayar`)}
                  aria-label={`Bayar • ${formatRupiah(order.grandTotal)}`}
                >
                  Bayar
                </button>
              </div>
              {features.payLater && !order.payLater && (
                <button className={`${CART_OUTLINE_BTN} w-full`} disabled={activeItems.length === 0} onClick={() => setShowPayLater(true)}>
                  Tagihan Tertunda (Bayar Nanti)
                </button>
              )}
              <button className="w-full py-2 text-[0.95rem] font-medium text-red-400 hover:text-red-300" onClick={() => void handleCancelOrderClick()}>
                Batalkan Pesanan
              </button>
            </div>
          </>
        )}
      </div>

      {showNewOrder && (
        <NewOrderModal
          orderTypes={features.orderTypes}
          showTables={features.tables}
          requireBuyerName={features.buyerName}
          showWaiter={features.waiterTracking}
          defaultWaiterId={defaultWaiterFor(currentUser, features.waiterTracking)?.id ?? null}
          onCancel={() => {
            setShowNewOrder(false)
            setPendingProduct(null)
          }}
          onConfirm={(p) => {
            const product = pendingProduct
            setPendingProduct(null)
            void handleStartOrder(p).then((id) => (product ? handleProductTap(product, id) : undefined))
          }}
        />
      )}
      {showOpenBills && (
        <OpenBillsDrawer
          showPayLater={features.payLater}
          onClose={() => setShowOpenBills(false)}
          onSelect={(id) => {
            setActiveOrderId(id)
            setShowOpenBills(false)
          }}
        />
      )}
      {noteItem && (
        <ItemNoteModal
          productName={noteItem.productName}
          initialNote={noteItem.notes}
          onCancel={() => setNoteItem(null)}
          onSave={(note) => {
            const item = noteItem
            setNoteItem(null)
            void updateOrderItemNotes(item.id, note).catch((e) => toast.error(e instanceof Error ? e.message : 'Gagal menyimpan catatan'))
          }}
        />
      )}

      {pickerProduct && (
        <ModifierPickerModal
          product={pickerProduct}
          initialQty={editingItem?.qty}
          initialNotes={editingItem?.notes}
          initialModifiers={editingItem?.modifiers}
          basePrice={productPriceFor(pickerProduct, orderIsOnline, orderPlatform)}
          onCancel={() => {
            setPickerProduct(null)
            setEditingItem(null)
          }}
          onConfirm={(p) => void handleModifierConfirm(p)}
        />
      )}
      {showPayLater && order && (
        <PayLaterModal
          orderLabel={features.queueNumbers && order.queueNumber ? `Antrean #${order.queueNumber}` : order.orderNumber}
          total={order.grandTotal}
          initialName={order.notes}
          onCancel={() => setShowPayLater(false)}
          onConfirm={(p) => void handlePayLaterConfirm(p)}
        />
      )}
      {showDiscount && order && (
        <DiscountModal
          initialType={order.discountType}
          initialValue={order.discountValue}
          controlled={features.cashierControls}
          maxPercent={settings?.cashierDiscountMaxPercent ?? DEFAULT_CASHIER_DISCOUNT_MAX_PERCENT}
          subtotal={order.subtotal}
          onCancel={() => setShowDiscount(false)}
          onConfirm={(type, value, reason) => void handleDiscountConfirm(type, value, reason)}
        />
      )}
      {discountOwner && order && (
        <OwnerCancelCodeModal
          title={`Setujui Diskon ${order.orderNumber}`}
          description={`Diskon ${discountOwner.percent.toFixed(1)}% melebihi batas. Alasan: ${discountOwner.reason}`}
          onCancel={() => setDiscountOwner(null)}
          onApproved={(approval) => {
            const d = discountOwner
            setDiscountOwner(null)
            void setOrderDiscount(order.id, d.type, d.value, { reason: d.reason, actor: { userId: currentUser.id, userName: currentUser.name }, ownerApproval: approval })
              .then(() => toast.success('Diskon disetujui Pemilik.'))
              .catch((e: unknown) => toast.error(e instanceof Error ? e.message : 'Gagal menyimpan diskon'))
          }}
        />
      )}
      {removeReasonFor && (
        <ReasonPromptModal
          title={`Batalkan ${removeReasonFor.productName}`}
          description="Item ini sudah diteruskan ke dapur. Isi alasan, lalu minta persetujuan supervisor."
          confirmLabel="Lanjut"
          onCancel={() => setRemoveReasonFor(null)}
          onConfirm={(reason) => {
            setVoidItemApproval({ item: removeReasonFor, reason })
            setRemoveReasonFor(null)
          }}
        />
      )}
      {voidItemApproval && (
        <SupervisorPinModal
          title="Konfirmasi Pembatalan Item"
          permission="order.void"
          onCancel={() => setVoidItemApproval(null)}
          onApproved={(approver: User) => {
            void voidOrderItem(voidItemApproval.item.id, voidItemApproval.reason, {
              userId: approver.id,
              userName: approver.name,
            })
            setVoidItemApproval(null)
          }}
        />
      )}
      {cancelOrderFlow?.step === 'reason' && order && (
        <ReasonPromptModal
          title={`Batalkan Pesanan ${order.orderNumber}`}
          description={
            features.ownerPinCancel
              ? 'Alasan wajib diisi. Pembatalan butuh kode sekali pakai dari Pemilik.'
              : activeItems.some(isItemSentToKitchen)
                ? 'Sebagian item sudah diteruskan ke dapur — pembatalan butuh persetujuan supervisor.'
                : 'Pesanan belum dibayar & belum diteruskan ke dapur. Pembatalan tercatat atas nama Anda.'
          }
          presets={ORDER_CANCEL_REASONS}
          confirmLabel={
            features.ownerPinCancel
              ? 'Lanjut ke Kode Pemilik'
              : activeItems.some(isItemSentToKitchen) && !roleHasPermission(currentUser.role, 'order.void')
                ? 'Lanjut ke PIN'
                : 'Batalkan Pesanan'
          }
          onCancel={() => setCancelOrderFlow(null)}
          onConfirm={(reason) => void handleCancelReason(reason)}
        />
      )}
      {cancelOrderFlow?.step === 'approval' && (
        <SupervisorPinModal
          title="Konfirmasi Pembatalan Pesanan"
          permission="order.void"
          onCancel={() => setCancelOrderFlow(null)}
          onApproved={(approver: User) => void handleCancelApproved(approver, cancelOrderFlow.reason)}
        />
      )}
      {cancelOrderFlow?.step === 'owner' && order && (
        <OwnerCancelCodeModal
          title={`Batalkan ${order.orderNumber}`}
          description={`Alasan: ${cancelOrderFlow.reason}`}
          onCancel={() => setCancelOrderFlow(null)}
          onApproved={(approval) => void handleCancelOwnerApproved(approval, cancelOrderFlow.reason)}
        />
      )}
      {itemCorrection && (
        <ReasonPromptModal
          title={
            itemCorrection.nextQty <= 0
              ? `Hapus ${itemCorrection.item.productName}`
              : `Kurangi ${itemCorrection.item.productName} (${itemCorrection.item.qty} → ${itemCorrection.nextQty})`
          }
          description="Alasan wajib diisi — tercatat bersama nama Anda."
          presets={ITEM_CORRECTION_REASONS}
          confirmLabel={itemCorrection.nextQty <= 0 ? 'Hapus Item' : 'Kurangi'}
          onCancel={() => setItemCorrection(null)}
          onConfirm={(reason) => void applyItemCorrection(itemCorrection.item, itemCorrection.nextQty, reason)}
        />
      )}
      {clearFlow?.step === 'reason' && order && (
        <ReasonPromptModal
          title={`Kosongkan Keranjang ${order.orderNumber}`}
          description="Semua item yang belum ke dapur akan dihapus. Alasan wajib diisi dan butuh kode sekali pakai dari Pemilik."
          presets={ITEM_CORRECTION_REASONS}
          confirmLabel="Lanjut ke Kode Pemilik"
          onCancel={() => setClearFlow(null)}
          onConfirm={(reason) => setClearFlow({ step: 'owner', reason })}
        />
      )}
      {clearFlow?.step === 'owner' && order && (
        <OwnerCancelCodeModal
          title={`Kosongkan ${order.orderNumber}`}
          description={`Alasan: ${clearFlow.reason}`}
          onCancel={() => setClearFlow(null)}
          onApproved={(approval) => void handleClearApproved(clearFlow.reason, approval)}
        />
      )}
      {showWaiterPicker && order && (
        <WaiterPickerModal
          currentWaiterId={order.waiterId ?? null}
          onCancel={() => setShowWaiterPicker(false)}
          onPick={(waiter) => {
            setShowWaiterPicker(false)
            void setOrderWaiter(order.id, waiter)
          }}
        />
      )}
      {preBill && order && <PrintPreviewModal data={preBill} orderId={order.id} onClose={() => setPreBill(null)} />}
      {cancelEmpty.dialogs}
      {confirmDialog}
      {promptDialog}
    </div>
  )
}

const CART_OUTLINE_BTN =
  'min-h-[2.6rem] rounded-xl border border-ink-600 bg-ink-900 px-2 text-[0.95rem] font-semibold text-ink-100 hover:bg-ink-800 disabled:opacity-40'

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span>{formatRupiah(value)}</span>
    </div>
  )
}
