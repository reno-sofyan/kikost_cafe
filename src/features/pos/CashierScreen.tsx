import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { listCategories } from '@/db/repositories/categories'
import { searchProducts } from '@/db/repositories/products'
import { getOpenShift } from '@/db/repositories/shifts'
import {
  addOrderItem,
  getOrder,
  listOrderItems,
  removeOrderItem,
  setOrderDiscount,
  updateOrderItemQty,
  startOrder,
  voidOrderItem,
} from '@/db/repositories/orders'
import { canFulfillProductQty } from '@/db/repositories/stock'
import { usePosStore } from '@/state/posStore'
import { useSessionStore } from '@/state/sessionStore'
import { formatRupiah } from '@/lib/currency'
import { roleHasPermission } from '@/lib/permissions'
import { ModifierPickerModal } from '@/features/pos/ModifierPickerModal'
import { NewOrderModal } from '@/features/pos/NewOrderModal'
import { OpenBillsDrawer } from '@/features/pos/OpenBillsDrawer'
import { DiscountModal } from '@/features/pos/DiscountModal'
import { ReasonPromptModal } from '@/components/ui/ReasonPromptModal'
import { Icon } from '@/components/ui/Icon'
import type { OrderItem, OrderType, Product } from '@/types/domain'

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
  const [pickerProduct, setPickerProduct] = useState<Product | null>(null)
  const [editingItem, setEditingItem] = useState<OrderItem | null>(null)
  const [stockWarning, setStockWarning] = useState<string | null>(null)
  const [removeReasonFor, setRemoveReasonFor] = useState<OrderItem | null>(null)
  const [confirmClearCart, setConfirmClearCart] = useState(false)

  const openShift = useLiveQuery(() => getOpenShift(), [])
  const categories = useLiveQuery(() => listCategories(), []) ?? []
  const products = useLiveQuery(() => searchProducts(search, categoryId), [search, categoryId]) ?? []
  const order = useLiveQuery(() => (activeOrderId ? getOrder(activeOrderId) : undefined), [activeOrderId])
  const items = useLiveQuery(() => (activeOrderId ? listOrderItems(activeOrderId) : []), [activeOrderId])
  const table = useLiveQuery(() => (order?.tableId ? db.cafeTables.get(order.tableId) : undefined), [order?.tableId])

  const activeItems = useMemo(() => (items ?? []).filter((i) => !i.voided), [items])

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

  async function handleStartOrder(params: { type: OrderType; tableId?: string; customerId?: string; guestCount?: number }) {
    const newOrder = await startOrder({
      type: params.type,
      tableId: params.tableId,
      customerId: params.customerId,
      guestCount: params.guestCount,
      cashierId: currentUser.id,
      cashierName: currentUser.name,
      shiftId: openShift!.id,
    })
    setActiveOrderId(newOrder.id)
    setShowNewOrder(false)
  }

  async function handleProductTap(product: Product) {
    if (!activeOrderId) return
    if (!product.isAvailable) {
      setStockWarning(`${product.name} sedang habis / tidak tersedia`)
      return
    }
    if (product.modifierGroupIds.length > 0) {
      setPickerProduct(product)
      return
    }
    const canFulfill = await canFulfillProductQty(product, 1)
    if (!canFulfill) {
      setStockWarning(`Stok bahan untuk ${product.name} tidak mencukupi`)
      return
    }
    await addOrderItem({
      orderId: activeOrderId,
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
    for (const item of activeItems) {
      if (item.kitchenStatus === 'new') {
        await removeOrderItem(item.id)
      } else {
        await voidOrderItem(item.id, 'Keranjang dikosongkan kasir')
      }
    }
    setConfirmClearCart(false)
  }

  async function handleModifierConfirm(params: { qty: number; notes: string; modifiers: { groupId: string; groupName: string; optionId: string; optionName: string; priceDelta: number }[] }) {
    if (!activeOrderId || !pickerProduct) return
    const canFulfill = await canFulfillProductQty(pickerProduct, params.qty)
    if (!canFulfill) {
      setStockWarning(`Stok bahan untuk ${pickerProduct.name} tidak mencukupi`)
      setPickerProduct(null)
      return
    }
    if (editingItem) {
      await updateOrderItemQty(editingItem.id, params.qty)
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
        await removeOrderItem(item.id)
      } else {
        setRemoveReasonFor(item)
      }
      return
    }
    await updateOrderItemQty(item.id, nextQty)
  }

  const canDiscount = roleHasPermission(currentUser.role, 'discount.apply')

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col border-r border-ink-800">
        <div className="flex flex-none items-center gap-3 border-b border-ink-800 px-4 py-3">
          <div className="relative flex-1">
            <Icon name="barcode" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              className="input-field pl-10"
              placeholder="Cari produk, SKU, atau pindai barcode..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleBarcodeScan(search)
              }}
            />
          </div>
          <button className="btn-secondary" onClick={() => setShowOpenBills(true)}>
            Pesanan Terbuka
          </button>
          <button className="btn-primary" onClick={() => setShowNewOrder(true)}>
            + Pesanan Baru
          </button>
        </div>

        <div className="flex flex-none gap-2 overflow-x-auto border-b border-ink-800 px-4 py-2">
          <button
            onClick={() => setCategoryId('all')}
            className={`btn !min-h-0 !px-4 !py-2 text-sm ${categoryId === 'all' ? 'btn-primary' : 'btn-secondary'}`}
          >
            Semua
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategoryId(c.id)}
              className={`btn !min-h-0 !px-4 !py-2 text-sm whitespace-nowrap ${categoryId === c.id ? 'btn-primary' : 'btn-secondary'}`}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => (
              <button
                key={product.id}
                onClick={() => void handleProductTap(product)}
                disabled={!activeOrderId}
                className="card relative flex flex-col items-start p-3 text-left disabled:opacity-40"
              >
                <div className="mb-2 flex h-20 w-full items-center justify-center rounded-lg bg-ink-800 text-3xl">
                  {product.photoDataUrl ? (
                    <img src={product.photoDataUrl} alt={product.name} className="h-full w-full rounded-lg object-cover" />
                  ) : (
                    <Icon name="coffee" size={30} className="text-ink-400" />
                  )}
                </div>
                <span className="line-clamp-2 text-sm font-semibold text-ink-50">{product.name}</span>
                <span className="mt-1 text-sm font-bold text-brew-400">{formatRupiah(product.price)}</span>
                {!product.isAvailable && <span className="mt-1 text-xs text-red-400">Habis</span>}
                {product.isFavorite && (
                  <span className="absolute right-2 top-2 text-brown-500">
                    <Icon name="star" size={14} fill="currentColor" />
                  </span>
                )}
              </button>
            ))}
            {products.length === 0 && <p className="col-span-full text-center text-ink-500">Produk tidak ditemukan</p>}
          </div>
        </div>
      </div>

      <div className="flex w-96 flex-none flex-col bg-ink-900">
        {!activeOrderId || !order ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <Icon name="receipt" size={40} className="text-ink-400" />
            <p className="text-ink-400">Mulai pesanan baru atau buka pesanan yang sudah ada</p>
          </div>
        ) : (
          <>
            <div className="flex-none border-b border-ink-800 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-ink-50">{order.orderNumber}</span>
                <span className="text-xs text-ink-400">{ORDER_TYPE_LABELS[order.type]}</span>
              </div>
              <div className="mt-1 text-sm text-ink-400">
                {table ? `${table.name} • ${order.guestCount ?? 1} tamu` : ''}
                {order.queueNumber ? `Antrean #${order.queueNumber}` : ''}
              </div>
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
                      <span className="flex-none font-semibold text-brew-400">{formatRupiah(item.lineTotal)}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button className="btn-secondary !min-h-0 !px-3 !py-1" onClick={() => void handleQtyChange(item, -1)}>
                          <Icon name="minus" size={14} />
                        </button>
                        <span className="w-6 text-center font-bold">{item.qty}</span>
                        <button className="btn-secondary !min-h-0 !px-3 !py-1" onClick={() => void handleQtyChange(item, 1)}>
                          <Icon name="plus" size={14} />
                        </button>
                      </div>
                      {item.kitchenStatus !== 'new' && (
                        <span className="rounded bg-sage-600/20 px-2 py-0.5 text-[10px] text-sage-500">
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
                  onClick={() => {
                    setActiveOrderId(null)
                  }}
                >
                  Simpan
                </button>
                <button className="btn-secondary" disabled={activeItems.length === 0} onClick={() => setConfirmClearCart(true)}>
                  Kosongkan
                </button>
              </div>
              <button
                className="btn-primary w-full"
                disabled={activeItems.length === 0}
                onClick={() => navigate(`/kasir/${order.id}/bayar`)}
              >
                Bayar • {formatRupiah(order.grandTotal)}
              </button>
            </div>
          </>
        )}
      </div>

      {showNewOrder && <NewOrderModal onCancel={() => setShowNewOrder(false)} onConfirm={(p) => void handleStartOrder(p)} />}
      {showOpenBills && (
        <OpenBillsDrawer
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
          description="Item ini sudah diteruskan ke dapur, alasan pembatalan wajib diisi."
          confirmLabel="Batalkan Item"
          onCancel={() => setRemoveReasonFor(null)}
          onConfirm={(reason) => {
            void voidOrderItem(removeReasonFor.id, reason)
            setRemoveReasonFor(null)
          }}
        />
      )}
      {confirmClearCart && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setConfirmClearCart(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-ink-900 p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <Icon name="alertTriangle" size={32} className="mx-auto mb-3 text-red-500" />
            <h2 className="mb-2 text-lg font-bold text-ink-50">Kosongkan Keranjang?</h2>
            <p className="mb-4 text-sm text-ink-400">Semua item pada pesanan ini akan dihapus. Tindakan ini tidak dapat dibatalkan.</p>
            <div className="flex gap-3">
              <button className="btn-ghost flex-1" onClick={() => setConfirmClearCart(false)}>
                Batal
              </button>
              <button className="btn-danger flex-[2]" onClick={() => void handleClearCart()}>
                Ya, Kosongkan
              </button>
            </div>
          </div>
        </div>
      )}
      {stockWarning && (
        <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center">
          <div className="rounded-full bg-red-900/90 px-5 py-3 text-sm font-medium text-red-100 shadow-lg" onClick={() => setStockWarning(null)}>
            {stockWarning}
          </div>
        </div>
      )}
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
