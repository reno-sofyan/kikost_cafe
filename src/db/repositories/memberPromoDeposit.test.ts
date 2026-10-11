import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { addOrderItem, setOrderCustomer, setOrderVoucher, startOrder, VoucherError } from './orders'
import { openShift } from './shifts'
import { finalizePayment, voidOrder } from './checkout'
import { getSettings, updateSettings } from './settings'
import { buildReceiptData } from '@/features/printing/receiptData'
import { createCustomer } from './customers'
import { adjustCustomerPoints, getCustomerLoyalty } from './loyalty'
import { deleteKolPayout, kolCommissionLedger, recordKolPayout, saveKol, saveLoyaltySettings, savePromo } from './promos'
import { buildDepositReport, getCustomerDeposit, recordCustomerDeposit } from './deposits'
import { buildAccountingExport, ACCOUNTS } from './accounting'
import { isBirthdayAt, promoDiscountFor } from '@/lib/promos'
import { computePointsBalance, DEFAULT_LOYALTY } from '@/lib/loyalty'
import { jakartaDateKey, jakartaDateTimeToEpoch } from '@/lib/datetime'
import type { Product, Promo } from '@/types/domain'

const ACTOR = { userId: 'u1', userName: 'Kasir' }
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
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
  // "lainnya" = semua fitur tanpa kontrol kode Pemilik, supaya batal pesanan bisa diuji langsung.
  await updateSettings({ businessType: 'lainnya', taxPercent: 0, serviceChargePercent: 0, roundingIncrement: 1 })
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
const pay = async (orderId: string, method: 'cash' | 'deposit' = 'cash') => {
  const o = (await db.orders.get(orderId))!
  await finalizePayment({ orderId, payments: [{ method, amount: o.grandTotal }], confirmedByUserId: 'u1' })
  return (await db.orders.get(orderId))!
}
const member = (name: string, birthDate?: string) => createCustomer({ name, phone: '', note: '', birthDate })
const basePromo = { active: true, kind: 'percent' as const, value: 10, scope: 'order' as const, targetIds: [] as string[] }

describe('Promo beli X gratis Y', () => {
  it('tiap (beli + gratis) item yang cocok, item termurah gratis', async () => {
    await savePromo({ ...basePromo, name: 'Beli 2 Gratis 1 Kopi', kind: 'bxgy', value: 0, buyQty: 2, getQty: 1, scope: 'product', targetIds: ['kopi'] }, ACTOR)
    const order = await openOrder([['kopi', 3], ['roti', 1]])
    expect(order.appliedPromos).toEqual([expect.objectContaining({ name: 'Beli 2 Gratis 1 Kopi', amount: 20000 })])
    expect(order.grandTotal).toBe(70000)
    await addOrderItem({ orderId: order.id, productId: 'kopi', productName: 'Kopi', unitPrice: 20000, qty: 2, modifiers: [], notes: '' })
    expect((await db.orders.get(order.id))!.discountAmount).toBe(20000) // 5 kopi → masih 1 gratis
    await addOrderItem({ orderId: order.id, productId: 'kopi', productName: 'Kopi', unitPrice: 20000, qty: 1, modifiers: [], notes: '' })
    expect((await db.orders.get(order.id))!.discountAmount).toBe(40000) // 6 kopi → 2 gratis
  })

  it('campuran harga: yang gratis adalah yang termurah; kurang dari syarat = tanpa potongan', () => {
    const now = Date.now()
    const promo: Promo = { ...basePromo, id: 'p', name: 'B1G1', kind: 'bxgy', value: 0, buyQty: 1, getQty: 1, createdAt: now, updatedAt: now }
    const line = (productId: string, qty: number, price: number) => ({ productId, categoryId: 'c1', qty, lineTotal: qty * price, voided: false, removed: false })
    expect(promoDiscountFor(promo, [line('roti', 1, 30000), line('kopi', 1, 20000)])).toBe(20000)
    expect(promoDiscountFor(promo, [line('roti', 1, 30000)])).toBe(0)
    expect(promoDiscountFor({ ...promo, buyQty: 0 }, [line('kopi', 2, 20000)])).toBe(20000) // nilai tak wajar dibulatkan ke minimal 1
  })

  it('wajib mengisi jumlah beli & gratis', async () => {
    await expect(savePromo({ ...basePromo, name: 'Rusak', kind: 'bxgy', value: 0 }, ACTOR)).rejects.toThrow(/jumlah beli/i)
  })
})

