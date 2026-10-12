import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { addOrderItem, setOrderItemKitchenStatus, startOrder } from './orders'
import { closeShift, openShift } from './shifts'
import { finalizePayment } from './checkout'
import { getSettings, updateSettings } from './settings'
import { sendOrderToKitchen } from './kitchenDispatch'
import { listReservations } from './reservations'
import { buildDepositReport, findGiftCard } from './deposits'
import { listExpenses } from './expenses'
import { buildKitchenSpeedReport, buildTableTurnover, listLateKitchenOrders } from './serviceInsights'
import { listRecordedPayroll, recordPayrollExpense, saveStaffPay, saveStaffRoster } from './staffPay'
import { cancelPreOrder, countDuePreOrders, createPreOrder, describePreOrderLine, listPreOrders, preOrderDepositBalance, preOrderTotal, startPreOrder } from './preOrders'
import { buildDailySummaryInput, buildDailySummaryMessage, getLastClosedShift } from './dailySummary'
import { buildReceiptData } from '@/features/printing/receiptData'
import { buildKitchenSpeed, kitchenTargetMinutesOf, prepMinutesOf } from '@/lib/kitchenSpeed'
import { receiptToText } from '@/lib/receiptText'
import { dailySummaryMessage } from '@/lib/dailySummary'
import { buildPayroll, payrollToCsv } from '@/lib/payroll'
import { buildRosterCompliance, lateMinutesFor, shiftOn, weekdayOfDateKey } from '@/lib/roster'
import { normalizeProductTags, productTagsOf } from '@/lib/productTags'
import { activeCustomerDisplay, CUSTOMER_DISPLAY_STALE_MS, readCustomerDisplay } from '@/lib/customerDisplay'
import { jakartaDateTimeToEpoch } from '@/lib/datetime'
import { featuresForBusinessType } from '@/lib/businessType'
import type { Product, StaffRoster } from '@/types/domain'

const ACTOR = { userId: 'u1', userName: 'Kasir' }
const MIN = 60_000
const HOUR = 60 * MIN
const ALL_TIME = () => ({ from: 0, to: Date.now() + HOUR })
let shiftId: string

function product(id: string, name: string, price: number, extra: Partial<Product> = {}): Product {
  return {
    id, categoryId: 'c1', name, sku: id, barcode: null, price, costPrice: Math.round(price / 4), unit: 'pcs', photoDataUrl: null,
    trackOwnStock: true, stockQty: 50, lowStockThreshold: 0, isFavorite: false, isAvailable: true, modifierGroupIds: [], createdAt: 1, updatedAt: 1,
    ...extra,
  } as Product
}

beforeEach(async () => {
  await resetLocalDb()
  await db.categories.bulkPut([
    { id: 'c1', name: 'Makanan', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 },
    { id: 'c2', name: 'Minuman', sortOrder: 1, active: true, createdAt: 1, updatedAt: 1 },
  ])
  await db.products.bulkPut([product('kopi', 'Kopi', 20000, { categoryId: 'c2' }), product('roti', 'Roti', 30000)])
  await db.printRoutes.bulkPut([{ id: 'r1', categoryId: 'c2', station: 'bar', updatedAt: 1 }])
  await updateSettings({ businessType: 'lainnya', taxPercent: 0, serviceChargePercent: 0, roundingIncrement: 1 })
  shiftId = (await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 0 })).id
})

async function openOrder(lines: [string, number][] = [['kopi', 2]], extra: Partial<Parameters<typeof startOrder>[0]> = {}) {
  const order = await startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'Kasir', shiftId, ...extra })
  for (const [productId, qty] of lines) {
    const p = (await db.products.get(productId))!
    await addOrderItem({ orderId: order.id, productId, productName: p.name, unitPrice: p.price, qty, modifiers: [], notes: '' })
  }
  return (await db.orders.get(order.id))!
}

describe('Flag proTools', () => {
  it('aktif untuk kafe & lainnya, mati untuk kantin & minimarket', () => {
    expect(featuresForBusinessType('cafe_resto').proTools).toBe(true)
    expect(featuresForBusinessType('lainnya').proTools).toBe(true)
    expect(featuresForBusinessType('kantin').proTools).toBe(false)
    expect(featuresForBusinessType('minimarket').proTools).toBe(false)
  })
})

