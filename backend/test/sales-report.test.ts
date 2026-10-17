import { describe, expect, it } from 'vitest'
import { buildSalesReport, salesProfileFor } from '../src/lib/salesReport.js'

// 2026-10-17 12:30 WIB
const NOON = Date.UTC(2026, 9, 17, 5, 30)

const orders = [
  { id: 'o1', type: 'dine_in', grandTotal: 50000, discountAmount: 5000, guestCount: 2, waiterName: 'Rani', paidAt: NOON },
  { id: 'o2', type: 'takeaway', grandTotal: 20000, paidAt: NOON + 3_600_000 },
  { id: 'o3', type: 'delivery', onlinePlatform: 'gofood', grandTotal: 30000, waiterName: null, paidAt: NOON },
]
const items = [
  { orderId: 'o1', productName: 'Kopi Susu', qty: 2, lineTotal: 36000 },
  { orderId: 'o1', productName: 'Roti', qty: 1, lineTotal: 15000, removed: true },
  { orderId: 'o2', productName: 'Kopi Susu', qty: 1, lineTotal: 18000 },
  { orderId: 'lain', productName: 'Bukan periode ini', qty: 9, lineTotal: 1 },
]
const payments = [
  { orderId: 'o1', method: 'cash', amount: 50000, tipAmount: 5000 },
  { orderId: 'o2', method: 'qris', amount: 20000 },
  { orderId: 'o3', method: 'platform', amount: 30000 },
  { orderId: 'o2', method: 'qris', amount: -20000, reversalOfPaymentId: 'x' },
]

describe('rekap penjualan konsol Pemilik', () => {
  it('jenis usaha → profil laporan', () => {
    expect(salesProfileFor('cafe_resto')).toBe('cafe')
    expect(salesProfileFor('lainnya')).toBe('cafe')
    expect(salesProfileFor(null)).toBe('cafe')
    expect(salesProfileFor('kantin')).toBe('kantin')
    expect(salesProfileFor('minimarket')).toBe('retail')
  })

  it('kafe: jenis pesanan + platform, pelayan & tip, tamu, produk, jam ramai', () => {
    const r = buildSalesReport({ businessType: 'cafe_resto', orders, items, payments, openPayLater: [{ id: 'p', payLater: { name: 'X' } }] })
    expect(r.totals).toEqual({ count: 3, revenue: 100000, avgTicket: 33333, discount: 5000, tips: 5000, guests: 2 })
    expect(r.byType.map((t) => t.label)).toEqual(['Dine-in', 'Online • GoFood', 'Takeaway'])
    expect(r.byWaiter).toEqual([{ name: 'Rani', count: 1, revenue: 50000, tips: 5000 }])
    expect(r.byMethod.find((m) => m.method === 'qris')).toMatchObject({ count: 1, amount: 20000 })
    expect(r.topProducts).toEqual([{ name: 'Kopi Susu', qty: 3, revenue: 54000 }])
    expect(r.byHour[12]).toEqual({ hour: 12, count: 2, revenue: 80000 })
    expect(r.byHour[13]!.count).toBe(1)
    // Tagihan tertunda khusus kantin.
    expect(r.payLater.count).toBe(0)
  })

  it('kantin: label makan di tempat/bungkus, tagihan tertunda, tanpa pelayan', () => {
    const r = buildSalesReport({
      businessType: 'kantin',
      orders,
      items,
      payments,
      openPayLater: [
        { id: 'p2', orderNumber: 'TRX-9', grandTotal: 12000, payLater: { name: 'Divisi Gudang', markedAt: NOON + 5 } },
        { id: 'p1', orderNumber: 'TRX-8', grandTotal: 8000, payLater: { name: 'Pak Budi', markedAt: NOON } },
      ],
    })
    expect(r.profile).toBe('kantin')
    expect(r.byType.map((t) => t.label)).toContain('Makan di Tempat')
    expect(r.byType.map((t) => t.label)).toContain('Bungkus')
    expect(r.byWaiter).toEqual([])
    expect(r.totals.guests).toBe(0)
    expect(r.payLater.count).toBe(2)
    expect(r.payLater.value).toBe(20000)
    expect(r.payLater.rows[0]!.name).toBe('Pak Budi')
  })
})
