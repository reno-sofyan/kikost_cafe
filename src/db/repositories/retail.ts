import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { getTrustedNow } from '@/lib/clockGuard'
import { computeLineTotal } from '@/lib/orderTotals'
import { barcodeVariants, parseScaleBarcode, samePlu, sameBarcode, scaleQty, sellUnitByBarcode, tierUnitPrice } from '@/lib/retailPricing'
import { getSettings } from '@/db/repositories/settings'
import { recalcOrderTotals } from '@/db/repositories/orders'
import type { Order, OrderItem, Product, SellUnit } from '@/types/domain'

/** Produk aktif dengan barcode atau SKU persis `code` (tak peka huruf besar/kecil). */
export async function findProductByCode(code: string): Promise<Product | undefined> {
  const wanted = code.trim().toLowerCase()
  if (!wanted) return undefined
  // Cepat lewat indeks (termasuk bentuk UPC-A ↔ EAN-13), lalu pencarian tak peka huruf.
  const byBarcode = await db.products.where('barcode').anyOf(barcodeVariants(code)).filter((p) => !p.archived).first()
  if (byBarcode) return byBarcode
  return db.products.filter((p) => !p.archived && (sameBarcode(p.barcode, wanted) || p.sku.toLowerCase() === wanted)).first()
}

export interface ScanMatch {
  product: Product
  /** Jumlah yang ditambahkan (satuan jual; berat untuk barang timbang). */
  qty: number
  sellUnit?: SellUnit
  /** Barang timbang: qty pecahan, baris sendiri (tak digabung). */
  weighed?: boolean
}

/**
 * Kode dari pemindai/kolom cari → produk: barcode/SKU produk, barcode satuan jual
 * (pak/dus), atau barcode timbangan (PLU + berat/harga di dalam barcode).
 */
export async function resolveScanCode(code: string): Promise<ScanMatch | undefined> {
  const c = code.trim()
  if (!c) return undefined
  const product = await findProductByCode(c)
  if (product) return { product, qty: 1 }
  const byUnit = await db.products.filter((p) => !p.archived && !!sellUnitByBarcode(p, c)).first()
  if (byUnit) return { product: byUnit, qty: 1, sellUnit: sellUnitByBarcode(byUnit, c) }
  const config = (await getSettings()).scaleBarcode
  const scan = parseScaleBarcode(c, config)
  if (!scan || !config) return undefined
  const weighed = await db.products.filter((p) => !p.archived && samePlu(p.scaleCode, scan.plu)).first()
  if (!weighed) return undefined
  const qty = scaleQty(weighed, scan, config)
  return qty > 0 ? { product: weighed, qty, weighed: true } : undefined
}

/** Baris satuan dasar yang boleh digabung saat produk yang sama dipindai lagi. */
export function stackableLine(items: OrderItem[], productId: string, sellUnitId: string | null): OrderItem | undefined {
  return items.find(
    (i) =>
      !i.voided &&
      !i.removed &&
      i.productId === productId &&
      (i.sellUnit?.id ?? null) === sellUnitId &&
      i.modifiers.length === 0 &&
      !i.notes &&
      i.discountAmount === 0 &&
      Number.isInteger(i.qty),
  )
}

/**
 * Mengubah qty baris kasir ritel sekaligus harga grosirnya: baris satuan dasar
 * memakai harga tingkat sesuai jumlah (turun lagi ke harga normal bila qty berkurang).
 */
