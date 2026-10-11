import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { addOrderItem, mergeOrders, setOrderCustomer, setOrderDiscount, setOrderPointsRedeem, setOrderVoucher, startOrder, VoucherError } from './orders'
import { openShift } from './shifts'
import { finalizePayment, voidOrder } from './checkout'
import { buildSalesReport } from './reports'
import { updateSettings } from './settings'
import { createCustomer } from './customers'
import { adjustCustomerPoints, getCustomerLoyalty } from './loyalty'
import { deleteKol, saveKol, saveLoyaltySettings, savePromo } from './promos'
import { canFulfillProductQty } from './stock'
import { evaluatePromos, isPromoActiveAt } from '@/lib/promos'
import { DEFAULT_LOYALTY, pointsEarnedFor, tierForSpend } from '@/lib/loyalty'
import { jakartaDateTimeToEpoch } from '@/lib/datetime'
import type { Product, Promo } from '@/types/domain'

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
  await db.categories.bulkPut([
    { id: 'c1', name: 'Kopi', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 },
    { id: 'c2', name: 'Makanan', sortOrder: 1, active: true, createdAt: 1, updatedAt: 1 },
  ])
  await db.products.bulkPut([product('kopi', 'Kopi', 20000), product('roti', 'Roti', 30000, { categoryId: 'c2' })])
  // Tanpa pajak/service/pembulatan supaya angka potongan mudah dibaca.
  await updateSettings({ businessType: 'cafe_resto', taxPercent: 0, serviceChargePercent: 0, roundingIncrement: 1 })
  shiftId = (await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 0 })).id
})

async function openOrder(lines: [string, number][] = [['kopi', 2]], customerId?: string) {
  const order = await startOrder({ type: 'takeaway', customerId, cashierId: 'u1', cashierName: 'Kasir', shiftId })
  for (const [productId, qty] of lines) {
    const p = (await db.products.get(productId))!
    await addOrderItem({ orderId: order.id, productId, productName: p.name, unitPrice: p.price, qty, modifiers: [], notes: '' })
  }
  return (await db.orders.get(order.id))!
}
const pay = async (orderId: string) => {
  const o = (await db.orders.get(orderId))!
  await finalizePayment({ orderId, payments: [{ method: 'cash', amount: o.grandTotal }], confirmedByUserId: 'u1' })
  return (await db.orders.get(orderId))!
}
const basePromo = { active: true, kind: 'percent' as const, value: 10, scope: 'order' as const, targetIds: [] }

