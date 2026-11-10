import { db } from '@/db/schema'
import { isRecognizedSale, type DateRange } from '@/db/repositories/reports'
import { abcClassify, stockCoverDays, type AbcClass } from '@/lib/retailAnalysis'

const DAY_MS = 86_400_000

export interface ProductInsight {
  productId: string
  name: string
  categoryName: string
  /** Terjual dalam satuan dasar (pak/dus dikali isinya). */
  qty: number
  revenue: number
  cost: number
  profit: number
  /** Persen laba terhadap omzet produk. */
  marginPercent: number
  abc: AbcClass
  share: number
  stockQty: number
  /** Perkiraan hari sampai stok habis dengan laju jual periode ini. */
  coverDays: number | null
}

export interface DeadStockRow {
  productId: string
  name: string
  stockQty: number
  stockValue: number
  /** Penjualan terakhir (null = belum pernah terjual). */
  lastSoldAt: number | null
}

export interface CashierControlRow {
  name: string
  transactions: number
  revenue: number
  /** Item dihapus/dikurangi sebelum bayar (nilai rupiah). */
  removedCount: number
  removedValue: number
  voidCount: number
  voidValue: number
  returnCount: number
  returnValue: number
  discountValue: number
}

export interface RetailInsights {
  days: number
  products: ProductInsight[]
  categories: { name: string; revenue: number; cost: number; profit: number; marginPercent: number }[]
  deadStock: DeadStockRow[]
  deadStockValue: number
  cashiers: CashierControlRow[]
  tax: { taxTotal: number; taxableSales: number; orderCount: number }
}

const pct = (profit: number, revenue: number) => (revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0)

/**
 * Analisis ritel untuk rentang laporan: ABC & laku cepat/lambat, margin per produk
 * dan kategori, stok mati (`deadDays` hari tanpa penjualan), kontrol kasir (hapus
 * item, void, retur, diskon), dan ringkasan PPN keluaran.
 */