describe('Syarat member pada promo & voucher', () => {
  it('promo khusus member baru terpasang setelah pelanggan dipilih', async () => {
    await savePromo({ ...basePromo, name: 'Member 10%', memberOnly: true }, ACTOR)
    const order = await openOrder()
    expect(order.appliedPromos ?? []).toEqual([])
    const c = await member('Ani')
    await setOrderCustomer(order.id, c.id)
    expect((await db.orders.get(order.id))!.discountAmount).toBe(4000)
    await setOrderCustomer(order.id, null)
    expect((await db.orders.get(order.id))!.discountAmount).toBe(0)
  })

  it('voucher sekali-per-member: butuh member, lalu ditolak pada pemakaian kedua oleh member yang sama', async () => {
    await savePromo({ ...basePromo, name: 'Voucher Baru', value: 50, voucherCode: 'BARU50', oncePerCustomer: true }, ACTOR)
    const ani = await member('Ani')
    const budi = await member('Budi')

    const tanpaMember = await openOrder()
    await expect(setOrderVoucher(tanpaMember.id, 'BARU50')).rejects.toThrow(VoucherError)
    await expect(setOrderVoucher(tanpaMember.id, 'BARU50')).rejects.toThrow(/khusus member/i)

    const pertama = await openOrder([['kopi', 2]], ani.id)
    await setOrderVoucher(pertama.id, 'baru50')
    expect((await pay(pertama.id)).discountAmount).toBe(20000)

    const kedua = await openOrder([['kopi', 2]], ani.id)
    await expect(setOrderVoucher(kedua.id, 'BARU50')).rejects.toThrow(/sudah pernah/i)
    const punyaBudi = await openOrder([['kopi', 2]], budi.id)
    await setOrderVoucher(punyaBudi.id, 'BARU50')
    expect((await db.orders.get(punyaBudi.id))!.discountAmount).toBe(20000)
  })

  it('voucher yang sudah terpasang dilepas otomatis bila membernya diganti ke yang sudah pernah memakai', async () => {
    await savePromo({ ...basePromo, name: 'Sekali', value: 50, voucherCode: 'SEKALI', oncePerCustomer: true }, ACTOR)
    const ani = await member('Ani')
    const budi = await member('Budi')
    const lama = await openOrder([['kopi', 1]], ani.id)
    await setOrderVoucher(lama.id, 'SEKALI')
    await pay(lama.id)
    const baru = await openOrder([['kopi', 2]], budi.id)
    await setOrderVoucher(baru.id, 'SEKALI')
    await setOrderCustomer(baru.id, ani.id)
    expect((await db.orders.get(baru.id))!.discountAmount).toBe(0)
  })
})

describe('Promo ulang tahun', () => {
  it('mengenali hari & bulan ulang tahun (WIB), termasuk lahir 29 Februari', () => {
    const at = (date: string) => jakartaDateTimeToEpoch(date, '10:00')
    expect(isBirthdayAt('1995-10-11', at('2026-10-11'), 'day')).toBe(true)
    expect(isBirthdayAt('1995-10-11', at('2026-10-12'), 'day')).toBe(false)
    expect(isBirthdayAt('1995-10-11', at('2026-10-30'), 'month')).toBe(true)
    expect(isBirthdayAt('1995-10-11', at('2026-11-11'), 'month')).toBe(false)
    expect(isBirthdayAt('2000-02-29', at('2027-02-28'), 'day')).toBe(true) // tahun biasa
    expect(isBirthdayAt('2000-02-29', at('2028-02-28'), 'day')).toBe(false) // tahun kabisat → 29 Feb
    expect(isBirthdayAt('2000-02-29', at('2028-02-29'), 'day')).toBe(true)
    expect(isBirthdayAt(null, at('2026-10-11'), 'month')).toBe(false)
  })

  it('terpasang otomatis di bulan lahir member, satu kali per tahun', async () => {
    await savePromo({ ...basePromo, name: 'Ulang Tahun 25%', value: 25, birthday: 'month' }, ACTOR)
    const [, month] = jakartaDateKey(Date.now()).split('-')
    const otherMonth = month === '01' ? '02' : '01'
    const ulangTahun = await member('Ani', `1990-${month}-15`)
    const bukan = await member('Budi', `1990-${otherMonth}-15`)
    const tanpaTanggal = await member('Cici')

    expect((await openOrder([['kopi', 2]], bukan.id)).discountAmount).toBe(0)
    expect((await openOrder([['kopi', 2]], tanpaTanggal.id)).discountAmount).toBe(0)
    const pertama = await openOrder([['kopi', 2]], ulangTahun.id)
    expect(pertama.appliedPromos).toEqual([expect.objectContaining({ name: 'Ulang Tahun 25%', amount: 10000 })])
    await pay(pertama.id)
    expect((await openOrder([['kopi', 2]], ulangTahun.id)).discountAmount).toBe(0)

    // Pemakaian tahun lalu tidak menghalangi tahun ini.
    await db.orders.update(pertama.id, { paidAt: Date.now() - 370 * DAY, createdAt: Date.now() - 370 * DAY })
    expect((await openOrder([['kopi', 2]], ulangTahun.id)).discountAmount).toBe(10000)
  })
})

