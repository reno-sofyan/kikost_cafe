import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { addOrderItem, markBillPrinted, setOrderWaiter, startOrder } from './orders'
import { buildShiftSummary, openShift } from './shifts'
import { finalizePayment, voidOrder } from './checkout'
import { createTable } from './tables'
import { buildSalesReport, UNASSIGNED_WAITER } from './reports'
import {
  closeReservation,
  createReservation,
  heldReservationsByTable,
  ReservationConflictError,
  seatReservation,
  updateReservation,
} from './reservations'
import { buildReceiptData } from '@/features/printing/receiptData'
import { renderReceiptBodyHtml } from '@/features/printing/renderReceiptHtml'
import { DEFAULT_SETTINGS } from './settings'
import { jakartaDateTimeToEpoch, jakartaDateKey, jakartaTimeKey } from '@/lib/datetime'
import type { Product } from '@/types/domain'

const ACTOR = { userId: 'u1', userName: 'Kasir' }
const HOUR = 60 * 60 * 1000

beforeEach(async () => {
  await resetLocalDb()
  await db.categories.put({ id: 'c1', name: 'U', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })
  await db.products.put({
    id: 'p1', categoryId: 'c1', name: 'Kopi', sku: 'K1', barcode: null,
    price: 20000, costPrice: 5000, unit: 'pcs', photoDataUrl: null,
    trackOwnStock: true, stockQty: 100, lowStockThreshold: 0,
    isFavorite: false, isAvailable: true, modifierGroupIds: [], createdAt: 1, updatedAt: 1,
  } as Product)
})

async function openOrder(opts: { tableId?: string; waiter?: { id: string; name: string } | null; qty?: number; shiftId?: string } = {}) {
  const shiftId = opts.shiftId ?? (await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 100000 })).id
  const order = await startOrder({
    type: 'dine_in', tableId: opts.tableId, guestCount: 2, waiter: opts.waiter,
    cashierId: 'u1', cashierName: 'Kasir', shiftId,
  })
  await addOrderItem({ orderId: order.id, productId: 'p1', productName: 'Kopi', unitPrice: 20000, qty: opts.qty ?? 2, modifiers: [], notes: '' })
  return { shiftId, order: (await db.orders.get(order.id))! }
}

describe('Tip (gratuity)', () => {
  it('tip tunai: tak ikut melunasi tagihan, mengurangi kembalian, dan masuk kas seharusnya', async () => {
    const { order, shiftId } = await openOrder()
    const res = await finalizePayment({
      orderId: order.id,
      payments: [{ method: 'cash', amount: order.grandTotal, receivedAmount: 50000, tipAmount: 5000 }],
      confirmedByUserId: 'u1',
    })
    expect(res.order.status).toBe('paid')
    expect(res.payments[0].amount).toBe(40000)
    expect(res.payments[0].tipAmount).toBe(5000)
    expect(res.payments[0].changeAmount).toBe(5000)
    expect((await db.bills.where('orderId').equals(order.id).first())?.amountPaid).toBe(40000)
    expect((await db.shifts.get(shiftId))?.expectedCash).toBe(100000 + 40000 + 5000)

    const summary = await buildShiftSummary(shiftId)
    expect(summary.cashSales).toBe(40000)
    expect(summary.tipsCash).toBe(5000)
    expect(summary.tipsNonCash).toBe(0)
  })

  it('tip non-tunai tak menyentuh kas; laporan memisahkan tip dari omzet', async () => {
    const { order, shiftId } = await openOrder({ waiter: { id: 'w1', name: 'Sari' } })
    await finalizePayment({
      orderId: order.id,
      payments: [{ method: 'card', amount: order.grandTotal, tipAmount: 10000 }],
      confirmedByUserId: 'u1',
    })
    expect((await db.shifts.get(shiftId))?.expectedCash).toBe(100000)
    const report = await buildSalesReport({ from: 0, to: Date.now() + HOUR })
    expect(report.revenue).toBe(40000)
    expect(report.tipTotal).toBe(10000)
    expect(report.tipsByMethod).toEqual([{ method: 'card', amount: 10000 }])
    expect(report.byWaiter).toEqual([{ waiterName: 'Sari', revenue: 40000, transactionCount: 1, guestCount: 2, tips: 10000 }])
  })

  it('pembatalan transaksi lunas mengembalikan tip tunai dari kas seharusnya', async () => {
    const { order, shiftId } = await openOrder()
    await finalizePayment({
      orderId: order.id,
      payments: [{ method: 'cash', amount: order.grandTotal, tipAmount: 5000 }],
      confirmedByUserId: 'u1',
    })
    await voidOrder({ orderId: order.id, reason: 'salah input', approverUserId: 'sup', approverName: 'Supervisor' })
    expect((await db.shifts.get(shiftId))?.expectedCash).toBe(100000)
  })

  it('pembayaran tanpa tip tak menyimpan field tipAmount', async () => {
    const { order } = await openOrder()
    const res = await finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: order.grandTotal }], confirmedByUserId: 'u1' })
    expect('tipAmount' in res.payments[0]).toBe(false)
  })
})

