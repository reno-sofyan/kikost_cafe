import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { addOrderItem, setOrderItemCourse, startOrder } from './orders'
import { openShift } from './shifts'
import { finalizePayment, voidOrder } from './checkout'
import { getSettings, updateSettings } from './settings'
import { createCustomer, listCustomers, searchCustomers } from './customers'
import { getCustomerLoyalty } from './loyalty'
import { bulkSetOnlinePrices } from './products'
import { sendOrderToKitchen } from './kitchenDispatch'
import { addToWaitlist, listReservations, seatReservation } from './reservations'
import { buildAttendanceReport, clockAttendance, listClockedIn, MAX_SESSION_MS, pairAttendance, WrongPinError } from './attendance'
import { buildFeedbackReport, getOrderFeedback, recordOrderFeedback } from './feedback'
import { buildDepositReport, findGiftCard, listGiftCards, sellGiftCard } from './deposits'
import { buildAccountingExport, ACCOUNTS } from './accounting'
import { createUser } from './users'
import { buildReceiptData } from '@/features/printing/receiptData'
import { markedUpPrice, productPriceFor } from '@/lib/onlineOrders'
import { buildMenuEngineering } from '@/lib/menuEngineering'
import { greetingMessage, waLink, waPhone } from '@/lib/whatsapp'
import { cycleCourse, itemsToFire } from '@/lib/courses'
import type { Product } from '@/types/domain'

const ACTOR = { userId: 'u1', userName: 'Kasir' }
const HOUR = 60 * 60 * 1000
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
  await db.categories.bulkPut([{ id: 'c1', name: 'Makanan', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 }])
  await db.products.bulkPut([product('kopi', 'Kopi', 20000), product('roti', 'Roti', 30000)])
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

describe('Harga per aplikasi & harga online massal', () => {
  it('urutan harga: khusus aplikasi → harga online → harga jual', () => {
    const p = { price: 20000, onlinePrice: 24000, platformPrices: { gofood: 25000 } }
    expect(productPriceFor(p, false, 'gofood')).toBe(20000)
    expect(productPriceFor(p, true, 'gofood')).toBe(25000)
    expect(productPriceFor(p, true, 'grabfood')).toBe(24000)
    expect(productPriceFor({ price: 20000, onlinePrice: null, platformPrices: null }, true, 'grabfood')).toBe(20000)
    expect(productPriceFor({ price: 20000, platformPrices: { gofood: 0 } }, true, 'gofood')).toBe(20000)
  })

  it('markup dibulatkan ke atas ke kelipatan yang dipilih', () => {
    expect(markedUpPrice(18000, 20, 500)).toBe(22000) // 21.600 → 22.000
    expect(markedUpPrice(20000, 20, 500)).toBe(24000)
    expect(markedUpPrice(15500, 10, 1000)).toBe(18000) // 17.050 → 18.000
  })

  it('harga online massal: melewati yang sudah diisi bila diminta; 0% mengosongkan', async () => {
    await db.products.update('roti', { onlinePrice: 40000 })
    expect(await bulkSetOnlinePrices({ percent: 20, roundTo: 500, onlyEmpty: true })).toBe(1)
    expect((await db.products.get('kopi'))!.onlinePrice).toBe(24000)
    expect((await db.products.get('roti'))!.onlinePrice).toBe(40000)
    expect(await bulkSetOnlinePrices({ percent: 20, roundTo: 500, onlyEmpty: false })).toBe(1)
    expect((await db.products.get('roti'))!.onlinePrice).toBe(36000)
    expect(await bulkSetOnlinePrices({ percent: 0, roundTo: 500, onlyEmpty: false })).toBe(2)
    expect((await db.products.get('kopi'))!.onlinePrice).toBeNull()
    await expect(bulkSetOnlinePrices({ percent: -5, roundTo: 500, onlyEmpty: false })).rejects.toThrow(/Persen/)
  })
})

