import { beforeEach, describe, expect, it } from 'vitest'
import { addCashMovement, closeShift, getOpenShift, listOrdersFromClosedShifts, openShift, OpenOrdersCarryOverRequiredError } from './shifts'
import { cancelEmptyOrder, startOrder } from './orders'
import { createTable } from './tables'
import { resetLocalDb } from '@/test/db'

beforeEach(async () => {
  await resetLocalDb()
})

describe('getOpenShift', () => {
  it('mengembalikan null (bukan undefined) saat belum ada shift', async () => {
    // Penting: komponen membedakan "memuat" (undefined) vs "tidak ada shift" (null).
    await expect(getOpenShift()).resolves.toBeNull()
  })

  it('mengembalikan shift yang berjalan', async () => {
    const s = await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 100000 })
    const open = await getOpenShift()
    expect(open?.id).toBe(s.id)
    expect(open?.status).toBe('open')
  })
})

describe('openShift', () => {
  it('menolak membuka shift kedua saat masih ada yang berjalan', async () => {
    await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 100000 })
    await expect(openShift({ cashierId: 'u2', cashierName: 'Kasir 2', openingCash: 50000 })).rejects.toThrow()
  })

  it('expectedCash awal = modal awal', async () => {
    const s = await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 250000 })
    expect(s.expectedCash).toBe(250000)
  })
})

describe('addCashMovement', () => {
  it('kas masuk menambah expectedCash, kas keluar mengurangi', async () => {
    const s = await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 100000 })
    await addCashMovement({ shiftId: s.id, type: 'in', amount: 30000, reason: 'top up', userId: 'u1' })
    await addCashMovement({ shiftId: s.id, type: 'out', amount: 10000, reason: 'beli galon', userId: 'u1' })
    expect((await getOpenShift())?.expectedCash).toBe(120000)
  })
})

describe('closeShift + pesanan kosong', () => {
  it('pesanan terbuka KOSONG (dibuat tapi tak pernah diisi item) butuh konfirmasi untuk tutup shift', async () => {
    const s = await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 100000 })
    await startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'Kasir', shiftId: s.id })
    await expect(closeShift({ shiftId: s.id, closingCashActual: 100000, notes: '' })).rejects.toThrow(OpenOrdersCarryOverRequiredError)
  })

  it('cancelEmptyOrder membatalkan pesanan kosong itu → shift bisa ditutup', async () => {
    const s = await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 100000 })
    const order = await startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'Kasir', shiftId: s.id })
    await cancelEmptyOrder(order.id, { userId: 'u1', userName: 'Kasir' })
    const closed = await closeShift({ shiftId: s.id, closingCashActual: 100000, notes: '' })
    expect(closed.status).toBe('closed')
  })

  it('cancelEmptyOrder pada meja dine-in melepas meja kembali ke available', async () => {
    const s = await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 100000 })
    const table = await createTable({ name: 'Meja 1', area: '', capacity: 2 })
    const order = await startOrder({ type: 'dine_in', tableId: table.id, cashierId: 'u1', cashierName: 'Kasir', shiftId: s.id })
    await cancelEmptyOrder(order.id, { userId: 'u1', userName: 'Kasir' })
    const { db } = await import('@/db/schema')
    const refreshed = await db.cafeTables.get(table.id)
    expect(refreshed?.status).toBe('available')
    expect(refreshed?.currentOrderId).toBeNull()
  })

  it('cancelEmptyOrder menolak pesanan yang masih punya item aktif', async () => {
    const s = await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 100000 })
    const order = await startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'Kasir', shiftId: s.id })
    const { addOrderItem } = await import('./orders')
    await addOrderItem({ orderId: order.id, productId: 'p1', productName: 'Kopi', unitPrice: 20000, qty: 1, modifiers: [], notes: '' })
    await expect(cancelEmptyOrder(order.id, { userId: 'u1', userName: 'Kasir' })).rejects.toThrow('masih berisi item')
  })
})

describe('closeShift + pesanan terbuka terbawa', () => {
  async function shiftWithOpenOrder() {
    const s = await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 100000 })
    const order = await startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'Kasir', shiftId: s.id })
    const { addOrderItem } = await import('./orders')
    await addOrderItem({ orderId: order.id, productId: 'p1', productName: 'Kopi', unitPrice: 20000, qty: 1, modifiers: [], notes: '' })
    return { s, order }
  }

  it('dengan konfirmasi, shift tertutup & pesanan tetap terbuka lalu diingatkan di shift baru', async () => {
    const { s, order } = await shiftWithOpenOrder()
    const closed = await closeShift({ shiftId: s.id, closingCashActual: 100000, notes: '', carryOverOpenOrders: true })
    expect(closed.status).toBe('closed')
    const carried = await listOrdersFromClosedShifts()
    expect(carried.map((o) => o.id)).toEqual([order.id])
    const { db } = await import('@/db/schema')
    expect((await db.auditLogs.where('action').equals('shift.close.carryOver').count())).toBe(1)
  })

  it('pelunasan di shift baru memindahkan pesanan & kas tunai ke shift baru', async () => {
    const { s, order } = await shiftWithOpenOrder()
    await closeShift({ shiftId: s.id, closingCashActual: 100000, notes: '', carryOverOpenOrders: true })
    const { finalizePayment } = await import('./checkout')
    const { db } = await import('@/db/schema')
    const fresh = (await db.orders.get(order.id))!

    await expect(
      finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: fresh.grandTotal }], confirmedByUserId: 'u1' }),
    ).rejects.toThrow('Buka shift baru')

    const next = await openShift({ cashierId: 'u2', cashierName: 'Kasir 2', openingCash: 50000 })
    await finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: fresh.grandTotal }], confirmedByUserId: 'u2' })
    const paid = await db.orders.get(order.id)
    expect(paid?.status).toBe('paid')
    expect(paid?.shiftId).toBe(next.id)
    expect((await db.shifts.get(next.id))?.expectedCash).toBe(50000 + fresh.grandTotal)
    expect((await db.shifts.get(s.id))?.expectedCash).toBe(100000)
    await expect(listOrdersFromClosedShifts()).resolves.toEqual([])
  })

  it('pesanan yang sudah dibayar sebagian tetap memblokir tutup shift', async () => {
    const { s, order } = await shiftWithOpenOrder()
    const { finalizePayment } = await import('./checkout')
    await finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: 5000 }], confirmedByUserId: 'u1', allowPartial: true })
    await expect(
      closeShift({ shiftId: s.id, closingCashActual: 105000, notes: '', carryOverOpenOrders: true }),
    ).rejects.toThrow('sudah dibayar sebagian')
  })
})