describe('Kecepatan dapur', () => {
  it('lama penyiapan dihitung dari waktu dikirim ke dapur sampai siap', () => {
    expect(prepMinutesOf({ kitchenPrintedAt: 10 * MIN, queuedAt: 0, createdAt: 0, readyAt: 22 * MIN, servedAt: 30 * MIN })).toBe(12)
    expect(prepMinutesOf({ kitchenPrintedAt: null, queuedAt: 5 * MIN, createdAt: 0, readyAt: null, servedAt: 25 * MIN })).toBe(20)
    expect(prepMinutesOf({ kitchenPrintedAt: null, queuedAt: 0, createdAt: 0, readyAt: null, servedAt: null })).toBeNull()
  })

  it('ketepatan waktu per stasiun & menu yang paling sering terlambat', () => {
    const speed = buildKitchenSpeed(
      [
        { productName: 'Nasi Goreng', station: 'kitchen', minutes: 10 },
        { productName: 'Nasi Goreng', station: 'kitchen', minutes: 20 },
        { productName: 'Steak', station: 'kitchen', minutes: 25 },
        { productName: 'Kopi', station: 'bar', minutes: 4 },
      ],
      15,
    )
    expect(speed.overall).toMatchObject({ count: 4, lateCount: 2, onTimePercent: 50 })
    expect(speed.overall.avgMinutes).toBe(14.8)
    expect(speed.byStation.find((s) => s.key === 'kitchen')).toMatchObject({ count: 3, lateCount: 2 })
    expect(speed.byStation.find((s) => s.key === 'bar')).toMatchObject({ count: 1, lateCount: 0, onTimePercent: 100 })
    expect(speed.lateProducts.map((p) => p.key)).toEqual(['Steak', 'Nasi Goreng'])
    // Batas dimatikan: tak ada yang disebut terlambat.
    expect(buildKitchenSpeed([{ productName: 'Steak', station: 'kitchen', minutes: 90 }], 0).overall).toMatchObject({ lateCount: 0, onTimePercent: 100 })
  })

  it('batas default 15 menit; 0 berarti dimatikan', () => {
    expect(kitchenTargetMinutesOf(undefined)).toBe(15)
    expect(kitchenTargetMinutesOf({ kitchenTargetMinutes: 0 })).toBe(0)
    expect(kitchenTargetMinutesOf({ kitchenTargetMinutes: 20 })).toBe(20)
  })

  it('pesanan yang menunggu melewati batas muncul sebagai terlambat, lalu hilang setelah siap', async () => {
    const order = await openOrder([['roti', 1], ['kopi', 1]])
    // Belum dikirim ke dapur → bukan tanggungan dapur.
    expect(await listLateKitchenOrders(Date.now() + 60 * MIN)).toEqual([])
    await sendOrderToKitchen(order.id, ACTOR)
    expect(await listLateKitchenOrders(Date.now() + 5 * MIN)).toEqual([])
    const late = await listLateKitchenOrders(Date.now() + 20 * MIN)
    expect(late).toHaveLength(1)
    expect(late[0]).toMatchObject({ orderId: order.id, itemCount: 2 })
    expect(late[0].minutes).toBeGreaterThanOrEqual(19)

    for (const item of await db.orderItems.where('orderId').equals(order.id).toArray()) await setOrderItemKitchenStatus(item.id, 'ready')
    expect(await listLateKitchenOrders(Date.now() + 20 * MIN)).toEqual([])

    await updateSettings({ kitchenTargetMinutes: 0 })
    expect(await listLateKitchenOrders(Date.now() + 200 * MIN)).toEqual([])
  })

  it('laporan memisahkan dapur & bar sesuai rute kategori', async () => {
    const order = await openOrder([['roti', 1], ['kopi', 1]])
    await sendOrderToKitchen(order.id, ACTOR)
    const items = await db.orderItems.where('orderId').equals(order.id).toArray()
    for (const item of items) {
      const sent = item.kitchenPrintedAt as number
      await db.orderItems.update(item.id, { readyAt: sent + (item.productId === 'roti' ? 22 : 3) * MIN, kitchenStatus: 'ready' })
    }
    const speed = await buildKitchenSpeedReport(ALL_TIME())
    expect(speed.targetMinutes).toBe(15)
    expect(speed.overall).toMatchObject({ count: 2, lateCount: 1 })
    expect(speed.byStation.find((s) => s.key === 'kitchen')).toMatchObject({ count: 1, avgMinutes: 22, lateCount: 1 })
    expect(speed.byStation.find((s) => s.key === 'bar')).toMatchObject({ count: 1, avgMinutes: 3, lateCount: 0 })
    expect(speed.lateProducts.map((p) => p.key)).toEqual(['Roti'])
  })
})