describe('Promo otomatis', () => {
  it('terpasang sendiri, hanya memotong item kategori sasaran, dan dihitung ulang saat keranjang berubah', async () => {
    await savePromo({ ...basePromo, name: 'Diskon Kopi 50%', value: 50, scope: 'category', targetIds: ['c1'] }, ACTOR)
    const order = await openOrder([['kopi', 2], ['roti', 1]])
    expect(order.subtotal).toBe(70000)
    expect(order.appliedPromos).toEqual([expect.objectContaining({ name: 'Diskon Kopi 50%', amount: 20000 })])
    expect(order.discountAmount).toBe(20000)
    expect(order.grandTotal).toBe(50000)

    await addOrderItem({ orderId: order.id, productId: 'kopi', productName: 'Kopi', unitPrice: 20000, qty: 1, modifiers: [], notes: '' })
    expect((await db.orders.get(order.id))!.discountAmount).toBe(30000)
  })

  it('promo otomatis tidak ditumpuk — dipilih yang potongannya terbesar; diskon manual tetap menambah', async () => {
    await savePromo({ ...basePromo, name: 'Semua 10%' }, ACTOR)
    await savePromo({ ...basePromo, name: 'Potongan 15rb', kind: 'amount', value: 15000, minSubtotal: 40000 }, ACTOR)
    const order = await openOrder([['kopi', 2]]) // 40.000 → 10% = 4.000 vs 15.000
    expect(order.appliedPromos?.map((p) => p.name)).toEqual(['Potongan 15rb'])
    await setOrderDiscount(order.id, 'amount', 4000, { reason: 'komplain', actor: ACTOR })
    const after = (await db.orders.get(order.id))!
    expect(after.discountAmount).toBe(19000)
    expect(after.promoDiscountAmount).toBe(15000)
  })

  it('happy hour mengikuti hari & jam WIB, termasuk rentang melewati tengah malam', () => {
    const now = Date.now()
    const promo: Promo = { ...basePromo, id: 'p', name: 'HH', days: [1], startTime: '14:00', endTime: '17:00', createdAt: now, updatedAt: now }
    const monday = (t: string) => jakartaDateTimeToEpoch('2026-10-12', t) // Senin
    expect(isPromoActiveAt(promo, monday('14:00'), 'dine_in')).toBe(true)
    expect(isPromoActiveAt(promo, monday('16:59'), 'dine_in')).toBe(true)
    expect(isPromoActiveAt(promo, monday('17:00'), 'dine_in')).toBe(false)
    expect(isPromoActiveAt(promo, jakartaDateTimeToEpoch('2026-10-13', '15:00'), 'dine_in')).toBe(false)
    // Pesanan online tak ikut promo toko kecuali dipilih.
    expect(isPromoActiveAt(promo, monday('15:00'), 'delivery')).toBe(false)
    expect(isPromoActiveAt({ ...promo, orderTypes: ['delivery'] }, monday('15:00'), 'delivery')).toBe(true)
    const night = { ...promo, days: [], startTime: '22:00', endTime: '02:00' }
    expect(isPromoActiveAt(night, monday('23:30'), 'dine_in')).toBe(true)
    expect(isPromoActiveAt(night, monday('01:30'), 'dine_in')).toBe(true)
    expect(isPromoActiveAt(night, monday('12:00'), 'dine_in')).toBe(false)
  })

  it('batas maksimal potongan & promo nonaktif', () => {
    const now = Date.now()
    const items = [{ productId: 'kopi', categoryId: 'c1', lineTotal: 200000, voided: false, removed: false }]
    const promo: Promo = { ...basePromo, id: 'p', name: 'Maks', value: 50, maxDiscount: 30000, createdAt: now, updatedAt: now }
    expect(evaluatePromos({ promos: [promo], items, orderType: 'dine_in', now })[0].amount).toBe(30000)
    expect(evaluatePromos({ promos: [{ ...promo, active: false }], items, orderType: 'dine_in', now })).toEqual([])
  })

  it('pesanan yang sudah lunas membekukan promonya walau aturan berubah', async () => {
    const promo = await savePromo({ ...basePromo, name: 'Semua 10%' }, ACTOR)
    const order = await openOrder()
    const paid = await pay(order.id)
    expect(paid.grandTotal).toBe(36000)
    await savePromo({ ...promo, value: 90 }, ACTOR)
    expect((await db.orders.get(order.id))!.discountAmount).toBe(4000)
  })
})

describe('Voucher', () => {
  it('hanya terpasang lewat kode; kode salah, syarat kurang, & kuota habis ditolak dengan alasan', async () => {
    await savePromo({ ...basePromo, name: 'Voucher 20rb', kind: 'amount', value: 20000, minSubtotal: 50000, voucherCode: 'hemat20', usageLimit: 1 }, ACTOR)
    const small = await openOrder([['kopi', 1]])
    expect(small.appliedPromos ?? []).toEqual([])
    await expect(setOrderVoucher(small.id, 'SALAH')).rejects.toBeInstanceOf(VoucherError)
    await expect(setOrderVoucher(small.id, 'HEMAT20')).rejects.toThrow(/min. belanja/)

    const big = await openOrder([['roti', 2]])
    const applied = await setOrderVoucher(big.id, ' hemat20 ')
    expect(applied).toMatchObject({ voucherCode: 'HEMAT20', amount: 20000 })
    expect((await db.orders.get(big.id))!.grandTotal).toBe(40000)
    await pay(big.id)

    const next = await openOrder([['roti', 2]])
    await expect(setOrderVoucher(next.id, 'HEMAT20')).rejects.toThrow(/Kuota voucher sudah habis/)
  })

  it('voucher bisa dilepas, dan kode voucher harus unik', async () => {
    await savePromo({ ...basePromo, name: 'V1', voucherCode: 'KODE' }, ACTOR)
    await expect(savePromo({ ...basePromo, name: 'V2', voucherCode: 'kode' }, ACTOR)).rejects.toThrow(/sudah dipakai/)
    const order = await openOrder()
    await setOrderVoucher(order.id, 'KODE')
    expect((await db.orders.get(order.id))!.discountAmount).toBe(4000)
    await setOrderVoucher(order.id, null)
    expect((await db.orders.get(order.id))!.discountAmount).toBe(0)
  })
})

