import { db } from '@/db/schema'
import { listLowStockIngredients, listLowStockProducts } from '@/db/repositories/stock'
import { jakartaDateKey } from '@/lib/datetime'
import { isOnlineOrder, onlineCommissionOf, onlinePlatformOf } from '@/lib/onlineOrders'
import type { OnlinePlatform, OrderType, PaymentMethod } from '@/types/domain'

export interface DateRange {
  from: number
  to: number
}

export interface ProductSalesRow {
  productId: string
  productName: string
  qtySold: number
  revenue: number
  costTotal: number
}

/**
 * Cakupan laporan penjualan: `offline` = dine-in & takeaway, `online` = pesanan
 * online (GoFood/GrabFood/ShopeeFood/…), `all` = gabungan keduanya.
 */
export type ReportScope = 'offline' | 'online' | 'all'

export const REPORT_SCOPE_LABELS: Record<ReportScope, string> = {
  offline: 'Dine-in & Takeaway',
  online: 'Pesanan Online',
  all: 'Keseluruhan',
}

export interface SalesReport {
  range: DateRange
  scope: ReportScope
  revenue: number
  transactionCount: number
  averageTransaction: number
  discountTotal: number
  taxTotal: number
  serviceChargeTotal: number
  returnTotal: number
  voidCount: number
  expenseTotal: number
  grossProfit: number
  byCategory: { categoryName: string; revenue: number }[]
  byCashier: { cashierName: string; revenue: number; transactionCount: number }[]
  byPaymentMethod: { method: PaymentMethod; amount: number; count: number }[]
  topProducts: ProductSalesRow[]
  allProductSales: ProductSalesRow[]

  // ---- Rincian laba-rugi sederhana ----
  /** Penjualan kotor: jumlah harga item sebelum diskon, pajak, & service charge. */
  grossSales: number
  /** Penjualan bersih = kotor − diskon − retur. Dasar perhitungan margin. */
  netSales: number
  costOfGoodsSold: number
  /** Laba kotor = penjualan bersih − HPP (pajak & service charge TIDAK dihitung laba). */
  grossMargin: number
  /** Persen laba kotor terhadap penjualan bersih (0 bila tak ada penjualan). */
  grossMarginPercent: number
  /** Laba operasional (estimasi) = laba kotor − komisi platform − pengeluaran. */
  operatingProfit: number

  // ---- Pesanan online ----
  /** Omzet & jumlah transaksi tiap kanal — untuk perbandingan di laporan gabungan. */
  channelSplit: { offline: { revenue: number; transactionCount: number }; online: { revenue: number; transactionCount: number } }
  /** Estimasi komisi yang dipotong platform (dari persen komisi saat pesanan dibuat). */
  onlineCommissionTotal: number
  /** Omzet online − komisi = perkiraan yang benar-benar dicairkan platform. */
  onlineNetReceived: number
  byPlatform: { platform: OnlinePlatform; revenue: number; transactionCount: number; commission: number; net: number }[]
  roundingTotal: number
  itemsSold: number

  // ---- Tamu & layanan ----
  guestCount: number
  /** Penjualan bersih per tamu dine-in yang tercatat (0 bila tak ada tamu). */
  averagePerGuest: number
  byOrderType: { type: OrderType; revenue: number; transactionCount: number }[]
  /** Kosong bila tak ada pesanan yang mencatat pelayan dalam rentang ini. */
  byWaiter: { waiterName: string; revenue: number; transactionCount: number; guestCount: number; tips: number }[]
  /** Tip (bukan omzet) yang diterima dalam rentang ini. */
  tipTotal: number
  tipsByMethod: { method: PaymentMethod; amount: number }[]

  // ---- Pola waktu (zona Asia/Jakarta) ----
  /** 24 baris, jam 0..23. */
  byHour: { hour: number; revenue: number; transactionCount: number }[]
  /** Satu baris per hari yang ADA transaksinya, urut naik. */
  byDay: { dateKey: string; revenue: number; transactionCount: number }[]
}

export const UNASSIGNED_WAITER = 'Tanpa pelayan'
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000

