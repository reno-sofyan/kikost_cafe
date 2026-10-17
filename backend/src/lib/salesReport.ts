/**
 * Rekap penjualan untuk konsol Pemilik (/owner) — isinya dibedakan per jenis usaha:
 *  - Kafe & resto (dan "lainnya"): jenis pesanan + platform online, pelayan & tip, tamu.
 *  - Kantin: makan di tempat vs bungkus, Tagihan Tertunda yang belum dibayar.
 *  - Semua: produk terlaris, metode bayar, jam ramai.
 * Fungsi murni atas payload tersinkron supaya mudah diuji tanpa database.
 */

type Payload = Record<string, unknown>

export type SalesProfile = 'cafe' | 'kantin' | 'retail'

export interface SalesReport {
  profile: SalesProfile
  totals: { count: number; revenue: number; avgTicket: number; discount: number; tips: number; guests: number }
  byType: { key: string; label: string; count: number; revenue: number }[]
  byMethod: { method: string; label: string; count: number; amount: number }[]
  topProducts: { name: string; qty: number; revenue: number }[]
  byHour: { hour: number; count: number; revenue: number }[]
  /** Kafe saja (kosong untuk jenis lain). */
  byWaiter: { name: string; count: number; revenue: number; tips: number }[]
  /** Kantin saja: tagihan tertunda yang masih terbuka (tak dibatasi periode). */
  payLater: { count: number; value: number; rows: { name: string; orderNumber: string | null; value: number; markedAt: number | null }[] }
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

export function salesProfileFor(businessType: string | null | undefined): SalesProfile {
  if (businessType === 'kantin') return 'kantin'
  if (businessType === 'minimarket') return 'retail'
  return 'cafe'
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer',
  card: 'Kartu',
  giftcard: 'Voucher',
  deposit: 'Saldo Member',
  platform: 'Via Aplikasi',
}
const PLATFORM_LABELS: Record<string, string> = { gofood: 'GoFood', grabfood: 'GrabFood', shopeefood: 'ShopeeFood' }

function typeKey(o: Payload, profile: SalesProfile): { key: string; label: string } {
  const type = String(o.type ?? '')
  if (type === 'delivery') {
    const platform = str(o.onlinePlatform) ?? 'other'
    return { key: `online:${platform}`, label: `Online • ${PLATFORM_LABELS[platform] ?? 'Lainnya'}` }
  }
  if (type === 'takeaway') return { key: 'takeaway', label: profile === 'kantin' ? 'Bungkus' : 'Takeaway' }
  if (type === 'dine_in') return { key: 'dine_in', label: profile === 'kantin' ? 'Makan di Tempat' : 'Dine-in' }
  return { key: type || 'lainnya', label: 'Lainnya' }
}

/** Jam WIB (0–23) dari epoch ms. */
const wibHour = (ms: number): number => new Date(ms + 7 * 3_600_000).getUTCHours()

export function buildSalesReport(params: {
  businessType: string | null
  /** Pesanan lunas dalam periode. */
  orders: Payload[]
  items: Payload[]
  payments: Payload[]
  /** Pesanan terbuka bertanda Tagihan Tertunda (kantin). */
  openPayLater: Payload[]
}): SalesReport {
  const profile = salesProfileFor(params.businessType)
  const orderIds = new Set(params.orders.map((o) => String(o.id ?? '')))

  const byType = new Map<string, { key: string; label: string; count: number; revenue: number }>()
  const byWaiter = new Map<string, { name: string; count: number; revenue: number; tips: number }>()
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0, revenue: 0 }))
  const waiterByOrder = new Map<string, string>()
  let revenue = 0
  let discount = 0
  let guests = 0

  for (const o of params.orders) {
    const total = num(o.grandTotal)
    revenue += total
    discount += num(o.discountAmount)
    const t = typeKey(o, profile)
    const bucket = byType.get(t.key) ?? { ...t, count: 0, revenue: 0 }
    bucket.count += 1
    bucket.revenue += total
    byType.set(t.key, bucket)
    const at = num(o.paidAt) || num(o.createdAt)
    if (at > 0) {
      const h = byHour[wibHour(at)]!
      h.count += 1
      h.revenue += total
    }
    if (profile === 'cafe') {
      if (String(o.type) === 'dine_in') guests += num(o.guestCount)
      const waiter = str(o.waiterName)
      if (waiter) {
        waiterByOrder.set(String(o.id ?? ''), waiter)
        const w = byWaiter.get(waiter) ?? { name: waiter, count: 0, revenue: 0, tips: 0 }
        w.count += 1
        w.revenue += total
        byWaiter.set(waiter, w)
      }
    }
  }

  const byMethod = new Map<string, { method: string; label: string; count: number; amount: number }>()
  let tips = 0
  for (const p of params.payments) {
    const orderId = String(p.orderId ?? '')
    const amount = num(p.amount)
    if (!orderIds.has(orderId) || amount <= 0 || p.reversalOfPaymentId) continue
    const method = String(p.method ?? 'lainnya')
    const m = byMethod.get(method) ?? { method, label: METHOD_LABELS[method] ?? method, count: 0, amount: 0 }
    m.count += 1
    m.amount += amount
    byMethod.set(method, m)
    const tip = num(p.tipAmount)
    if (tip > 0) {
      tips += tip
      const waiter = waiterByOrder.get(orderId)
      if (waiter) byWaiter.get(waiter)!.tips += tip
    }
  }

  const products = new Map<string, { name: string; qty: number; revenue: number }>()
  for (const i of params.items) {
    if (!orderIds.has(String(i.orderId ?? '')) || i.removed === true || i.voided === true) continue
    const name = str(i.productName) ?? 'Tanpa nama'
    const p = products.get(name) ?? { name, qty: 0, revenue: 0 }
    p.qty += num(i.qty)
    p.revenue += num(i.lineTotal)
    products.set(name, p)
  }

  const payLaterRows =
    profile === 'kantin'
      ? params.openPayLater
          .map((o) => {
            const pl = (o.payLater ?? {}) as Payload
            return { name: str(pl.name) ?? '—', orderNumber: str(o.orderNumber), value: num(o.grandTotal), markedAt: num(pl.markedAt) || null }
          })
          .sort((a, b) => (a.markedAt ?? 0) - (b.markedAt ?? 0))
      : []

  const count = params.orders.length
  return {
    profile,
    totals: { count, revenue, avgTicket: count ? Math.round(revenue / count) : 0, discount, tips, guests },
    byType: [...byType.values()].sort((a, b) => b.revenue - a.revenue),
    byMethod: [...byMethod.values()].sort((a, b) => b.amount - a.amount),
    topProducts: [...products.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 15),
    byHour,
    byWaiter: [...byWaiter.values()].sort((a, b) => b.revenue - a.revenue),
    payLater: { count: payLaterRows.length, value: payLaterRows.reduce((s, r) => s + r.value, 0), rows: payLaterRows.slice(0, 50) },
  }
}