describe('Analisis menu', () => {
  it('mengelompokkan menu dari kelarisan & margin per porsi', () => {
    const row = (id: string, qty: number, price: number, cost: number) => ({ productId: id, productName: id, qtySold: qty, revenue: qty * price, costTotal: qty * cost })
    const result = buildMenuEngineering([
      row('bintang', 50, 30000, 8000), // laris, margin 22rb
      row('andalan', 60, 15000, 9000), // laris, margin 6rb
      row('potensi', 5, 45000, 12000), // sepi, margin 33rb
      row('beban', 4, 12000, 8000), // sepi, margin 4rb
      row('tak-terjual', 0, 10000, 5000),
    ])
    const classOf = Object.fromEntries(result.rows.map((r) => [r.productId, r.menuClass]))
    expect(classOf).toEqual({ bintang: 'star', andalan: 'plowhorse', potensi: 'puzzle', beban: 'dog' })
    expect(result.counts).toEqual({ star: 1, plowhorse: 1, puzzle: 1, dog: 1 })
    expect(result.popularityThresholdPercent).toBeCloseTo(17.5)
    expect(result.rows[0].productId).toBe('bintang')
    expect(result.rows.reduce((s, r) => s + r.mixPercent, 0)).toBeCloseTo(100)
  })

  it('menandai menu tanpa HPP dan aman untuk data kosong', () => {
    expect(buildMenuEngineering([])).toMatchObject({ rows: [], averageMarginPerUnit: 0, missingCostCount: 0 })
    const r = buildMenuEngineering([{ productId: 'a', productName: 'A', qtySold: 3, revenue: 30000, costTotal: 0 }])
    expect(r.missingCostCount).toBe(1)
  })
})

describe('Sapaan WhatsApp & kunjungan terakhir', () => {
  it('menormalkan nomor HP Indonesia dan menolak nomor tak valid', () => {
    expect(waPhone('0812-3456-7890')).toBe('6281234567890')
    expect(waPhone('+62 812 3456 7890')).toBe('6281234567890')
    expect(waPhone('81234567890')).toBe('6281234567890')
    expect(waPhone('123')).toBe('')
    expect(waPhone('')).toBe('')
    expect(waLink('', 'hai')).toBeNull()
    expect(waLink('08123456789', 'Halo & selamat')).toBe('https://wa.me/628123456789?text=Halo%20%26%20selamat')
  })

  it('draf pesan menyertakan nama depan, nama usaha, dan kode voucher', () => {
    const msg = greetingMessage({ kind: 'winback', customerName: 'Sari Dewi', businessName: 'Kopi Kita', voucherCode: 'KANGEN10', voucherLabel: 'Diskon 10%' })
    expect(msg).toContain('Halo Sari,')
    expect(msg).toContain('Kopi Kita')
    expect(msg).toContain('*KANGEN10* (Diskon 10%)')
    expect(greetingMessage({ kind: 'birthday', customerName: '', businessName: '' })).toContain('selamat ulang tahun')
  })

  it('kunjungan terakhir = transaksi lunas terakhir member', async () => {
    const c = await createCustomer({ name: 'Ani', phone: '', note: '' })
    expect((await getCustomerLoyalty(c.id)).lastOrderAt).toBeNull()
    const order = await openOrder([['kopi', 1]], { customerId: c.id })
    await finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: order.grandTotal }], confirmedByUserId: 'u1' })
    const last = (await getCustomerLoyalty(c.id)).lastOrderAt!
    expect(Date.now() - last).toBeLessThan(HOUR)
  })

  it('target omzet tersimpan di pengaturan', async () => {
    await updateSettings({ salesTargets: { daily: 2_000_000, monthly: 50_000_000 } })
    expect((await getSettings()).salesTargets).toEqual({ daily: 2_000_000, monthly: 50_000_000 })
  })
})

