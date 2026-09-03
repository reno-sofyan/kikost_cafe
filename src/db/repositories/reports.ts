import { db } from '@/db/schema'
import { listLowStockIngredients, listLowStockProducts } from '@/db/repositories/stock'
import type { PaymentMethod } from '@/types/domain'

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

export interface SalesReport {
  range: DateRange
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
  byPaymentMethod: { method: PaymentMethod; amount: number }[]
  topProducts: ProductSalesRow[]
  allProductSales: ProductSalesRow[]
}

export async function buildSalesReport(range: DateRange): Promise<SalesReport> {
  const orders = await db.orders
    .where('createdAt')
    .between(range.from, range.to, true, true)
    .filter((o) => o.status === 'paid' || o.status === 'completed')
    .toArray()

  const orderIds = orders.map((o) => o.id)
  const items = orderIds.length ? await db.orderItems.where('orderId').anyOf(orderIds).toArray() : []
  const activeItems = items.filter((i) => !i.voided && !i.removed)
  const payments = orderIds.length ? await db.payments.where('orderId').anyOf(orderIds).toArray() : []
  const returns = orderIds.length ? await db.returns.where('orderId').anyOf(orderIds).toArray() : []
  const voidOrdersInRange = await db.orders
    .where('createdAt')
    .between(range.from, range.to, true, true)
    .filter((o) => o.status === 'void')
    .count()
  const expenses = await db.expenses.where('createdAt').between(range.from, range.to, true, true).toArray()

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

  const methodTotals = new Map<PaymentMethod, number>()
  for (const payment of payments) {
    methodTotals.set(payment.method, (methodTotals.get(payment.method) ?? 0) + payment.amount)
  }
  const byPaymentMethod = Array.from(methodTotals.entries()).map(([method, amount]) => ({ method, amount }))

  return {
    range,
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
  }
}

export interface StockReportRow {
  name: string
  unit: string
  stockQty: number
  lowStockThreshold: number
  isLow: boolean
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