describe('Perputaran meja', () => {
  it('lama duduk dari buka pesanan sampai bayar, per meja', async () => {
    await db.cafeTables.bulkPut([
      { id: 't1', name: 'Meja 1', area: '', capacity: 4, status: 'available', currentOrderId: null, occupiedSince: null, guestCount: null, qrToken: null, qrActive: false, posX: null, posY: null, updatedAt: 1 },
      { id: 't2', name: 'Meja 2', area: '', capacity: 4, status: 'available', currentOrderId: null, occupiedSince: null, guestCount: null, qrToken: null, qrActive: false, posX: null, posY: null, updatedAt: 1 },
    ])
    const pay = async (tableId: string, minutes: number, guests: number) => {
      const order = await openOrder([['roti', 1]], { type: 'dine_in', tableId, guestCount: guests })
      await finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: order.grandTotal }], confirmedByUserId: 'u1' })
      const paid = (await db.orders.get(order.id))!
      await db.orders.update(order.id, { createdAt: (paid.paidAt as number) - minutes * MIN })
      await db.cafeTables.update(tableId, { status: 'available', currentOrderId: null })
    }
    await pay('t1', 40, 2)
    await pay('t1', 120, 3)
    await pay('t2', 50, 4)
    // Bawa pulang tak dihitung.
    const takeaway = await openOrder([['kopi', 1]])
    await finalizePayment({ orderId: takeaway.id, payments: [{ method: 'cash', amount: takeaway.grandTotal }], confirmedByUserId: 'u1' })

    const turnover = await buildTableTurnover({ from: Date.now() - HOUR, to: Date.now() + HOUR })
    expect(turnover.visits).toBe(3)
    expect(turnover.avgMinutes).toBe(70)
    expect(turnover.longStayMinutes).toBe(90)
    expect(turnover.longStayCount).toBe(1)
    expect(turnover.turnsPerTablePerDay).toBe(1.5)
    expect(turnover.rows[0]).toMatchObject({ tableName: 'Meja 1', visits: 2, guests: 5, avgMinutes: 80, revenue: 60000 })
    expect(turnover.rows[1]).toMatchObject({ tableName: 'Meja 2', visits: 1, avgMinutes: 50 })
  })
})

describe('Struk & ringkasan via WhatsApp', () => {
  it('struk teks memuat item, total, dan pembayaran', async () => {
    const order = await openOrder([['kopi', 2], ['roti', 1]])
    await finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: order.grandTotal, receivedAmount: 100000 }], confirmedByUserId: 'u1' })
    const paid = (await db.orders.get(order.id))!
    const data = await buildReceiptData(paid, await getSettings())
    const text = receiptToText(data)
    expect(text).toContain(paid.orderNumber)
    expect(text).toContain('2× Kopi')
    expect(text).toContain('1× Roti')
    expect(text).toMatch(/\*Total: Rp\s?70\.000\*/)
    expect(text).toMatch(/Tunai: Rp\s?100\.000/)
    expect(text).toMatch(/Kembalian: Rp\s?30\.000/)
  })

  it('ringkasan shift: omzet, selisih kas, menu terlaris, pencapaian target', async () => {
    await updateSettings({ businessName: 'Kafe Uji', salesTargets: { daily: 100000 } })
    const a = await openOrder([['kopi', 3]])
    await finalizePayment({ orderId: a.id, payments: [{ method: 'cash', amount: a.grandTotal }], confirmedByUserId: 'u1' })
    const b = await openOrder([['roti', 1]])
    await finalizePayment({ orderId: b.id, payments: [{ method: 'qris', amount: b.grandTotal }], confirmedByUserId: 'u1' })
    await closeShift({ shiftId, closingCashActual: 55000, notes: 'Uang kecil kurang' })

    expect((await getLastClosedShift())?.id).toBe(shiftId)
    const input = await buildDailySummaryInput(shiftId)
    expect(input).toMatchObject({ totalSales: 90000, transactionCount: 2, cashSales: 60000, nonCashSales: 30000, expectedCash: 60000, actualCash: 55000, variance: -5000, todaySales: 90000, dailyTarget: 100000 })
    expect(input.topProducts).toEqual([
      { name: 'Kopi', qty: 3 },
      { name: 'Roti', qty: 1 },
    ])
    const message = await buildDailySummaryMessage(shiftId)
    expect(message).toContain('Kafe Uji')
    expect(message).toMatch(/Omzet: \*Rp\s?90\.000\* \(2 transaksi\)/)
    expect(message).toMatch(/Selisih kas: \*-Rp\s?5\.000\* \(kurang\)/)
    expect(message).toContain('1. Kopi — 3×')
    expect(message).toContain('(90%)')
    expect(message).toContain('Catatan kasir: Uang kecil kurang')
  })

  it('ringkasan tanpa selisih & tanpa target tetap rapi', () => {
    const message = dailySummaryMessage({
      businessName: 'Kafe', dateLabel: '1 Jan', cashierName: 'Ani', openedLabel: '08.00', closedLabel: '16.00', totalSales: 0, transactionCount: 0, cashSales: 0, nonCashSales: 0,
      discountTotal: 0, returnTotal: 0, totalExpenses: 0, voidCount: 0, expectedCash: 100000, actualCash: 100000, variance: 0, topProducts: [],
    })
    expect(message).toContain('Selisih kas: Rp0 (cocok)')
    expect(message).not.toContain('Target')
    expect(message).not.toContain('Menu terlaris')
  })
})