describe('Urutan saji (course)', () => {
  const item = (course: number | null, sent = false) => ({ course, voided: false, removed: false, skipKitchen: false, kitchenPrintedAt: sent ? 1 : null })

  it('hanya tahap paling awal yang dilepas; item tanpa tahap selalu ikut', () => {
    const plan = itemsToFire([item(2), item(1), item(null), item(3)])
    expect(plan.course).toBe(1)
    expect(plan.fire.map((i) => i.course)).toEqual([1, null])
    expect(plan.held.map((i) => i.course)).toEqual([2, 3])
    // Pembuka sudah dikirim → giliran utama.
    expect(itemsToFire([item(1, true), item(2), item(3)]).course).toBe(2)
    expect(itemsToFire([item(null), item(null)])).toMatchObject({ course: null, held: [] })
    expect([null, 1, 2, 3].map((c) => cycleCourse(c))).toEqual([1, 2, 3, null])
  })

  it('kirim ke dapur menahan tahap berikutnya sampai dilepas; tanpa opsi, semua terkirim', async () => {
    const order = await openOrder([['kopi', 1], ['roti', 1]], { type: 'dine_in' })
    const [kopi, roti] = await db.orderItems.where('orderId').equals(order.id).sortBy('createdAt')
    await setOrderItemCourse(kopi.id, 1)
    await setOrderItemCourse(roti.id, 2)

    const first = await sendOrderToKitchen(order.id, ACTOR, { holdCourses: true })
    expect(first).toMatchObject({ itemCount: 1, course: 1, heldCount: 1 })
    expect((await db.orderItems.get(kopi.id))!.kitchenPrintedAt).not.toBeNull()
    expect((await db.orderItems.get(roti.id))!.kitchenPrintedAt).toBeNull()
    await expect(setOrderItemCourse(kopi.id, 3)).rejects.toThrow(/sudah dikirim/)

    const second = await sendOrderToKitchen(order.id, ACTOR, { holdCourses: true })
    expect(second).toMatchObject({ itemCount: 1, course: 2, heldCount: 0 })
    const labels = (await db.printJobs.toArray()).map((j) => (j.payload as { ticketLabel?: string }).ticketLabel)
    expect(labels.some((l) => l?.endsWith('— PEMBUKA'))).toBe(true)
    expect(labels.some((l) => l?.endsWith('— UTAMA'))).toBe(true)

    const lain = await openOrder([['kopi', 1], ['roti', 1]], { type: 'dine_in' })
    const items = await db.orderItems.where('orderId').equals(lain.id).toArray()
    await setOrderItemCourse(items[0].id, 3)
    expect((await sendOrderToKitchen(lain.id, ACTOR)).itemCount).toBe(2)
  })
})

describe('Daftar tunggu meja', () => {
  it('tamu masuk daftar tunggu lalu didudukkan di meja yang kosong', async () => {
    await db.cafeTables.put({ id: 't1', name: 'Meja 1', capacity: 4, status: 'available', currentOrderId: null, occupiedSince: null, guestCount: null, sortOrder: 0, createdAt: 1, updatedAt: 1 } as never)
    const waiting = await addToWaitlist({ customerName: 'Pak Budi', phone: '0812', guestCount: 3, note: '' }, ACTOR)
    expect(waiting).toMatchObject({ walkIn: true, status: 'booked', tableId: null, guestCount: 3 })
    await expect(addToWaitlist({ customerName: ' ', phone: '', guestCount: 2, note: '' }, ACTOR)).rejects.toThrow(/Nama/)

    const order = await seatReservation(waiting.id, { tableId: 't1', cashierId: 'u1', cashierName: 'Kasir', shiftId })
    expect(order).toMatchObject({ type: 'dine_in', tableId: 't1', guestCount: 3, notes: 'Pak Budi' })
    expect((await listReservations())[0]).toMatchObject({ status: 'seated', orderId: order.id })
  })
})

