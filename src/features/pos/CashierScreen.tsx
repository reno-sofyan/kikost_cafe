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
  updateOrderItemQty,
  startOrder,
  voidOrderItem,
} from '@/db/repositories/orders'
import { canFulfillProductQty } from '@/db/repositories/stock'
import { sendOrderToKitchen } from '@/db/repositories/kitchenDispatch'
import { voidOrder } from '@/db/repositories/checkout'
import { ITEM_CORRECTION_REASONS, ORDER_CANCEL_REASONS } from '@/lib/orderState'
import { usePosStore } from '@/state/posStore'
import { useSessionStore } from '@/state/sessionStore'
import { formatRupiah } from '@/lib/currency'
import { roleHasPermission } from '@/lib/permissions'
import { featuresForBusinessType } from '@/lib/businessType'
import { ModifierPickerModal } from '@/features/pos/ModifierPickerModal'
import { NewOrderModal } from '@/features/pos/NewOrderModal'
import { OpenBillsDrawer } from '@/features/pos/OpenBillsDrawer'
import { DiscountModal } from '@/features/pos/DiscountModal'
import { PayLaterModal } from '@/features/pos/PayLaterModal'
import { useEmptyOrderCancel } from '@/features/pos/useEmptyOrderCancel'
import { ReasonPromptModal } from '@/components/ui/ReasonPromptModal'
import { SupervisorPinModal } from '@/components/ui/SupervisorPinModal'
import { OwnerCancelCodeModal } from '@/components/ui/OwnerCancelCodeModal'
import type { OwnerApproval } from '@/db/repositories/cancelCodes'
import { Icon } from '@/components/ui/Icon'
import { useConfirmDialog } from '@/components/ui/useConfirmDialog'
import { toast } from '@/state/toastStore'
import type { OrderItem, OrderType, Product, User } from '@/types/domain'