describe('Gaji dari absensi', () => {
  const rows = [
    { userId: 'a', userName: 'Ani', daysPresent: 5, totalMinutes: 5 * 8 * 60 + 30, missingOutCount: 0 },
    { userId: 'b', userName: 'Budi', daysPresent: 4, totalMinutes: 4 * 7 * 60, missingOutCount: 1 },
    { userId: 'c', userName: 'Cici', daysPresent: 2, totalMinutes: 600, missingOutCount: 0 },
  ]

  it('per jam = jam kerja × tarif; per hari = hari hadir × tarif; tanpa tarif tak dihitung', () => {
    const payroll = buildPayroll(rows, { a: { name: 'Ani', type: 'hourly', rate: 20000 }, x: { name: 'budi', type: 'daily', rate: 150000 } })
    expect(payroll.rows[0]).toMatchObject({ userName: 'Ani', gross: 810000 }) // 40,5 jam
    // Tarif Budi tersimpan dengan id perangkat lain → dicocokkan lewat nama.
    expect(payroll.rows[1]).toMatchObject({ userName: 'Budi', gross: 600000 })
    expect(payroll.rows[2]).toMatchObject({ userName: 'Cici', pay: null, gross: 0 })
    expect(payroll.total).toBe(1410000)
    expect(payroll.missingRateCount).toBe(1)
    const csv = payrollToCsv(payroll, 'Bulan Ini')
    expect(csv).toContain('"Ani","Per jam","20000","5","40.50","810000",""')
    expect(csv).toContain('"Cici","","","2","10.00","0","Tarif belum diatur"')
    expect(csv).toContain('"Total","","","","","1410000",""')
  })

  it('tarif tersimpan di pengaturan; gaji dicatat sebagai pengeluaran & terlacak per periode', async () => {
    await saveStaffPay('a', { name: 'Ani', type: 'hourly', rate: 20000 }, ACTOR)
    expect((await getSettings()).staffPay).toEqual({ a: { name: 'Ani', type: 'hourly', rate: 20000 } })
    await expect(saveStaffPay('a', { name: 'Ani', type: 'hourly', rate: 0 }, ACTOR)).rejects.toThrow(/Tarif/)

    const before = (await db.shifts.get(shiftId))!.expectedCash
    await recordPayrollExpense({ userName: 'Ani', amount: 500000, periodKey: '2026-10', fromDrawer: false, actor: ACTOR })
    expect((await db.shifts.get(shiftId))!.expectedCash).toBe(before) // transfer: laci tak berubah
    await recordPayrollExpense({ userName: 'Ani', amount: 100000, periodKey: '2026-10', fromDrawer: true, actor: ACTOR })
    expect((await db.shifts.get(shiftId))!.expectedCash).toBe(before - 100000)
    await recordPayrollExpense({ userName: 'Budi', amount: 300000, periodKey: '2026-09', fromDrawer: false, actor: ACTOR })

    expect(Object.fromEntries(await listRecordedPayroll('2026-10'))).toEqual({ Ani: 600000 })
    expect(Object.fromEntries(await listRecordedPayroll('2026-09'))).toEqual({ Budi: 300000 })
    const expenses = await listExpenses()
    expect(expenses).toHaveLength(3)
    expect(expenses.every((e) => e.category === 'Gaji & Upah')).toBe(true)

    await saveStaffPay('a', null, ACTOR)
    expect((await getSettings()).staffPay).toEqual({})
  })
})