export async function buildSalesReport(range: DateRange, scope: ReportScope = 'all'): Promise<SalesReport> {
  const inScope = (o: { type: OrderType }) => scope === 'all' || (scope === 'online') === isOnlineOrder(o)
  const orders = await db.orders
    .where('createdAt')
    .between(range.from, range.to, true, true)
    .filter((o) => (o.status === 'paid' || o.status === 'completed') && inScope(o))
    .toArray()

  const orderIds = orders.map((o) => o.id)
  const items = orderIds.length ? await db.orderItems.where('orderId').anyOf(orderIds).toArray() : []
  const activeItems = items.filter((i) => !i.voided && !i.removed)
  const payments = orderIds.length ? await db.payments.where('orderId').anyOf(orderIds).toArray() : []
  const returns = orderIds.length ? await db.returns.where('orderId').anyOf(orderIds).toArray() : []
  const voidOrdersInRange = await db.orders
    .where('createdAt')
    .between(range.from, range.to, true, true)
    .filter((o) => o.status === 'void' && inScope(o))
    .count()
  // Pengeluaran operasional tak bisa dibagi per kanal — hanya masuk laporan gabungan.
  const expenses = scope === 'all' ? await db.expenses.where('createdAt').between(range.from, range.to, true, true).toArray() : []

  const products = await db.products.toArray()
  const categories = await db.categories.toArray()
  const productById = new Map(products.map((p) => [p.id, p]))
  const categoryById = new Map(categories.map((c) => [c.id, c]))

  const revenue = orders.reduce((s, o) => s + o.grandTotal, 0)
  const discountTotal = orders.reduce((s, o) => s + o.discountAmount, 0)
  const taxTotal = orders.reduce((s, o) => s + o.taxAmount, 0)
  const serviceChargeTotal = orders.reduce((s, o) => s + o.serviceChargeAmount, 0)
  const returnTotal = returns.reduce((s, r) => s + r.refundAmount, 0)
  const expenseTotal = expenses.reduce((s, e) => s + e.amount, 0)

  const productSalesMap = new Map<string, ProductSalesRow>()
  for (const item of activeItems) {
    const product = productById.get(item.productId)
    const cost = (product?.costPrice ?? 0) * item.qty
    const existing = productSalesMap.get(item.productId)
    if (existing) {
      existing.qtySold += item.qty
      existing.revenue += item.lineTotal
      existing.costTotal += cost
    } else {
      productSalesMap.set(item.productId, {
        productId: item.productId,
        productName: item.productName,
        qtySold: item.qty,
        revenue: item.lineTotal,
        costTotal: cost,
      })
    }
  }
  const allProductSales = Array.from(productSalesMap.values()).sort((a, b) => b.revenue - a.revenue)
  const topProducts = allProductSales.slice(0, 10)
  const costOfGoodsSold = allProductSales.reduce((s, p) => s + p.costTotal, 0)
  const grossProfit = revenue - costOfGoodsSold

  const categoryRevenue = new Map<string, number>()
  for (const item of activeItems) {
    const product = productById.get(item.productId)
    const categoryName = product ? categoryById.get(product.categoryId)?.name ?? 'Lainnya' : 'Lainnya'
    categoryRevenue.set(categoryName, (categoryRevenue.get(categoryName) ?? 0) + item.lineTotal)
  }
  const byCategory = Array.from(categoryRevenue.entries())
    .map(([categoryName, rev]) => ({ categoryName, revenue: rev }))
    .sort((a, b) => b.revenue - a.revenue)

  const cashierStats = new Map<string, { revenue: number; transactionCount: number }>()
  for (const order of orders) {
    const current = cashierStats.get(order.cashierName) ?? { revenue: 0, transactionCount: 0 }
    current.revenue += order.grandTotal
    current.transactionCount += 1
    cashierStats.set(order.cashierName, current)
  }
  const byCashier = Array.from(cashierStats.entries())
    .map(([cashierName, stats]) => ({ cashierName, ...stats }))
    .sort((a, b) => b.revenue - a.revenue)

  const methodTotals = new Map<PaymentMethod, { amount: number; count: number }>()
  const tipByMethod = new Map<PaymentMethod, number>()
  const tipByOrder = new Map<string, number>()
  for (const payment of payments) {
    const m = methodTotals.get(payment.method) ?? { amount: 0, count: 0 }
    m.amount += payment.amount
    if (payment.amount > 0) m.count += 1
    methodTotals.set(payment.method, m)
    if (payment.amount > 0 && payment.tipAmount) {
      tipByMethod.set(payment.method, (tipByMethod.get(payment.method) ?? 0) + payment.tipAmount)
      tipByOrder.set(payment.orderId, (tipByOrder.get(payment.orderId) ?? 0) + payment.tipAmount)
    }
  }
  const byPaymentMethod = Array.from(methodTotals.entries())
    .map(([method, v]) => ({ method, ...v }))
    .sort((a, b) => b.amount - a.amount)
  const tipsByMethod = Array.from(tipByMethod.entries()).map(([method, amount]) => ({ method, amount }))
  const tipTotal = tipsByMethod.reduce((s, t) => s + t.amount, 0)

  const grossSales = orders.reduce((s, o) => s + o.subtotal, 0)
  const netSales = grossSales - discountTotal - returnTotal
  const grossMargin = netSales - costOfGoodsSold
  const guestCount = orders.reduce((s, o) => s + (o.type === 'dine_in' ? (o.guestCount ?? 0) : 0), 0)
  const dineInNet = orders.filter((o) => o.type === 'dine_in' && o.guestCount).reduce((s, o) => s + o.subtotal - o.discountAmount, 0)

  const channelSplit = { offline: { revenue: 0, transactionCount: 0 }, online: { revenue: 0, transactionCount: 0 } }
  const platformStats = new Map<OnlinePlatform, { revenue: number; transactionCount: number; commission: number }>()
  for (const order of orders) {
    const channel = isOnlineOrder(order) ? channelSplit.online : channelSplit.offline
    channel.revenue += order.grandTotal
    channel.transactionCount += 1
    const platform = onlinePlatformOf(order)
    if (platform) {
      const p = platformStats.get(platform) ?? { revenue: 0, transactionCount: 0, commission: 0 }
      p.revenue += order.grandTotal
      p.transactionCount += 1
      p.commission += onlineCommissionOf(order)
      platformStats.set(platform, p)
    }
  }
  const byPlatform = Array.from(platformStats.entries())
    .map(([platform, s]) => ({ platform, ...s, net: s.revenue - s.commission }))
    .sort((a, b) => b.revenue - a.revenue)
  const onlineCommissionTotal = byPlatform.reduce((s, p) => s + p.commission, 0)

  const typeStats = new Map<OrderType, { revenue: number; transactionCount: number }>()
  const waiterStats = new Map<string, { revenue: number; transactionCount: number; guestCount: number; tips: number }>()
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, revenue: 0, transactionCount: 0 }))
  const dayStats = new Map<string, { revenue: number; transactionCount: number }>()
  for (const order of orders) {
    const t = typeStats.get(order.type) ?? { revenue: 0, transactionCount: 0 }
    t.revenue += order.grandTotal
    t.transactionCount += 1
    typeStats.set(order.type, t)

    const wName = order.waiterName?.trim() || UNASSIGNED_WAITER
    const w = waiterStats.get(wName) ?? { revenue: 0, transactionCount: 0, guestCount: 0, tips: 0 }
    w.revenue += order.grandTotal
    w.transactionCount += 1
    w.guestCount += order.type === 'dine_in' ? (order.guestCount ?? 0) : 0
    w.tips += tipByOrder.get(order.id) ?? 0
    waiterStats.set(wName, w)

    const h = byHour[new Date(order.createdAt + JAKARTA_OFFSET_MS).getUTCHours()]
    h.revenue += order.grandTotal
    h.transactionCount += 1

    const key = jakartaDateKey(order.createdAt)
    const d = dayStats.get(key) ?? { revenue: 0, transactionCount: 0 }
    d.revenue += order.grandTotal
    d.transactionCount += 1
    dayStats.set(key, d)
  }
  const byOrderType = Array.from(typeStats.entries())
    .map(([type, stats]) => ({ type, ...stats }))
    .sort((a, b) => b.revenue - a.revenue)
  // Hanya tampil bila ada pesanan yang benar-benar mencatat pelayan.
  const hasWaiters = Array.from(waiterStats.keys()).some((n) => n !== UNASSIGNED_WAITER)
  const byWaiter = hasWaiters
    ? Array.from(waiterStats.entries())
        .map(([waiterName, stats]) => ({ waiterName, ...stats }))
        .sort((a, b) => b.revenue - a.revenue)
    : []
  const byDay = Array.from(dayStats.entries())
    .map(([dateKey, stats]) => ({ dateKey, ...stats }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey))

  return {
    range,
    scope,
    revenue,
    transactionCount: orders.length,
    averageTransaction: orders.length > 0 ? revenue / orders.length : 0,
    discountTotal,
    taxTotal,
    serviceChargeTotal,
    returnTotal,
    voidCount: voidOrdersInRange,
    expenseTotal,
    grossProfit,
    byCategory,
    byCashier,
    byPaymentMethod,
    topProducts,
    allProductSales,
    grossSales,
    netSales,
    costOfGoodsSold,
    grossMargin,
    grossMarginPercent: netSales > 0 ? (grossMargin / netSales) * 100 : 0,
    operatingProfit: grossMargin - onlineCommissionTotal - expenseTotal,
    channelSplit,
    onlineCommissionTotal,
    onlineNetReceived: channelSplit.online.revenue - onlineCommissionTotal,
    byPlatform,
    roundingTotal: orders.reduce((s, o) => s + o.roundingAdjustment, 0),
    itemsSold: activeItems.reduce((s, i) => s + i.qty, 0),
    guestCount,
    averagePerGuest: guestCount > 0 ? dineInNet / guestCount : 0,
    byOrderType,
    byWaiter,
    tipTotal,
    tipsByMethod,
    byHour,
    byDay,
  }
}