describe('Masa berlaku poin', () => {
  const MONTH = 31 * DAY
  it('poin terlama dipakai dulu dan hangus setelah masa berlakunya', () => {
    const now = Date.now()
    // Tanpa masa berlaku: saldo = jumlah mutasi.
    expect(computePointsBalance([{ at: now - 20 * MONTH, delta: 100 }, { at: now - MONTH, delta: -30 }], 0, now)).toEqual({ balance: 70, expired: 0, nextExpiry: null })
    // 12 bulan: 100 poin lama hangus sebelum sempat ditukar; penukaran setelahnya tak menemukan apa-apa.
    const r = computePointsBalance([{ at: now - 20 * MONTH, delta: 100 }, { at: now - 2 * MONTH, delta: 50 }], 12, now)
    expect(r.balance).toBe(50)
    expect(r.expired).toBe(100)
    expect(r.nextExpiry?.points).toBe(50)
    // Penukaran sebelum hangus mengurangi poin terlama → hanya sisanya yang hangus.
    const partial = computePointsBalance([{ at: now - 20 * MONTH, delta: 100 }, { at: now - 15 * MONTH, delta: -60 }, { at: now - MONTH, delta: 10 }], 12, now)
    expect(partial).toMatchObject({ balance: 10, expired: 40 })
  })

  it('saldo member mengikuti masa berlaku; koreksi poin tercatat bertanggal', async () => {
    await saveLoyaltySettings({ ...DEFAULT_LOYALTY, enabled: true, earnPerAmount: 10000, pointValue: 500, minRedeem: 1, expiryMonths: 12 }, ACTOR)
    const c = await member('Ani')
    const lama = await pay((await openOrder([['kopi', 5]], c.id)).id) // 100.000 → 10 poin
    expect(lama.pointsEarned).toBe(10)
    await adjustCustomerPoints(c.id, 4, 'bonus', ACTOR)
    expect((await getCustomerLoyalty(c.id)).balance).toBe(14)
    expect((await db.customers.get(c.id))!.pointsLog).toEqual([expect.objectContaining({ delta: 4, reason: 'bonus' })])

    await db.orders.update(lama.id, { paidAt: Date.now() - 13 * MONTH })
    const info = await getCustomerLoyalty(c.id)
    expect(info.balance).toBe(4)
    expect(info.expired).toBe(10)
    expect(info.nextExpiry?.points).toBe(4)

    await saveLoyaltySettings({ ...DEFAULT_LOYALTY, enabled: true, earnPerAmount: 10000, pointValue: 500, minRedeem: 1, expiryMonths: 0 }, ACTOR)
    expect((await getCustomerLoyalty(c.id)).balance).toBe(14)
  })

  it('koreksi poin lama (tanpa rincian tanggal) tetap dihitung', async () => {
    await saveLoyaltySettings({ ...DEFAULT_LOYALTY, enabled: true }, ACTOR)
    const c = await member('Ani')
    await db.customers.update(c.id, { pointsAdjustment: 25 })
    expect((await getCustomerLoyalty(c.id)).balance).toBe(25)
  })
})

describe('Pembayaran komisi KOL', () => {
  it('komisi terutang = komisi dari transaksi lunas − yang sudah dibayar', async () => {
    const kol = await saveKol({ name: 'Dina', platform: 'TikTok', handle: '@dina', phone: '', commissionPercent: 10, active: true, note: '' }, ACTOR)
    await savePromo({ ...basePromo, name: 'Kode Dina', voucherCode: 'DINA10', kolId: kol.id }, ACTOR)
    const order = await openOrder([['kopi', 5]]) // 100.000 − 10% = 90.000 → komisi 9.000
    await setOrderVoucher(order.id, 'DINA10')
    await pay(order.id)
    expect((await kolCommissionLedger()).get(kol.id)).toMatchObject({ earned: 9000, paid: 0, outstanding: 9000, transactionCount: 1 })

    await expect(recordKolPayout({ kolId: kol.id, amount: 0, note: '' }, ACTOR)).rejects.toThrow(/lebih dari 0/)
    const payout = await recordKolPayout({ kolId: kol.id, amount: 5000, note: 'Transfer' }, ACTOR)
    const after = (await kolCommissionLedger()).get(kol.id)!
    expect(after).toMatchObject({ earned: 9000, paid: 5000, outstanding: 4000 })
    expect(after.payouts).toEqual([expect.objectContaining({ amount: 5000, note: 'Transfer', kolName: 'Dina', userName: 'Kasir' })])
    expect((await db.auditLogs.toArray()).some((l) => l.action === 'kol.payout')).toBe(true)

    await deleteKolPayout(payout.id, ACTOR)
    expect((await kolCommissionLedger()).get(kol.id)!.outstanding).toBe(9000)
  })
})