describe('Jadwal shift staf', () => {
  // 2026-10-05 adalah hari Senin.
  const roster: StaffRoster = { name: 'Ani', days: { 1: { start: '08:00', end: '16:00' }, 2: { start: '08:00', end: '16:00' }, 5: { start: '22:00', end: '06:00' } } }
  const at = (date: string, time: string) => jakartaDateTimeToEpoch(date, time)

  it('hari dalam minggu & jadwal melewati tengah malam', () => {
    expect(weekdayOfDateKey('2026-10-05')).toBe(1)
    expect(weekdayOfDateKey('2026-10-11')).toBe(0)
    expect(shiftOn(roster, '2026-10-07')).toBeNull() // Rabu libur
    const night = shiftOn(roster, '2026-10-09')! // Jumat malam
    expect(night.end - night.start).toBe(8 * HOUR)
  })

  it('terlambat dihitung setelah toleransi 10 menit', () => {
    expect(lateMinutesFor(roster, at('2026-10-05', '08:10'))).toBe(0)
    expect(lateMinutesFor(roster, at('2026-10-05', '08:25'))).toBe(25)
    expect(lateMinutesFor(roster, at('2026-10-05', '07:40'))).toBe(0)
    expect(lateMinutesFor(roster, at('2026-10-05', '19:00'))).toBe(0) // setelah jadwal berakhir: di luar jadwal
    expect(lateMinutesFor(roster, at('2026-10-07', '11:00'))).toBe(0) // tak dijadwalkan
    expect(lateMinutesFor(null, at('2026-10-05', '11:00'))).toBe(0)
  })

  it('kepatuhan: terlambat, tidak hadir, dan jadwal yang belum selesai tak dihitung', () => {
    const range = { from: at('2026-10-05', '00:00'), to: at('2026-10-11', '23:59') }
    const sessions = [{ userId: 'a', userName: 'Ani', clockIn: at('2026-10-05', '08:30') }]
    // Dinilai Selasa siang: jadwal Selasa belum selesai → belum disebut tidak hadir.
    const midTuesday = buildRosterCompliance([{ userId: 'a', userName: 'Ani' }, { userId: 'b', userName: 'Budi' }], { a: roster }, sessions, range, at('2026-10-06', '12:00'))
    expect(midTuesday).toEqual([{ userId: 'a', userName: 'Ani', scheduledDays: 1, lateCount: 1, lateMinutes: 30, absentCount: 0, absentDates: [] }])
    // Dinilai Minggu: Selasa & Jumat tanpa absen → dua kali tidak hadir.
    const sunday = buildRosterCompliance([{ userId: 'a', userName: 'Ani' }], { a: roster }, sessions, range, at('2026-10-11', '20:00'))
    expect(sunday[0]).toMatchObject({ scheduledDays: 3, lateCount: 1, absentCount: 2, absentDates: ['2026-10-06', '2026-10-09'] })
  })

  it('jadwal tersimpan; jam tak valid ditolak; semua hari kosong menghapus jadwal', async () => {
    await saveStaffRoster('a', roster, ACTOR)
    expect((await getSettings()).staffRoster?.a.days[1]).toEqual({ start: '08:00', end: '16:00' })
    await expect(saveStaffRoster('a', { name: 'Ani', days: { 1: { start: '8', end: '16:00' } } }, ACTOR)).rejects.toThrow(/JJ:MM/)
    await expect(saveStaffRoster('a', { name: 'Ani', days: { 1: { start: '08:00', end: '08:00' } } }, ACTOR)).rejects.toThrow(/sama/)
    await saveStaffRoster('a', { name: 'Ani', days: {} }, ACTOR)
    expect((await getSettings()).staffRoster).toEqual({})
  })
})