describe('KOL', () => {
  it('voucher KOL mencatat transaksi, omzet, potongan, & komisi KOL di laporan', async () => {
    const kol = await saveKol({ name: 'Dina', platform: 'TikTok', handle: '@dinamakan', phone: '', commissionPercent: 10, active: true, note: '' }, ACTOR)
    await savePromo({ ...basePromo, name: 'Dina 10%', voucherCode: 'DINA10', kolId: kol.id }, ACTOR)
    await expect(savePromo({ ...basePromo, name: 'Tanpa kode', kolId: kol.id }, ACTOR)).rejects.toThrow(/kode voucher/)

    const order = await openOrder([['roti', 2]]) // 60.000 → −6.000
    await setOrderVoucher(order.id, 'DINA10')
    await pay(order.id)
    await pay((await openOrder()).id) // transaksi tanpa voucher

    const report = await buildSalesReport(ALL_TIME())
    expect(report.byKol).toEqual([{ kolId: kol.id, name: 'Dina', transactionCount: 1, revenue: 54000, discount: 6000, commission: 5400 }])
    expect(report.kolCommissionTotal).toBe(5400)
    expect(report.byPromo).toEqual([expect.objectContaining({ name: 'Dina 10%', voucherCode: 'DINA10', transactionCount: 1, discount: 6000 })])
    expect(report.operatingProfit).toBe(report.grossMargin - 5400)

    // Menghapus KOL menonaktifkan vouchernya, tapi laporan lama tetap utuh.
    await deleteKol(kol.id, ACTOR)
    await expect(setOrderVoucher((await openOrder()).id, 'DINA10')).rejects.toBeInstanceOf(VoucherError)
    expect((await buildSalesReport(ALL_TIME())).byKol[0].commission).toBe(5400)
  })
})

describe('Member & poin', () => {
  beforeEach(async () => {
    await saveLoyaltySettings({ ...DEFAULT_LOYALTY, enabled: true, earnPerAmount: 10000, pointValue: 500, minRedeem: 5 }, ACTOR)
  })

  it('poin didapat saat lunas dari penjualan bersih; transaksi batal tak dihitung', async () => {
    const c = await createCustomer({ name: 'Sari', phone: '0811', note: '' })
    const paid = await pay((await openOrder([['roti', 3]], c.id)).id) // 90.000 → 9 poin
    expect(paid.pointsEarned).toBe(9)
    let info = await getCustomerLoyalty(c.id)
    expect(info).toMatchObject({ balance: 9, earned: 9, lifetimeSpend: 90000, transactionCount: 1 })
    expect(info.tier.name).toBe('Silver')

    // Pembatalan di kafe butuh kode Pemilik — di luar cakupan test ini.
    await updateSettings({ businessType: 'lainnya' })
    await voidOrder({ orderId: paid.id, reason: 'salah input', approverUserId: 'u1', approverName: 'Kasir' })
    info = await getCustomerLoyalty(c.id)
    expect(info).toMatchObject({ balance: 0, lifetimeSpend: 0 })
  })

  it('tukar poin jadi potongan; divalidasi terhadap saldo, minimal tukar, & pesanan terbuka lain', async () => {
    const c = await createCustomer({ name: 'Budi', phone: '0812', note: '' })
    await pay((await openOrder([['roti', 4]], c.id)).id) // 120.000 → 12 poin

    const order = await openOrder([['kopi', 1]], c.id)
    await expect(setOrderPointsRedeem(order.id, 3)).rejects.toThrow(/Minimal tukar 5/)
    await expect(setOrderPointsRedeem(order.id, 13)).rejects.toThrow(/tersedia 12/)
    await setOrderPointsRedeem(order.id, 8)
    expect((await db.orders.get(order.id))!).toMatchObject({ discountAmount: 4000, grandTotal: 16000, pointsRedeemed: 8, pointsRedeemValue: 500 })

    const second = await openOrder([['kopi', 1]], c.id)
    await expect(setOrderPointsRedeem(second.id, 5)).rejects.toThrow(/tersedia 4/)

    const paid = await pay(order.id)
    expect(paid.pointsEarned).toBe(1) // dari 16.000 bersih
    expect((await getCustomerLoyalty(c.id)).balance).toBe(12 - 8 + 1)

    const report = await buildSalesReport(ALL_TIME())
    expect(report).toMatchObject({ pointsEarnedTotal: 13, pointsRedeemedTotal: 8, pointsRedeemedValue: 4000, memberTransactionCount: 2 })
  })

  it('melepas pelanggan membatalkan tukar poin; pesanan tanpa pelanggan tak bisa menukar', async () => {
    const c = await createCustomer({ name: 'Ani', phone: '0813', note: '' })
    await pay((await openOrder([['roti', 4]], c.id)).id)
    const order = await openOrder([['kopi', 2]])
    await expect(setOrderPointsRedeem(order.id, 5)).rejects.toThrow(/Pilih pelanggan/)
    await setOrderCustomer(order.id, c.id)
    await setOrderPointsRedeem(order.id, 10)
    expect((await db.orders.get(order.id))!.discountAmount).toBe(5000)
    await setOrderCustomer(order.id, null)
    expect((await db.orders.get(order.id))!).toMatchObject({ discountAmount: 0, pointsRedeemed: 0, customerId: null })
  })

  it('tingkatan member mengalikan poin; koreksi manual wajib alasan & tak boleh minus', async () => {
    expect(tierForSpend(1_500_000, DEFAULT_LOYALTY).name).toBe('Gold')
    expect(pointsEarnedFor(100000, { ...DEFAULT_LOYALTY, enabled: true }, tierForSpend(1_500_000, DEFAULT_LOYALTY))).toBe(12)
    expect(pointsEarnedFor(100000, DEFAULT_LOYALTY, DEFAULT_LOYALTY.tiers[0])).toBe(0) // program nonaktif

    const c = await createCustomer({ name: 'Tia', phone: '0814', note: '' })
    await expect(adjustCustomerPoints(c.id, 10, ' ', ACTOR)).rejects.toThrow(/Alasan/)
    await adjustCustomerPoints(c.id, 10, 'bonus ulang tahun', ACTOR)
    expect((await getCustomerLoyalty(c.id)).balance).toBe(10)
    await expect(adjustCustomerPoints(c.id, -11, 'koreksi', ACTOR)).rejects.toThrow(/tidak cukup/)
  })
})