describe('Tagihan sementara (pre-bill)', () => {
  it('mencatat hitungan cetak, menandai meja menunggu pembayaran, dan ber-audit', async () => {
    const table = await createTable({ name: 'Meja 1', area: '', capacity: 4 })
    const { order } = await openOrder({ tableId: table.id })

    expect(await markBillPrinted(order.id, ACTOR)).toBe(1)
    expect(await markBillPrinted(order.id, ACTOR)).toBe(2)

    const updated = (await db.orders.get(order.id))!
    expect(updated.billPrintCount).toBe(2)
    expect(updated.billPrintedAt).toBeTruthy()
    expect(updated.status).toBe('open')
    expect((await db.cafeTables.get(table.id))?.status).toBe('awaiting_payment')
    expect(await db.auditLogs.where('action').equals('order.bill.print').count()).toBe(2)
  })

  it('ditolak untuk pesanan yang sudah dibayar', async () => {
    const { order } = await openOrder()
    await finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: order.grandTotal }], confirmedByUserId: 'u1' })
    await expect(markBillPrinted(order.id, ACTOR)).rejects.toThrow(/belum dibayar/)
  })

  it('struk pre-bill bertanda BELUM DIBAYAR, memuat pelayan, tanpa rincian pembayaran', async () => {
    const { order } = await openOrder({ waiter: { id: 'w1', name: 'Sari' } })
    const data = await buildReceiptData(order, { ...DEFAULT_SETTINGS, businessType: 'cafe_resto' }, { preBill: true })
    expect(data.isPreBill).toBe(true)
    expect(data.waiterName).toBe('Sari')
    expect(data.payments).toEqual([])
    const html = renderReceiptBodyHtml(data)
    expect(html).toContain('BELUM DIBAYAR')
    expect(html).toContain('Pelayan: Sari')
    expect(html).toContain('Bukan bukti pembayaran')
    expect(html).not.toContain('Kembali')
  })

  it('struk lunas menampilkan tip dan tidak bertanda pre-bill', async () => {
    const { order } = await openOrder()
    const res = await finalizePayment({ orderId: order.id, payments: [{ method: 'card', amount: order.grandTotal, tipAmount: 7000 }], confirmedByUserId: 'u1' })
    const data = await buildReceiptData(res.order, DEFAULT_SETTINGS)
    expect(data.tipTotal).toBe(7000)
    const html = renderReceiptBodyHtml(data)
    expect(html).toContain('Tip')
    expect(html).not.toContain('BELUM DIBAYAR')
  })
})