describe('Pesanan terjadwal', () => {
  const tomorrow = () => Date.now() + 24 * HOUR
  const input = (extra: Partial<Parameters<typeof createPreOrder>[0]> = {}): Parameters<typeof createPreOrder>[0] => ({
    customerName: 'Bu Sari', phone: '08123456789', reservedAt: tomorrow(), guestCount: 1, note: 'Diantar ke kantor', fulfillment: 'takeaway',
    lines: [
      { productId: 'roti', name: 'Roti', qty: 10, unitPrice: 30000, note: 'tanpa keju' },
      { productId: 'kopi', name: 'Kopi', qty: 5, unitPrice: 20000, note: '' },
    ],
    depositAmount: 150000, depositMethod: 'cash', ...extra,
  })

  it('uang muka dicatat sebagai titipan (bukan omzet) & masuk kas laci', async () => {
    const pre = await createPreOrder(input(), ACTOR)
    expect(pre.preOrder).toMatchObject({ fulfillment: 'takeaway', depositAmount: 150000 })
    expect(pre.preOrder!.depositCode).toMatch(/^GC-/)
    expect(await preOrderDepositBalance(pre)).toBe(150000)
    expect((await db.shifts.get(shiftId))!.expectedCash).toBe(150000)
    expect((await buildDepositReport(ALL_TIME())).giftCardOutstanding).toBe(150000)
    expect(await listPreOrders()).toHaveLength(1)
    // Belum jatuh tempo (besok) → belum ada pengingat; dua jam sebelumnya → ada.
    expect(await countDuePreOrders(Date.now(), Date.now() - HOUR)).toBe(0)
    expect(await countDuePreOrders(pre.reservedAt - HOUR, pre.reservedAt - 12 * HOUR)).toBe(1)
  })

  it('validasi: tanpa menu, uang muka melebihi total, tunai tanpa shift', async () => {
    await expect(createPreOrder(input({ lines: [] }), ACTOR)).rejects.toThrow(/minimal satu menu/)
    await expect(createPreOrder(input({ depositAmount: 9_000_000 }), ACTOR)).rejects.toThrow(/melebihi/)
    await expect(createPreOrder(input({ customerName: ' ' }), ACTOR)).rejects.toThrow(/Nama/)
    await closeShift({ shiftId, closingCashActual: 0, notes: '' })
    await expect(createPreOrder(input(), ACTOR)).rejects.toThrow(/Buka shift/)
    expect(await listReservations()).toHaveLength(0)
    // Non-tunai tetap bisa tanpa shift.
    expect((await createPreOrder(input({ depositMethod: 'transfer' }), ACTOR)).preOrder!.depositAmount).toBe(150000)
  })

  it('diproses: pesanan berisi menu dengan harga terkini, uang muka dipakai saat bayar', async () => {
    const pre = await createPreOrder(input(), ACTOR)
    await db.products.update('kopi', { price: 22000 }) // harga naik setelah dipesan
    const { order, skipped } = await startPreOrder(pre.id, { cashierId: 'u1', cashierName: 'Kasir', shiftId })
    expect(skipped).toEqual([])
    expect(order).toMatchObject({ type: 'takeaway', notes: 'Bu Sari', prepaidCode: pre.preOrder!.depositCode, grandTotal: 10 * 30000 + 5 * 22000 })
    const items = await db.orderItems.where('orderId').equals(order.id).toArray()
    expect(items.find((i) => i.productId === 'roti')).toMatchObject({ qty: 10, notes: 'tanpa keju' })
    expect((await db.reservations.get(pre.id))!).toMatchObject({ status: 'seated', orderId: order.id })
    await expect(startPreOrder(pre.id, { cashierId: 'u1', cashierName: 'Kasir', shiftId })).rejects.toThrow(/sudah diproses/)

    await finalizePayment({
      orderId: order.id,
      payments: [
        { method: 'giftcard', amount: 150000, reference: pre.preOrder!.depositCode as string },
        { method: 'cash', amount: order.grandTotal - 150000 },
      ],
      confirmedByUserId: 'u1',
    })
    expect((await findGiftCard(pre.preOrder!.depositCode as string))!.balance).toBe(0)
    expect((await db.orders.get(order.id))!.status).toBe('paid')
  })

  it('pilihan modifier ikut tersimpan, dihitung di perkiraan, dan terbawa ke pesanan', async () => {
    const large = { groupId: 'g1', groupName: 'Ukuran', optionId: 'o2', optionName: 'Large', priceDelta: 5000 }
    const lines = [{ productId: 'kopi', name: 'Kopi', qty: 2, unitPrice: 20000, note: 'es sedikit', modifiers: [large] }]
    expect(preOrderTotal(lines)).toBe(50000)
    expect(describePreOrderLine(lines[0])).toBe('2× Kopi (Large; es sedikit)')
    const pre = await createPreOrder(input({ lines, depositAmount: 0 }), ACTOR)
    expect(pre.preOrder!.lines[0].modifiers).toEqual([large])
    const { order } = await startPreOrder(pre.id, { cashierId: 'u1', cashierName: 'Kasir', shiftId })
    expect(order.grandTotal).toBe(50000)
    const [item] = await db.orderItems.where('orderId').equals(order.id).toArray()
    expect(item).toMatchObject({ qty: 2, notes: 'es sedikit', lineTotal: 50000, modifiers: [large] })
  })

  it('menu yang sudah diarsipkan dilewati & dilaporkan', async () => {
    const pre = await createPreOrder(input({ depositAmount: 0 }), ACTOR)
    expect(pre.preOrder!.depositCode).toBeUndefined()
    await db.products.update('kopi', { archived: true })
    const { order, skipped } = await startPreOrder(pre.id, { cashierId: 'u1', cashierName: 'Kasir', shiftId })
    expect(skipped).toEqual(['Kopi'])
    expect(order.grandTotal).toBe(300000)
    expect(order.prepaidCode ?? null).toBeNull()
  })

  it('batal: uang muka dikembalikan tunai, atau tetap tersimpan sebagai voucher', async () => {
    const a = await createPreOrder(input(), ACTOR)
    expect(await cancelPreOrder(a.id, { refundMethod: 'cash' }, ACTOR)).toEqual({ refunded: 150000 })
    expect((await db.shifts.get(shiftId))!.expectedCash).toBe(0)
    expect(await preOrderDepositBalance(a)).toBe(0)
    expect((await db.reservations.get(a.id))!.status).toBe('cancelled')

    const b = await createPreOrder(input({ customerName: 'Pak Dodi' }), ACTOR)
    expect(await cancelPreOrder(b.id, { refundMethod: null }, ACTOR)).toEqual({ refunded: 0 })
    expect(await preOrderDepositBalance(b)).toBe(150000)
    await expect(cancelPreOrder(b.id, { refundMethod: null }, ACTOR)).rejects.toThrow(/sudah diproses/)
  })
})