export async function buildRetailInsights(range: DateRange, deadDays = 30, now = Date.now()): Promise<RetailInsights> {
  const days = Math.max(1, Math.round((range.to - range.from) / DAY_MS))
  const orders = await db.orders.where('createdAt').between(range.from, range.to, true, true).toArray()
  const sales = orders.filter(isRecognizedSale)
  const orderIds = orders.map((o) => o.id)
  const items = orderIds.length ? await db.orderItems.where('orderId').anyOf(orderIds).toArray() : []
  const products = await db.products.toArray()
  const productById = new Map(products.map((p) => [p.id, p]))
  const categoryName = new Map((await db.categories.toArray()).map((c) => [c.id, c.name]))
  const userName = new Map((await db.users.toArray()).map((u) => [u.id, u.name]))
  const saleIds = new Set(sales.map((o) => o.id))

  // ---- Produk & kategori ----
  const rows = new Map<string, { productId: string; name: string; qty: number; revenue: number; cost: number }>()
  for (const it of items) {
    if (!saleIds.has(it.orderId) || it.voided || it.removed) continue
    const p = productById.get(it.productId)
    const baseQty = it.qty * (it.sellUnit?.qty || 1)
    const r = rows.get(it.productId) ?? { productId: it.productId, name: p?.name ?? it.productName, qty: 0, revenue: 0, cost: 0 }
    r.qty += baseQty
    r.revenue += it.lineTotal
    r.cost += (it.unitCost || p?.costPrice || 0) * baseQty
    rows.set(it.productId, r)
  }
  const productRows: ProductInsight[] = abcClassify([...rows.values()]).map((r) => {
    const p = productById.get(r.productId)
    const profit = r.revenue - Math.round(r.cost)
    return {
      productId: r.productId,
      name: r.name,
      categoryName: (p && categoryName.get(p.categoryId)) || 'Lainnya',
      qty: Math.round(r.qty * 1000) / 1000,
      revenue: r.revenue,
      cost: Math.round(r.cost),
      profit,
      marginPercent: pct(profit, r.revenue),
      abc: r.abc,
      share: r.share,
      stockQty: p?.stockQty ?? 0,
      coverDays: p?.trackOwnStock ? stockCoverDays(p.stockQty, r.qty, days) : null,
    }
  })
  const cats = new Map<string, { name: string; revenue: number; cost: number }>()
  for (const r of productRows) {
    const c = cats.get(r.categoryName) ?? { name: r.categoryName, revenue: 0, cost: 0 }
    c.revenue += r.revenue
    c.cost += r.cost
    cats.set(r.categoryName, c)
  }
  const categories = [...cats.values()]
    .map((c) => ({ ...c, profit: c.revenue - c.cost, marginPercent: pct(c.revenue - c.cost, c.revenue) }))
    .sort((a, b) => b.revenue - a.revenue)

  // ---- Stok mati: ber-stok, tak terjual `deadDays` hari terakhir ----
  const lastSold = new Map<string, number>()
  await db.stockMovements
    .where('reason')
    .equals('sale')
    .filter((m) => m.itemType === 'product')
    .each((m) => {
      if ((lastSold.get(m.itemId) ?? 0) < m.createdAt) lastSold.set(m.itemId, m.createdAt)
    })
  const cutoff = now - deadDays * DAY_MS
  const deadStock: DeadStockRow[] = products
    .filter((p) => p.trackOwnStock && !p.archived && p.stockQty > 0 && (lastSold.get(p.id) ?? 0) < cutoff)
    .map((p) => ({ productId: p.id, name: p.name, stockQty: p.stockQty, stockValue: Math.round(p.stockQty * p.costPrice), lastSoldAt: lastSold.get(p.id) ?? null }))
    .sort((a, b) => b.stockValue - a.stockValue)

  // ---- Kontrol kasir ----
  const cashiers = new Map<string, CashierControlRow>()
  const cashier = (name: string) => {
    let c = cashiers.get(name)
    if (!c) {
      c = { name, transactions: 0, revenue: 0, removedCount: 0, removedValue: 0, voidCount: 0, voidValue: 0, returnCount: 0, returnValue: 0, discountValue: 0 }
      cashiers.set(name, c)
    }
    return c
  }
  const orderById = new Map(orders.map((o) => [o.id, o]))
  for (const o of sales) {
    const c = cashier(o.cashierName)
    c.transactions += 1
    c.revenue += o.grandTotal
    c.discountValue += o.discountAmount
  }
  for (const it of items) {
    const order = orderById.get(it.orderId)
    if (!order) continue
    if (it.removed) {
      const c = cashier(it.removedByName || order.cashierName)
      c.removedCount += 1
      c.removedValue += it.lineTotal
    } else if (it.reducedValue) {
      const c = cashier(order.cashierName)
      c.removedCount += 1
      c.removedValue += it.reducedValue
    }
  }
  const voids = await db.orders
    .where('status')
    .equals('void')
    .filter((o) => (o.voidedAt ?? o.createdAt) >= range.from && (o.voidedAt ?? o.createdAt) <= range.to)
    .toArray()
  for (const o of voids) {
    const c = cashier(o.voidedByName || (o.voidedBy && userName.get(o.voidedBy)) || o.cashierName)
    c.voidCount += 1
    c.voidValue += o.grandTotal
  }
  const returns = await db.returns.where('createdAt').between(range.from, range.to, true, true).toArray()
  for (const r of returns) {
    const c = cashier(userName.get(r.userId) ?? 'Tidak diketahui')
    c.returnCount += 1
    c.returnValue += r.refundAmount
  }

  const taxTotal = sales.reduce((s, o) => s + o.taxAmount, 0)
  return {
    days,
    products: productRows,
    categories,
    deadStock,
    deadStockValue: deadStock.reduce((s, d) => s + d.stockValue, 0),
    cashiers: [...cashiers.values()].sort((a, b) => b.revenue - a.revenue),
    tax: {
      taxTotal,
      taxableSales: sales.filter((o) => o.taxAmount > 0).reduce((s, o) => s + o.grandTotal - o.taxAmount, 0),
      orderCount: sales.filter((o) => o.taxAmount > 0).length,
    },
  }
}