describe('Pelayan per pesanan', () => {
  it('pelayan bisa diganti & dikosongkan; laporan mengelompokkan per pelayan', async () => {
    const shift = await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 0 })
    const a = await openOrder({ shiftId: shift.id, waiter: { id: 'w1', name: 'Sari' } })
    const b = await openOrder({ shiftId: shift.id, qty: 1 })
    await setOrderWaiter(a.order.id, { id: 'w2', name: 'Budi' })
    expect((await db.orders.get(a.order.id))?.waiterName).toBe('Budi')

    for (const o of [a.order, b.order]) {
      await finalizePayment({ orderId: o.id, payments: [{ method: 'cash', amount: o.grandTotal }], confirmedByUserId: 'u1' })
    }
    const report = await buildSalesReport({ from: 0, to: Date.now() + HOUR })
    expect(report.byWaiter.map((w) => [w.waiterName, w.revenue])).toEqual([
      ['Budi', 40000],
      [UNASSIGNED_WAITER, 20000],
    ])

    await setOrderWaiter(a.order.id, null)
    expect((await db.orders.get(a.order.id))?.waiterId).toBeNull()
    // Tak ada pesanan berpelayan → bagian per pelayan disembunyikan.
    expect((await buildSalesReport({ from: 0, to: Date.now() + HOUR })).byWaiter).toEqual([])
  })
})

describe('Laporan penjualan — rincian laba-rugi', () => {
  it('penjualan bersih, HPP, laba kotor, per jam & per hari konsisten', async () => {
    const { order } = await openOrder({ qty: 3 })
    await finalizePayment({ orderId: order.id, payments: [{ method: 'qris', amount: order.grandTotal }], confirmedByUserId: 'u1' })
    const report = await buildSalesReport({ from: 0, to: Date.now() + HOUR })
    expect(report.grossSales).toBe(60000)
    expect(report.netSales).toBe(60000)
    expect(report.costOfGoodsSold).toBe(15000)
    expect(report.grossMargin).toBe(45000)
    expect(report.grossMarginPercent).toBeCloseTo(75)
    expect(report.operatingProfit).toBe(45000)
    expect(report.itemsSold).toBe(3)
    expect(report.guestCount).toBe(2)
    expect(report.averagePerGuest).toBe(30000)
    expect(report.byHour).toHaveLength(24)
    expect(report.byHour.reduce((s, h) => s + h.revenue, 0)).toBe(report.revenue)
    expect(report.byDay).toEqual([{ dateKey: jakartaDateKey(order.createdAt), revenue: 60000, transactionCount: 1 }])
    expect(report.byOrderType).toEqual([{ type: 'dine_in', revenue: 60000, transactionCount: 1 }])
    expect(report.byPaymentMethod).toEqual([{ method: 'qris', amount: 60000, count: 1 }])
  })
})

