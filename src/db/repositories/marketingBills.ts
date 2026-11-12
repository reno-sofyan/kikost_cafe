import { db } from '@/db/schema'
import { isRecognizedSale, type DateRange } from '@/db/repositories/reports'
import type { Order } from '@/types/domain'

/**
 * Laporan Tagihan Marketing (kafe): jamuan klien oleh sales tim marketing yang
 * ditagihkan ke kantor. Akrual — dicatat pada tanggal pesanan; yang belum dilunasi
 * kantor = piutang. Pesanan Marketing yang langsung dibayar di tempat ikut tercatat
 * (status "Dibayar langsung") supaya kunjungan sales tetap lengkap.
 */

export type MarketingBillStatus = 'unpaid' | 'settled' | 'direct'

export const MARKETING_BILL_STATUS_LABELS: Record<MarketingBillStatus, string> = {
  unpaid: 'Belum dibayar kantor',
  settled: 'Lunas',
  direct: 'Dibayar langsung',
}

export interface MarketingBillRow {
  orderId: string
  orderNumber: string
  orderedAt: number
  salesId: string
  salesName: string
  salesDivision: string
  clientName: string
  purpose: string
  cashierName: string
  /** Ringkasan item, mis. "2× Americano, 1× Croffle". */
  itemsLabel: string
  subtotal: number
  discountAmount: number
  total: number
  paid: number
  outstanding: number
  status: MarketingBillStatus
  /** Waktu lunas (pelunasan kantor / bayar langsung). */
  paidAt: number | null
}

export interface MarketingBillReport {
  rows: MarketingBillRow[]
  bySales: { salesId: string; salesName: string; salesDivision: string; count: number; total: number; outstanding: number }[]
  total: number
  outstanding: number
  outstandingCount: number
}

function statusOf(o: Order, outstanding: number): MarketingBillStatus {
  if (o.status === 'open' || outstanding > 0) return 'unpaid'
  return o.payLater ? 'settled' : 'direct'
}

export async function buildMarketingBillReport(range: DateRange, salesId: string | null = null): Promise<MarketingBillReport> {
  const orders = await db.orders
    .where('createdAt')
    .between(range.from, range.to, true, true)
    .filter((o) => !!o.marketingBill && isRecognizedSale(o) && (!salesId || o.marketingBill.salesId === salesId))
    .toArray()
  const ids = orders.map((o) => o.id)
  const items = ids.length ? (await db.orderItems.where('orderId').anyOf(ids).toArray()).filter((i) => !i.removed && !i.voided) : []
  const payments = ids.length ? await db.payments.where('orderId').anyOf(ids).toArray() : []
  const paidByOrder = new Map<string, number>()
  for (const p of payments) paidByOrder.set(p.orderId, (paidByOrder.get(p.orderId) ?? 0) + p.amount)

  const rows: MarketingBillRow[] = orders
    .map((o) => {
      const m = o.marketingBill!
      const paid = paidByOrder.get(o.id) ?? 0
      const outstanding = o.status === 'open' ? Math.max(0, o.grandTotal - paid) : 0
      return {
        orderId: o.id,
        orderNumber: o.orderNumber,
        orderedAt: o.createdAt,
        salesId: m.salesId,
        salesName: m.salesName,
        salesDivision: m.salesDivision,
        clientName: m.clientName,
        purpose: m.purpose,
        cashierName: m.recordedByName || o.cashierName,
        itemsLabel: items
          .filter((i) => i.orderId === o.id)
          .map((i) => `${i.qty}× ${i.productName}`)
          .join(', '),
        subtotal: o.subtotal,
        discountAmount: o.discountAmount,
        total: o.grandTotal,
        paid,
        outstanding,
        status: statusOf(o, outstanding),
        paidAt: o.paidAt,
      }
    })
    .sort((a, b) => b.orderedAt - a.orderedAt)

  const bySales = new Map<string, MarketingBillReport['bySales'][number]>()
  for (const r of rows) {
    const s = bySales.get(r.salesId) ?? { salesId: r.salesId, salesName: r.salesName, salesDivision: r.salesDivision, count: 0, total: 0, outstanding: 0 }
    s.count += 1
    s.total += r.total
    s.outstanding += r.outstanding
    bySales.set(r.salesId, s)
  }
  const unpaid = rows.filter((r) => r.outstanding > 0)
  return {
    rows,
    bySales: [...bySales.values()].sort((a, b) => b.total - a.total),
    total: rows.reduce((s, r) => s + r.total, 0),
    outstanding: unpaid.reduce((s, r) => s + r.outstanding, 0),
    outstandingCount: unpaid.length,
  }
}