describe('Saldo member (deposit)', () => {
  beforeEach(async () => {
    await saveLoyaltySettings({ ...DEFAULT_LOYALTY, enabled: true, depositEnabled: true }, ACTOR)
  })
  const topUp = (customerId: string, amount: number, method: 'cash' | 'qris' = 'cash', note = '') => recordCustomerDeposit({ customerId, amount, method, note, actor: ACTOR })

  it('isi saldo tunai masuk kas shift; saldo dipakai membayar; batal pesanan mengembalikan saldo', async () => {
    const c = await member('Ani')
    await topUp(c.id, 100000)
    expect((await getCustomerDeposit(c.id)).balance).toBe(100000)
    expect((await db.shifts.get(shiftId))!.expectedCash).toBe(100000)
    expect(await db.cashMovements.toArray()).toEqual([expect.objectContaining({ type: 'in', amount: 100000, reason: 'Isi saldo member Ani' })])

    const order = await pay((await openOrder([['kopi', 2]], c.id)).id, 'deposit')
    expect(order.status).not.toBe('open')
    expect(await getCustomerDeposit(c.id)).toMatchObject({ balance: 60000, toppedUp: 100000, spent: 40000 })
    // Struk mencetak sisa saldo.
    expect((await buildReceiptData(order, await getSettings())).depositBalance).toBe(60000)
    // Membayar dengan saldo tidak menambah uang di laci.
    expect((await db.shifts.get(shiftId))!.expectedCash).toBe(100000)

    await voidOrder({ orderId: order.id, reason: 'salah input', approverUserId: 'u1', approverName: 'Kasir' })
    expect((await getCustomerDeposit(c.id)).balance).toBe(100000)
  })

  it('menolak pembayaran melebihi saldo, tanpa member, atau saat fitur dimatikan', async () => {
    const c = await member('Ani')
    await topUp(c.id, 30000, 'qris')
    expect(await db.cashMovements.count()).toBe(0) // non-tunai tak menyentuh kas laci
    const order = await openOrder([['kopi', 2]], c.id)
    await expect(pay(order.id, 'deposit')).rejects.toThrow(/tidak cukup/i)
    expect((await getCustomerDeposit(c.id)).balance).toBe(30000)
    expect((await db.orders.get(order.id))!.status).toBe('open')

    // Sebagian saldo + sisanya tunai.
    await finalizePayment({ orderId: order.id, payments: [{ method: 'deposit', amount: 30000 }, { method: 'cash', amount: 10000 }], confirmedByUserId: 'u1' })
    expect((await getCustomerDeposit(c.id)).balance).toBe(0)

    const tanpaMember = await openOrder([['kopi', 1]])
    await expect(pay(tanpaMember.id, 'deposit')).rejects.toThrow(/member/i)

    await saveLoyaltySettings({ ...DEFAULT_LOYALTY, enabled: true, depositEnabled: false }, ACTOR)
    await expect(topUp(c.id, 10000)).rejects.toThrow(/belum diaktifkan/i)
  })

  it('tarik saldo wajib alasan & tak boleh melebihi saldo; laporan & jurnal mencatatnya sebagai titipan', async () => {
    const c = await member('Ani')
    await topUp(c.id, 100000)
    await topUp(c.id, 50000, 'qris')
    await expect(topUp(c.id, -20000)).rejects.toThrow(/alasan/i)
    await expect(topUp(c.id, -500000, 'cash', 'tutup akun')).rejects.toThrow(/tidak cukup/i)
    await topUp(c.id, -20000, 'cash', 'salah isi')
    expect((await db.shifts.get(shiftId))!.expectedCash).toBe(80000)
    await pay((await openOrder([['kopi', 2]], c.id)).id, 'deposit')

    const report = await buildDepositReport(ALL_TIME())
    expect(report).toMatchObject({ topUpTotal: 150000, withdrawnTotal: 20000, usedTotal: 40000, outstanding: 90000, customersWithBalance: 1 })
    expect(report.topUpByMethod).toEqual(expect.arrayContaining([{ method: 'cash', amount: 100000, count: 1 }, { method: 'qris', amount: 50000, count: 1 }]))

    const journal = await buildAccountingExport(ALL_TIME())
    expect(journal.totals.balanced).toBe(true)
    const titipan = journal.trialBalance.find((t) => t.account === ACCOUNTS.MEMBER_DEPOSIT)!
    // Kredit: isi 150.000. Debit: tarik 20.000 + dipakai 40.000. Sisa kredit = saldo titipan 90.000.
    expect(titipan.credit - titipan.debit).toBe(90000)
  })
})