describe('Absensi karyawan', () => {
  const ev = (userId: string, action: 'in' | 'out', at: number) => ({ entityId: userId, userName: userId, action: `attendance.${action}`, createdAt: at })

  it('memasangkan masuk–pulang; lupa absen pulang tak dihitung jamnya', () => {
    const t0 = 1_700_000_000_000
    const sessions = pairAttendance(
      [ev('a', 'in', t0), ev('a', 'out', t0 + 8 * HOUR), ev('b', 'in', t0), ev('b', 'in', t0 + 24 * HOUR), ev('b', 'out', t0 + 30 * HOUR), ev('c', 'out', t0)],
      t0 + 40 * HOUR,
    )
    expect(sessions.filter((s) => s.userId === 'a')).toEqual([expect.objectContaining({ minutes: 480, missingOut: false })])
    const b = sessions.filter((s) => s.userId === 'b')
    expect(b).toHaveLength(2)
    expect(b[0]).toMatchObject({ clockOut: null, missingOut: true, minutes: 0 })
    expect(b[1]).toMatchObject({ minutes: 360, missingOut: false })
    expect(sessions.some((s) => s.userId === 'c')).toBe(false) // absen pulang tanpa masuk diabaikan
    // Sesi terbuka yang masih wajar = sedang bekerja, bukan lupa absen.
    expect(pairAttendance([ev('d', 'in', t0)], t0 + HOUR)[0]).toMatchObject({ clockOut: null, missingOut: false })
    expect(pairAttendance([ev('d', 'in', t0)], t0 + MAX_SESSION_MS + 1)[0].missingOut).toBe(true)
  })

  it('absen dengan PIN sendiri: masuk lalu pulang, PIN salah ditolak, tercatat di log', async () => {
    const user = await createUser({ name: 'Dewi', role: 'kasir', pin: '246810' })
    await expect(clockAttendance(user.id, '000000')).rejects.toThrow(WrongPinError)
    expect((await listClockedIn()).size).toBe(0)

    expect(await clockAttendance(user.id, '246810')).toMatchObject({ type: 'in', userName: 'Dewi' })
    expect((await listClockedIn()).has(user.id)).toBe(true)
    expect(await clockAttendance(user.id, '246810')).toMatchObject({ type: 'out' })
    expect((await listClockedIn()).size).toBe(0)

    const report = await buildAttendanceReport(ALL_TIME())
    expect(report.summary).toEqual([expect.objectContaining({ userName: 'Dewi', daysPresent: 1, sessionCount: 1, missingOutCount: 0 })])
    expect((await db.auditLogs.where('entityType').equals('attendance').toArray()).map((l) => l.action)).toEqual(expect.arrayContaining(['attendance.in', 'attendance.out']))
  })
})

describe('Penilaian tamu', () => {
  it('satu penilaian per pesanan; laporan menghitung rata-rata & menampilkan komentar', async () => {
    const a = await openOrder()
    const b = await openOrder()
    const c = await openOrder()
    await recordOrderFeedback({ orderId: a.id, rating: 5, comment: '  Enak   sekali!  ', actor: ACTOR })
    await recordOrderFeedback({ orderId: b.id, rating: 2, comment: '', actor: ACTOR })
    await recordOrderFeedback({ orderId: c.id, rating: 4, comment: '', actor: ACTOR })
    await expect(recordOrderFeedback({ orderId: a.id, rating: 1, comment: '', actor: ACTOR })).rejects.toThrow(/sudah dinilai/)
    await expect(recordOrderFeedback({ orderId: (await openOrder()).id, rating: 6, comment: '', actor: ACTOR })).rejects.toThrow(/1 sampai 5/)

    expect(await getOrderFeedback(a.id)).toMatchObject({ rating: 5, comment: 'Enak sekali!', orderNumber: a.orderNumber })
    const report = await buildFeedbackReport(ALL_TIME())
    expect(report.count).toBe(3)
    expect(report.average).toBeCloseTo(11 / 3)
    expect(report.distribution).toEqual([0, 1, 0, 1, 1])
    expect(report.satisfiedPercent).toBeCloseTo(66.67, 1)
    // Yang perlu dibaca: berkomentar atau ★≤3 — ★4 tanpa komentar tidak.
    expect(report.notable.map((f) => f.rating).sort()).toEqual([2, 5])
  })
})