describe('Menu paket', () => {
  it('stok dipotong dari produk isi paket, bukan dari produk paketnya; HPP laporan dari isinya', async () => {
    await db.products.put(product('paket', 'Paket Hemat', 40000, { trackOwnStock: false, stockQty: 0, costPrice: 0, comboItems: [{ productId: 'kopi', qty: 1 }, { productId: 'roti', qty: 2 }] }))
    const order = await startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'Kasir', shiftId })
    await addOrderItem({
      orderId: order.id, productId: 'paket', productName: 'Paket Hemat', unitPrice: 40000, qty: 3, modifiers: [], notes: '',
      comboComponents: [{ productId: 'kopi', name: 'Kopi', qty: 1 }, { productId: 'roti', name: 'Roti', qty: 2 }],
    })
    await pay(order.id)
    expect((await db.products.get('kopi'))!.stockQty).toBe(47)
    expect((await db.products.get('roti'))!.stockQty).toBe(44)
    const report = await buildSalesReport(ALL_TIME())
    expect(report.costOfGoodsSold).toBe(3 * (5000 + 2 * 7500))
  })

  it('paket tak bisa dijual bila salah satu isinya kehabisan stok', async () => {
    const paket = product('paket', 'Paket', 40000, { trackOwnStock: false, comboItems: [{ productId: 'kopi', qty: 1 }, { productId: 'roti', qty: 2 }] })
    await db.products.put(paket)
    expect(await canFulfillProductQty(paket, 25)).toBe(true)
    expect(await canFulfillProductQty(paket, 26)).toBe(false) // roti: 26 × 2 > 50
  })
})

describe('Gabung tagihan', () => {
  it('mencatat jejak di log aktivitas dengan nomor pesanan', async () => {
    const a = await openOrder([['kopi', 1]])
    const b = await openOrder([['roti', 1]])
    await mergeOrders(a.id, b.id, ACTOR)
    expect((await db.orders.get(a.id))!.subtotal).toBe(50000)
    expect((await db.orders.get(b.id))!.voidReason).toBe(`Digabung ke pesanan ${a.orderNumber}`)
    const log = (await db.auditLogs.toArray()).find((l) => l.action === 'order.merge')
    expect(log?.details).toContain(b.orderNumber)
  })
})