/** Rentang sebelumnya dengan panjang yang sama — untuk pembanding "vs periode lalu". */
export function previousRange(range: DateRange): DateRange {
  const length = range.to - range.from
  return { from: range.from - length - 1, to: range.from - 1 }
}

export interface StockReportRow {
  name: string
  unit: string
  stockQty: number
  lowStockThreshold: number
  isLow: boolean
}

export interface StockMovementReportRow {
  itemName: string
  unit: string
  qty: number
  estCost: number
}

export interface KitchenDurationRow {
  productName: string
  count: number
  avgPrepMinutes: number
}

export interface OperationsReport {
  range: DateRange
  wasteByItem: StockMovementReportRow[]
  wasteTotalCost: number
  ingredientUsage: { itemName: string; unit: string; sale: number; production: number; waste: number; adjustment: number }[]
  productionOutput: StockMovementReportRow[]
  kitchenDuration: KitchenDurationRow[]
  avgKitchenMinutes: number
}

/**
 * Laporan operasional untuk rentang tanggal: waste (jumlah + estimasi biaya),
 * pemakaian bahan per alasan, hasil produksi, dan durasi penyiapan dapur.
 */
export async function buildOperationsReport(range: DateRange): Promise<OperationsReport> {
  const moves = await db.stockMovements.where('createdAt').between(range.from, range.to, true, true).toArray()
  const ingredients = new Map((await db.ingredients.toArray()).map((i) => [i.id, i]))
  const products = new Map((await db.products.toArray()).map((p) => [p.id, p]))

  const costOf = (m: (typeof moves)[number]): number => {
    if (m.itemType === 'ingredient') return (ingredients.get(m.itemId)?.costPerUnit ?? 0) * Math.abs(m.qtyDelta)
    return (products.get(m.itemId)?.costPrice ?? 0) * Math.abs(m.qtyDelta)
  }
  const unitOf = (m: (typeof moves)[number]): string =>
    m.itemType === 'ingredient' ? (ingredients.get(m.itemId)?.unit ?? '') : (products.get(m.itemId)?.unit ?? 'pcs')

  const wasteMap = new Map<string, StockMovementReportRow>()
  const usageMap = new Map<string, { itemName: string; unit: string; sale: number; production: number; waste: number; adjustment: number }>()
  const outputMap = new Map<string, StockMovementReportRow>()

  for (const m of moves) {
    const key = `${m.itemType}:${m.itemId}`
    const abs = Math.abs(m.qtyDelta)

    if (m.reason === 'waste') {
      const row = wasteMap.get(key) ?? { itemName: m.itemName, unit: unitOf(m), qty: 0, estCost: 0 }
      row.qty += abs
      row.estCost += costOf(m)
      wasteMap.set(key, row)
    }
    if (m.reason === 'production_output') {
      const row = outputMap.get(key) ?? { itemName: m.itemName, unit: unitOf(m), qty: 0, estCost: 0 }
      row.qty += abs
      row.estCost += costOf(m)
      outputMap.set(key, row)
    }
    if (['sale', 'production_consumption', 'waste', 'adjustment'].includes(m.reason)) {
      const u = usageMap.get(key) ?? { itemName: m.itemName, unit: unitOf(m), sale: 0, production: 0, waste: 0, adjustment: 0 }
      if (m.reason === 'sale') u.sale += abs
      else if (m.reason === 'production_consumption') u.production += abs
      else if (m.reason === 'waste') u.waste += abs
      else if (m.reason === 'adjustment') u.adjustment += abs
      usageMap.set(key, u)
    }
  }

  // Durasi dapur: item pesanan yang di-serve dalam rentang, queuedAt → servedAt.
  const servedItems = (await db.orderItems.toArray()).filter(
    (it) => it.servedAt != null && it.queuedAt != null && it.servedAt >= range.from && it.servedAt <= range.to,
  )
  const durMap = new Map<string, { count: number; totalMs: number }>()
  for (const it of servedItems) {
    const ms = (it.servedAt as number) - (it.queuedAt as number)
    if (ms <= 0) continue
    const d = durMap.get(it.productName) ?? { count: 0, totalMs: 0 }
    d.count++
    d.totalMs += ms
    durMap.set(it.productName, d)
  }
  const kitchenDuration = [...durMap.entries()]
    .map(([productName, d]) => ({ productName, count: d.count, avgPrepMinutes: Math.round((d.totalMs / d.count / 60_000) * 10) / 10 }))
    .sort((a, b) => b.avgPrepMinutes - a.avgPrepMinutes)
  const allMs = [...durMap.values()].reduce((s, d) => s + d.totalMs, 0)
  const allCount = [...durMap.values()].reduce((s, d) => s + d.count, 0)

  const wasteByItem = [...wasteMap.values()].sort((a, b) => b.estCost - a.estCost)

  return {
    range,
    wasteByItem,
    wasteTotalCost: wasteByItem.reduce((s, r) => s + r.estCost, 0),
    ingredientUsage: [...usageMap.values()].sort((a, b) => b.sale + b.production - (a.sale + a.production)),
    productionOutput: [...outputMap.values()].sort((a, b) => b.qty - a.qty),
    kitchenDuration,
    avgKitchenMinutes: allCount ? Math.round((allMs / allCount / 60_000) * 10) / 10 : 0,
  }
}

export async function buildStockReport(): Promise<StockReportRow[]> {
  const products = await db.products.filter((p) => p.trackOwnStock).toArray()
  const ingredients = await db.ingredients.toArray()
  const lowProducts = await listLowStockProducts()
  const lowIngredients = await listLowStockIngredients()
  const lowProductIds = new Set(lowProducts.map((p) => p.id))
  const lowIngredientIds = new Set(lowIngredients.map((i) => i.id))

  const productRows: StockReportRow[] = products.map((p) => ({
    name: p.name,
    unit: p.unit,
    stockQty: p.stockQty,
    lowStockThreshold: p.lowStockThreshold,
    isLow: lowProductIds.has(p.id),
  }))
  const ingredientRows: StockReportRow[] = ingredients.map((i) => ({
    name: i.name,
    unit: i.unit,
    stockQty: i.stockQty,
    lowStockThreshold: i.lowStockThreshold,
    isLow: lowIngredientIds.has(i.id),
  }))
  return [...productRows, ...ingredientRows].sort((a, b) => (a.isLow === b.isLow ? 0 : a.isLow ? -1 : 1))
}