export async function setRetailItemQty(itemId: string, qty: number): Promise<void> {
  await db.transaction('rw', [db.orderItems, db.orders, db.products, db.syncQueue, db.settings, db.customers], async () => {
    const item = await db.orderItems.get(itemId)
    if (!item || item.voided || item.removed) return
    const product = await db.products.get(item.productId)
    const tiered = !item.sellUnit && !!product?.tierPrices?.length
    const unitPrice = tiered ? tierUnitPrice(product!, qty) : item.unitPrice
    const lineTotal = computeLineTotal({ unitPrice, qty, modifiers: item.modifiers, discountAmount: item.discountAmount })
    const updated: OrderItem = { ...item, qty, unitPrice, lineTotal, tierApplied: tiered && unitPrice !== product!.price, updatedAt: getTrustedNow() }
    await db.orderItems.put(updated)
    await enqueueSync('orderItems', itemId, updated)
    await recalcOrderTotals(item.orderId)
  })
}

/** Transaksi kasir yang ditahan (masih terbuka) di shift ini, terbaru dulu. */
export async function listHeldOrders(shiftId: string, exceptOrderId: string | null): Promise<Array<Order & { itemCount: number }>> {
  const orders = await db.orders.where('status').equals('open').filter((o) => o.shiftId === shiftId && o.id !== exceptOrderId).toArray()
  const out: Array<Order & { itemCount: number }> = []
  for (const o of orders) {
    const items = await db.orderItems.where('orderId').equals(o.id).filter((i) => !i.voided && !i.removed).toArray()
    if (items.length) out.push({ ...o, itemCount: items.length })
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Catatan penahan transaksi (mis. "Ibu baju merah"). */
export async function setHeldLabel(orderId: string, label: string): Promise<void> {
  await db.transaction('rw', db.orders, db.syncQueue, async () => {
    const order = await db.orders.get(orderId)
    if (!order) return
    const updated: Order = { ...order, notes: label.trim().slice(0, 60), updatedAt: getTrustedNow() }
    await db.orders.put(updated)
    await enqueueSync('orders', orderId, updated)
  })
}

/** Tandai nota pesanan disimpan ke Laporan → Nota Tersimpan. Idempoten. */
export async function markOrderNotaSaved(orderId: string): Promise<void> {
  await db.transaction('rw', db.orders, db.syncQueue, async () => {
    const order = await db.orders.get(orderId)
    if (!order || order.notaSavedAt) return
    const updated: Order = { ...order, notaSavedAt: getTrustedNow(), updatedAt: getTrustedNow() }
    await db.orders.put(updated)
    await enqueueSync('orders', orderId, updated)
  })
}

/** Nota tersimpan dalam rentang waktu bayar/buat [from, to). Terbaru dulu. */
export async function listSavedNotas(from: number, to: number): Promise<Order[]> {
  const rows = await db.orders.filter((o) => !!o.notaSavedAt && (o.paidAt ?? o.createdAt) >= from && (o.paidAt ?? o.createdAt) < to).toArray()
  return rows.sort((a, b) => (b.paidAt ?? b.createdAt) - (a.paidAt ?? a.createdAt))
}

export interface ShoppingListRow {
  product: Product
  /** Saran jumlah beli (pcs) — menaikkan stok ke 2× batas minimum, dibulatkan ke dus. */
  suggestedQty: number
}

/** Daftar Belanja: produk ber-stok yang habis/menipis (≤ batas minimum). */
export async function buildShoppingList(): Promise<ShoppingListRow[]> {
  const products = await db.products.filter((p) => p.trackOwnStock && !p.archived && p.stockQty <= p.lowStockThreshold).toArray()
  return products
    .sort((a, b) => a.stockQty - a.lowStockThreshold - (b.stockQty - b.lowStockThreshold) || a.name.localeCompare(b.name))
    .map((product) => ({ product, suggestedQty: suggestedRestockQty(product) }))
}

export function suggestedRestockQty(p: Pick<Product, 'stockQty' | 'lowStockThreshold' | 'packSize'>): number {
  const target = Math.max(p.lowStockThreshold * 2, p.lowStockThreshold + 1, 1)
  const need = Math.max(1, Math.ceil(target - Math.max(0, p.stockQty)))
  const pack = p.packSize && p.packSize > 1 ? p.packSize : 1
  return Math.ceil(need / pack) * pack
}