const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  dine_in: 'Dine-in',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
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
  /** Kantin: kurangi/hapus item butuh alasan. `nextQty` 0 = hapus. */
  const [itemCorrection, setItemCorrection] = useState<{ item: OrderItem; nextQty: number } | null>(null)
  const [clearFlow, setClearFlow] = useState<null | { step: 'reason' } | { step: 'owner'; reason: string }>(null)
  const cancelEmpty = useEmptyOrderCancel(() => setActiveOrderId(null))
  const [pickerProduct, setPickerProduct] = useState<Product | null>(null)
  const [editingItem, setEditingItem] = useState<OrderItem | null>(null)
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
  const items = useLiveQuery(() => (activeOrderId ? listOrderItems(activeOrderId) : []), [activeOrderId])

  const settings = useLiveQuery(() => getSettings(), [])
  // Sebelum `settings` termuat, anggap semua fitur relevan (perilaku kafe lama).
  const features = featuresForBusinessType(settings?.businessType ?? 'lainnya')
  // Sambungkan printer dapur/bar sejak layar Kasir dibuka, supaya tiket tak menunggu
  // Bluetooth menyambung saat "Kirim ke Dapur".
  const hasKitchen = !!settings && features.kitchen
  useEffect(() => {
    if (hasKitchen) void warmUpStationPrinters(['kitchen', 'bar']).catch(() => {})
  }, [hasKitchen])
  // Cegah tap/pindai beruntun membuka dua transaksi sekaligus di mode kasir cepat.
  const quickStartRef = useRef<Promise<string> | null>(null)

  const activeItems = useMemo(() => (items ?? []).filter((i) => !i.voided && !i.removed), [items])

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

  async function handleStartOrder(params: { type: OrderType; customerId?: string; guestCount?: number; notes?: string; tableId?: string }) {
    const newOrder = await startOrder({
      type: params.type,
      customerId: params.customerId,
      guestCount: params.guestCount,
      notes: params.notes,
      tableId: params.tableId,
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
  async function ensureActiveOrder(): Promise<string | null> {
    if (activeOrderId) return activeOrderId
    if (!features.quickSale) return null
    if (!quickStartRef.current) {
      quickStartRef.current = handleStartOrder({ type: features.orderTypes[0] }).finally(() => {
        quickStartRef.current = null
      })
    }
    return quickStartRef.current
  }

  async function handleProductTap(product: Product) {
    if (!activeOrderId && !features.quickSale) return
    if (!product.isAvailable) {
      toast.error(`${product.name} sedang habis / tidak tersedia`)
      return
    }
    if (product.modifierGroupIds.length > 0) {
      if (!(await ensureActiveOrder())) return
      setPickerProduct(product)
      return
    }
    // Kantin/minimarket: pindai/tap ulang produk yang sama → qty baris yang ada +1.
    // Hanya baris polos yang belum diteruskan ke dapur & belum didiskon per item.
    const stackTarget = features.stackSameItems
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
    const orderId = await ensureActiveOrder()
    if (!orderId) return
    await addOrderItem({
      orderId,
      productId: product.id,
      productName: product.name,
      unitPrice: product.price,
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

  async function handlePayLaterConfirm(params: { name: string; note: string }) {
    if (!order) return
    setShowPayLater(false)
    try {
      await markOrderPayLater(order.id, { ...params, shiftId: openShift?.id ?? null }, { userId: currentUser.id, userName: currentUser.name })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan bill gantung')
      return
    }
    // Makanan tetap dibuat sekarang — teruskan ke dapur seperti saat pesanan dibayar.
    if (features.kitchen && settings?.printerConfig.autoPrintKitchenOrder) {
      await sendOrderToKitchen(order.id, { userId: currentUser.id, userName: currentUser.name }).catch(() => {})
    }
    setActiveOrderId(null)
    toast.success(`Bill gantung ${params.name} tersimpan.`)
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
        unitPrice: pickerProduct.price,
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

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col border-r border-ink-800">
        <div className="flex flex-none flex-wrap items-center gap-2 border-b border-ink-800 px-4 py-3">
          <div className="relative min-w-[12rem] flex-1">
            <Icon name="barcode" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              className="input-field pl-10"
              placeholder="Cari produk, SKU, atau pindai barcode..."
              autoFocus={features.quickSale}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleBarcodeScan(search)
              }}
            />
          </div>
          <button className="btn-secondary flex-1 whitespace-nowrap sm:flex-none" onClick={() => setShowOpenBills(true)}>
            Pesanan Terbuka
          </button>
          <button className="btn-primary flex-1 whitespace-nowrap sm:flex-none" onClick={handleNewOrderClick}>
            {features.quickSale ? '+ Transaksi Baru' : '+ Pesanan Baru'}
          </button>
        </div>

        <div className="flex flex-none gap-2 overflow-x-auto border-b border-ink-800 px-4 py-2">
          <button
            onClick={() => setCategoryId('all')}
            className={`btn btn-compact !px-4 text-sm ${categoryId === 'all' ? 'btn-primary' : 'btn-secondary'}`}
          >
            Semua
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoryId(c.id)}
              className={`btn btn-compact !px-4 text-sm whitespace-nowrap ${categoryId === c.id ? 'btn-primary' : 'btn-secondary'}`}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* md, bukan lg — di viewport landscape tablet 11" (~960px efektif) breakpoint lg (1024px)
              tak pernah tercapai, jadi grid mentok 3 kolom walau ruang sebenarnya cukup untuk 4. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {products.map((product) => (
              <button
                key={product.id}
                onClick={() => void handleProductTap(product)}
                disabled={!activeOrderId && !features.quickSale}
                className="card relative flex flex-col items-start p-3 text-left disabled:opacity-40"
              >
                <div className="mb-2 flex h-20 w-full items-center justify-center rounded-lg bg-ink-800 text-3xl">
                  {product.photoDataUrl ? (
                    <img src={product.photoDataUrl} alt={product.name} className="h-full w-full rounded-lg object-cover" />
                  ) : (
                    <Icon name={features.quickSale ? 'box' : 'coffee'} size={30} className="text-ink-400" />
                  )}
                </div>
                <span className="line-clamp-2 text-sm font-semibold text-ink-50">{product.name}</span>
                <span className="mt-1 text-sm font-bold text-brand-400">{formatRupiah(product.price)}</span>
                {!product.isAvailable && <span className="mt-1 text-xs text-red-400">Habis</span>}
                {product.isFavorite && (
                  <span className="absolute right-2 top-2 text-accent-500">
                    <Icon name="star" size={14} fill="currentColor" />
                  </span>
                )}
              </button>
            ))}
            {products.length === 0 && <p className="col-span-full text-center text-ink-500">Produk tidak ditemukan</p>}
          </div>
        </div>
      </div>

      <div className="flex w-80 flex-none flex-col bg-ink-900 xl:w-96">
        {!activeOrderId || !order ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <Icon name="receipt" size={40} className="text-ink-400" />
            <p className="text-ink-400">
              {features.quickSale
                ? 'Pindai barcode atau tap produk untuk memulai transaksi'
                : 'Mulai pesanan baru atau buka pesanan yang sudah ada'}
            </p>
          </div>
        ) : (
          <>
            <div className="flex-none border-b border-ink-800 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-ink-50">
                  {features.queueNumbers && order.queueNumber ? `Antrean #${order.queueNumber}` : order.orderNumber}
                </span>
                {features.orderTypes.length > 1 && <span className="text-xs text-ink-400">{ORDER_TYPE_LABELS[order.type]}</span>}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-2 text-sm text-ink-400">
                <span>{order.orderNumber}</span>
                {order.type === 'dine_in' && order.guestCount ? <span>• {order.guestCount} tamu</span> : null}
                {order.notes ? <span className="text-ink-300">• {order.notes}</span> : null}
              </div>
              {order.payLater && (
                <div className="mt-2 rounded-lg bg-accent-500/15 px-2 py-1 text-xs font-semibold text-accent-500">
                  Bill Gantung • {order.payLater.name}
                  {order.payLater.note ? ` — ${order.payLater.note}` : ''}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              {activeItems.length === 0 && <p className="text-center text-sm text-ink-500">Keranjang kosong</p>}
              <div className="space-y-3">
                {activeItems.map((item) => (
                  <div key={item.id} className="rounded-xl bg-ink-800 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink-50">{item.productName}</p>
                        {item.modifiers.map((m) => (
                          <p key={m.optionId} className="text-xs text-ink-400">
                            {m.groupName}: {m.optionName}
                            {m.priceDelta > 0 ? ` (+${formatRupiah(m.priceDelta)})` : ''}
                          </p>
                        ))}
                        {item.notes && <p className="mt-0.5 text-xs italic text-ink-500">"{item.notes}"</p>}
                      </div>
                      <span className="flex-none font-semibold text-brand-400">{formatRupiah(item.lineTotal)}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          className="btn-secondary btn-compact !px-3"
                          aria-label={`Kurangi jumlah ${item.productName}`}
                          onClick={() => void handleQtyChange(item, -1)}
                        >
                          <Icon name="minus" size={14} />
                        </button>
                        <span className="w-6 text-center font-bold">{item.qty}</span>
                        <button
                          className="btn-secondary btn-compact !px-3"
                          aria-label={`Tambah jumlah ${item.productName}`}
                          onClick={() => void handleQtyChange(item, 1)}
                        >
                          <Icon name="plus" size={14} />
                        </button>
                      </div>
                      {item.kitchenStatus !== 'new' && (
                        <span className="rounded bg-success-600/20 px-2 py-0.5 text-[10px] text-success-500">
                          Dapur: {item.kitchenStatus}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex-none space-y-2 border-t border-ink-800 px-4 py-3">
              <SummaryRow label="Subtotal" value={order.subtotal} />
              {order.discountAmount > 0 && <SummaryRow label="Diskon" value={-order.discountAmount} />}
              {order.serviceChargeAmount > 0 && <SummaryRow label={`Service Charge (${order.serviceChargePercent}%)`} value={order.serviceChargeAmount} />}
              {order.taxAmount > 0 && <SummaryRow label={`Pajak (${order.taxPercent}%)`} value={order.taxAmount} />}
              {order.roundingAdjustment !== 0 && <SummaryRow label="Pembulatan" value={order.roundingAdjustment} />}
              <div className="flex items-center justify-between border-t border-ink-700 pt-2 text-lg font-bold text-ink-50">
                <span>Total</span>
                <span>{formatRupiah(order.grandTotal)}</span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-1">
                <button className="btn-secondary" disabled={!canDiscount} onClick={() => setShowDiscount(true)}>
                  Diskon
                </button>
                <button
                  className="btn-secondary"
                  title="Pesanan sudah tersimpan otomatis — ini hanya menutup layar keranjang"
                  onClick={() => {
                    setActiveOrderId(null)
                  }}
                >
                  Tutup
                </button>
                <button className="btn-secondary" disabled={activeItems.length === 0} onClick={() => void handleClearCart()}>
                  Kosongkan
                </button>
              </div>
              {features.kitchen && activeItems.some((i) => !i.skipKitchen && i.kitchenPrintedAt == null) && (
                <button
                  className="btn-secondary w-full"
                  onClick={async () => {
                    const res = await sendOrderToKitchen(order.id, { userId: currentUser.id, userName: currentUser.name })
                    toast.success(
                      res.itemCount === 0
                        ? 'Semua item sudah dikirim ke dapur.'
                        : `${res.itemCount} item dikirim ke ${res.stations.join(', ') || 'dapur'}.`,
                    )
                  }}
                >
                  Kirim ke Dapur / Bar
                </button>
              )}
              <button
                className="btn-primary w-full"
                disabled={activeItems.length === 0}
                onClick={() => navigate(`/kasir/${order.id}/bayar`)}
              >
                Bayar • {formatRupiah(order.grandTotal)}
              </button>
              {features.payLater && !order.payLater && (
                <button className="btn-secondary w-full" disabled={activeItems.length === 0} onClick={() => setShowPayLater(true)}>
                  Bill Gantung (Bayar Nanti)
                </button>
              )}
              <button className="btn-ghost w-full !text-red-400" onClick={() => void handleCancelOrderClick()}>
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
          onCancel={() => setShowNewOrder(false)}
          onConfirm={(p) => void handleStartOrder(p)}
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
      {pickerProduct && (
        <ModifierPickerModal
          product={pickerProduct}
          initialQty={editingItem?.qty}
          initialNotes={editingItem?.notes}
          initialModifiers={editingItem?.modifiers}
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
          onCancel={() => setShowDiscount(false)}
          onConfirm={(type, value) => {
            void setOrderDiscount(order.id, type, value)
            setShowDiscount(false)
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
      {cancelEmpty.dialogs}
      {confirmDialog}
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-sm text-ink-300">
      <span>{label}</span>
      <span>{formatRupiah(value)}</span>
    </div>
  )
}