describe('Label menu & layar pelanggan', () => {
  it('label dinormalkan: hanya id baku, urutan baku', () => {
    expect(normalizeProductTags(['nuts', 'ngawur', 'spicy', 'nuts'])).toEqual(['spicy', 'nuts'])
    expect(productTagsOf(['dairy']).map((t) => [t.label, t.allergen])).toEqual([['Mengandung susu', true]])
    expect(productTagsOf(undefined)).toEqual([])
  })

  it('penunjuk layar pelanggan: data rusak diabaikan, yang basi tidak ditampilkan', () => {
    expect(readCustomerDisplay('bukan json')).toBeNull()
    expect(readCustomerDisplay(JSON.stringify({ orderId: 5, at: 1 }))).toBeNull()
    const pointer = readCustomerDisplay(JSON.stringify({ orderId: 'o1', stage: 'qris', amount: 50000, at: 1000 }))
    expect(pointer).toEqual({ orderId: 'o1', stage: 'qris', amount: 50000, at: 1000 })
    expect(readCustomerDisplay(JSON.stringify({ orderId: 'o1', stage: 'aneh', at: 1000 }))?.stage).toBe('order')
    expect(activeCustomerDisplay(pointer, 2000)).toEqual(pointer)
    expect(activeCustomerDisplay(pointer, 1000 + CUSTOMER_DISPLAY_STALE_MS + 1)).toBeNull()
    expect(activeCustomerDisplay({ orderId: null, stage: 'order', at: 1000 }, 2000)).toBeNull()
  })
})