describe('Voucher hadiah (gift card)', () => {
  it('dijual, ditukar bertahap, tak bisa melebihi sisa, dan pulih saat pesanan dibatalkan', async () => {
    const card = await sellGiftCard({ amount: 100000, method: 'cash', recipient: 'Rina', actor: ACTOR })
    expect(card.code).toMatch(/^GC-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(card).toMatchObject({ initialAmount: 100000, balance: 100000, recipient: 'Rina', soldBy: 'Kasir' })
    expect((await db.shifts.get(shiftId))!.expectedCash).toBe(100000)
    // Bukan pelanggan sungguhan → tak muncul di daftar pelanggan.
    expect(await listCustomers()).toEqual([])
    expect(await searchCustomers('voucher')).toEqual([])
    // Kode dicari tanpa peduli huruf kecil/tanda hubung.
    expect((await findGiftCard(card.code.toLowerCase().replace(/-/g, ' ')))?.id).toBe(card.id)
    expect(await findGiftCard('GC-TIDAK-ADA')).toBeNull()

    const order = await openOrder([['kopi', 2]]) // 40.000
    await finalizePayment({ orderId: order.id, payments: [{ method: 'giftcard', amount: 40000, reference: card.code }], confirmedByUserId: 'u1' })
    expect((await findGiftCard(card.code))!.balance).toBe(60000)
    const receipt = await buildReceiptData((await db.orders.get(order.id))!, await getSettings())
    expect(receipt.giftCardBalances).toEqual([{ code: card.code, balance: 60000 }])

    const besar = await openOrder([['roti', 3]]) // 90.000 > sisa 60.000
    await expect(finalizePayment({ orderId: besar.id, payments: [{ method: 'giftcard', amount: 90000, reference: card.code }], confirmedByUserId: 'u1' })).rejects.toThrow(/tidak cukup/i)
    await expect(finalizePayment({ orderId: besar.id, payments: [{ method: 'giftcard', amount: 10000, reference: 'GC-SALAH-KODE' }], confirmedByUserId: 'u1' })).rejects.toThrow(/tidak dikenal/i)
    await finalizePayment({ orderId: besar.id, payments: [{ method: 'giftcard', amount: 60000, reference: card.code }, { method: 'cash', amount: 30000 }], confirmedByUserId: 'u1' })
    expect((await findGiftCard(card.code))!.balance).toBe(0)

    await voidOrder({ orderId: order.id, reason: 'salah input', approverUserId: 'u1', approverName: 'Kasir' })
    expect((await findGiftCard(card.code))!.balance).toBe(40000)
  })

  it('laporan memisahkan voucher hadiah dari saldo member; jurnal tetap seimbang', async () => {
    const card = await sellGiftCard({ amount: 200000, method: 'qris', recipient: '', actor: ACTOR })
    await sellGiftCard({ amount: 50000, method: 'cash', recipient: '', actor: ACTOR })
    await expect(sellGiftCard({ amount: 0, method: 'cash', recipient: '', actor: ACTOR })).rejects.toThrow(/lebih dari 0/)
    const order = await openOrder([['roti', 1]])
    await finalizePayment({ orderId: order.id, payments: [{ method: 'giftcard', amount: 30000, reference: card.code }], confirmedByUserId: 'u1' })

    expect(await listGiftCards()).toHaveLength(2)
    expect(await buildDepositReport(ALL_TIME())).toMatchObject({
      giftCardSoldTotal: 250000, giftCardSoldCount: 2, giftCardUsedTotal: 30000, giftCardOutstanding: 220000,
      topUpTotal: 0, usedTotal: 0, outstanding: 0, customersWithBalance: 0,
    })
    const journal = await buildAccountingExport(ALL_TIME())
    expect(journal.totals.balanced).toBe(true)
    const titipan = journal.trialBalance.find((t) => t.account === ACCOUNTS.MEMBER_DEPOSIT)!
    expect(titipan.credit - titipan.debit).toBe(220000)
  })
})