describe('Reservasi meja', () => {
  const base = (over: Partial<Parameters<typeof createReservation>[0]> = {}) => ({
    customerName: 'Pak Budi', phone: '0812', guestCount: 4, reservedAt: Date.now() + HOUR, tableId: null as string | null, note: '', ...over,
  })

  it('validasi: nama wajib & jumlah tamu minimal 1', async () => {
    await expect(createReservation(base({ customerName: '  ' }), ACTOR)).rejects.toThrow(/Nama pemesan/)
    await expect(createReservation(base({ guestCount: 0 }), ACTOR)).rejects.toThrow(/minimal 1/)
    await expect(createReservation(base({ reservedAt: NaN }), ACTOR)).rejects.toThrow(/Tanggal/)
  })

  it('menolak dua reservasi di meja yang sama pada jam berdekatan, tapi membolehkan jam yang jauh', async () => {
    const table = await createTable({ name: 'Meja 1', area: '', capacity: 4 })
    const at = Date.now() + 3 * HOUR
    const first = await createReservation(base({ tableId: table.id, reservedAt: at }), ACTOR)
    await expect(createReservation(base({ customerName: 'Bu Ani', tableId: table.id, reservedAt: at + HOUR }), ACTOR)).rejects.toBeInstanceOf(ReservationConflictError)
    await expect(createReservation(base({ customerName: 'Bu Ani', tableId: table.id, reservedAt: at + 3 * HOUR }), ACTOR)).resolves.toBeTruthy()
    // Mengubah reservasi itu sendiri tak bentrok dengan dirinya.
    await expect(updateReservation(first.id, base({ tableId: table.id, reservedAt: at + 10 * 60 * 1000 }))).resolves.toBeUndefined()
    // Reservasi yang dibatalkan melepas slotnya.
    await closeReservation(first.id, 'cancelled', ACTOR)
    await expect(createReservation(base({ customerName: 'Bu Citra', tableId: table.id, reservedAt: at }), ACTOR)).resolves.toBeTruthy()
  })

  it('"Dudukkan" membuka pesanan dine-in di meja & menandai reservasi seated', async () => {
    const table = await createTable({ name: 'Meja 1', area: '', capacity: 4 })
    const shift = await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 0 })
    const r = await createReservation(base({ tableId: table.id }), ACTOR)

    const order = await seatReservation(r.id, { tableId: table.id, cashierId: 'u1', cashierName: 'Kasir', shiftId: shift.id, waiter: { id: 'w1', name: 'Sari' } })
    expect(order.type).toBe('dine_in')
    expect(order.guestCount).toBe(4)
    expect(order.notes).toBe('Pak Budi')
    expect(order.waiterName).toBe('Sari')
    expect((await db.cafeTables.get(table.id))?.currentOrderId).toBe(order.id)
    const seated = (await db.reservations.get(r.id))!
    expect(seated.status).toBe('seated')
    expect(seated.orderId).toBe(order.id)

    await expect(seatReservation(r.id, { tableId: table.id, cashierId: 'u1', cashierName: 'Kasir', shiftId: shift.id })).rejects.toThrow(/sudah diproses/)
    // Reservasi yang sudah datang tak bisa diubah / dibatalkan lagi.
    await expect(updateReservation(r.id, base())).rejects.toThrow(/tidak bisa diubah/)
    await closeReservation(r.id, 'no_show', ACTOR)
    expect((await db.reservations.get(r.id))?.status).toBe('seated')
  })

  it('tak bisa mendudukkan ke meja yang sedang terisi', async () => {
    const table = await createTable({ name: 'Meja 1', area: '', capacity: 4 })
    const { shiftId } = await openOrder({ tableId: table.id })
    const r = await createReservation(base({ tableId: table.id }), ACTOR)
    await expect(seatReservation(r.id, { tableId: table.id, cashierId: 'u1', cashierName: 'Kasir', shiftId })).rejects.toThrow(/belum tersedia/)
    expect((await db.reservations.get(r.id))?.status).toBe('booked')
  })

  it('denah hanya menahan meja di sekitar jam reservasi', async () => {
    const t1 = await createTable({ name: 'Meja 1', area: '', capacity: 4 })
    const t2 = await createTable({ name: 'Meja 2', area: '', capacity: 4 })
    const now = Date.now()
    await createReservation(base({ tableId: t1.id, reservedAt: now + HOUR }), ACTOR)
    await createReservation(base({ customerName: 'Besok', tableId: t2.id, reservedAt: now + 26 * HOUR }), ACTOR)
    const late = await createReservation(base({ customerName: 'Telat', tableId: t2.id, reservedAt: now - HOUR }), ACTOR)

    const held = await heldReservationsByTable(now)
    expect([...held.keys()]).toEqual([t1.id])
    expect(held.get(t1.id)?.customerName).toBe('Pak Budi')
    // 20 menit lewat masih ditahan (toleransi terlambat 30 menit).
    await updateReservation(late.id, base({ customerName: 'Telat', tableId: t2.id, reservedAt: now - 20 * 60 * 1000 }))
    expect((await heldReservationsByTable(now)).get(t2.id)?.customerName).toBe('Telat')
  })

  it('reservasi masuk antrean sinkronisasi', async () => {
    const r = await createReservation(base(), ACTOR)
    const queued = await db.syncQueue.where('entity').equals('reservations').toArray()
    expect(queued.map((q) => q.entityId)).toEqual([r.id])
  })
})

describe('Tanggal/jam WIB', () => {
  it('jakartaDateTimeToEpoch & jakartaTimeKey saling membalik, tak bergantung zona perangkat', () => {
    const ts = jakartaDateTimeToEpoch('2026-10-11', '19:30')
    expect(ts).toBe(Date.UTC(2026, 9, 11, 12, 30))
    expect(jakartaDateKey(ts)).toBe('2026-10-11')
    expect(jakartaTimeKey(ts)).toBe('19:30')
    expect(jakartaDateTimeToEpoch('', '19:30')).toBeNaN()
  })
})
