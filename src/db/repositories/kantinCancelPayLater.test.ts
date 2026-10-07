import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { featuresForBusinessType } from '@/lib/businessType'
import { ensureDefaultSettings, updateSettings } from './settings'
import { createUser } from './users'
import { addOrderItem, cancelUnsentOrder, markOrderPayLater, startOrder } from './orders'
import { closeShift, openShift } from './shifts'
import { finalizePayment, voidOrder } from './checkout'
import { generateCancelCode, getActiveCancelCode, OwnerApprovalRequiredError, verifyCancelCode, type OwnerApproval } from './cancelCodes'
import type { Order, Shift, User } from '@/types/domain'

const actor = { userId: 'u1', userName: 'Kasir' }

beforeEach(async () => {
  await resetLocalDb()
  localStorage.clear()
  await ensureDefaultSettings()
  await updateSettings({ businessType: 'kantin' })
  await db.categories.put({ id: 'c1', name: 'Umum', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })
  await db.products.put({
    id: 'p1', categoryId: 'c1', name: 'Nasi Goreng', sku: 'N1', barcode: null, price: 15000, costPrice: 5000,
    unit: 'pcs', photoDataUrl: null, trackOwnStock: false, stockQty: 0, lowStockThreshold: 0,
    isFavorite: false, isAvailable: true, modifierGroupIds: [], createdAt: 1, updatedAt: 1,
  })
})

async function orderWithItem(shift?: Shift): Promise<Order> {
  const s = shift ?? (await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 0 }))
  const order = await startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'Kasir', shiftId: s.id })
  await addOrderItem({ orderId: order.id, productId: 'p1', productName: 'Nasi Goreng', unitPrice: 15000, qty: 1, modifiers: [], notes: '' })
  return order
}

async function approvalFrom(owner: User): Promise<OwnerApproval> {
  const code = await generateCancelCode(owner)
  const res = await verifyCancelCode(code)
  if (!res.ok) throw new Error(`verifikasi gagal: ${res.reason}`)
  return res.approval
}

describe('flag kantin', () => {
  it('ownerPinCancel & payLater hanya untuk kantin', () => {
    expect(featuresForBusinessType('kantin')).toMatchObject({ ownerPinCancel: true, payLater: true })
    for (const t of ['cafe_resto', 'minimarket', 'lainnya'] as const) {
      expect(featuresForBusinessType(t)).toMatchObject({ ownerPinCancel: false, payLater: false })
    }
  })
})

describe('kode pembatalan sekali pakai (kantin)', () => {
  it('hanya Pemilik yang bisa membuat kode', async () => {
    const admin = await createUser({ name: 'Admin', role: 'administrator', pin: '1111' })
    await expect(generateCancelCode(admin)).rejects.toThrow('Pemilik')
  })

  it('pembatalan tanpa kode ditolak, walau alasan diisi', async () => {
    const order = await orderWithItem()
    await expect(cancelUnsentOrder(order.id, 'Salah input', actor)).rejects.toThrow(OwnerApprovalRequiredError)
    await expect(voidOrder({ orderId: order.id, reason: 'x', approverUserId: 's1', approverName: 'Sup' })).rejects.toThrow(
      OwnerApprovalRequiredError,
    )
    expect((await db.orders.get(order.id))?.status).toBe('open')
  })

  it('kode benar membatalkan pesanan atas nama Pemilik lalu hangus', async () => {
    const owner = await createUser({ name: 'Bu Sari', role: 'pemilik', pin: '9999' })
    const order = await orderWithItem()
    const approval = await approvalFrom(owner)
    await cancelUnsentOrder(order.id, 'Pembeli tidak jadi', actor, approval)

    expect(await db.orders.get(order.id)).toMatchObject({
      status: 'void',
      voidReason: 'Pembeli tidak jadi',
      voidedBy: owner.id,
      voidedByName: 'Bu Sari',
      voidRequestedByName: 'Kasir',
      voidApproval: 'owner_code',
    })
    expect(await getActiveCancelCode()).toBeNull()
    const log = (await db.auditLogs.toArray()).find((l) => l.action === 'order.cancel')
    expect(log?.details).toContain('Bu Sari')

    // Kode yang sama tak bisa dipakai untuk pembatalan kedua.
    const second = await orderWithItem((await db.shifts.toArray())[0])
    await expect(cancelUnsentOrder(second.id, 'Salah input', actor, approval)).rejects.toThrow('sudah terpakai')
    expect((await db.orders.get(second.id))?.status).toBe('open')
  })

  it('kode salah ditolak; membuat kode baru menghanguskan kode lama', async () => {
    const owner = await createUser({ name: 'Bu Sari', role: 'pemilik', pin: '9999' })
    const oldCode = await generateCancelCode(owner)
    const newCode = await generateCancelCode(owner)
    if (oldCode !== newCode) expect(await verifyCancelCode(oldCode)).toMatchObject({ ok: false, reason: 'invalid' })
    expect(await verifyCancelCode(newCode)).toMatchObject({ ok: true })
  })

  it('kode tidak disimpan polos dan tidak ikut antrean sinkronisasi', async () => {
    const owner = await createUser({ name: 'Bu Sari', role: 'pemilik', pin: '9999' })
    const code = await generateCancelCode(owner)
    const row = await db.cancelCodes.get('active')
    expect(JSON.stringify(row)).not.toContain(`"${code}"`)
    expect(await db.syncQueue.where('entity').equals('cancelCodes').count()).toBe(0)
    const log = (await db.auditLogs.toArray()).find((l) => l.action === 'cancel_code.generate')
    expect(log?.details).not.toContain(code)
  })

  it('transaksi lunas juga butuh kode', async () => {
    const owner = await createUser({ name: 'Bu Sari', role: 'pemilik', pin: '9999' })
    const order = await orderWithItem()
    await finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: 15000 }], confirmedByUserId: 'u1' })
    const approval = await approvalFrom(owner)
    await voidOrder({
      orderId: order.id,
      reason: 'Komplain',
      approverUserId: approval.approverUserId,
      approverName: approval.approverName,
      ownerApproval: approval,
      requestedBy: actor,
    })
    expect(await db.orders.get(order.id)).toMatchObject({
      lifecycleStatus: 'VOIDED',
      voidedByName: 'Bu Sari',
      voidRequestedByName: 'Kasir',
      voidApproval: 'owner_code',
    })
    const log = (await db.auditLogs.toArray()).find((l) => l.action === 'order.void')
    expect(log?.details).toContain('Diminta oleh: Kasir')
  })

  it('usaha lain tetap memakai alur lama (tanpa kode)', async () => {
    await updateSettings({ businessType: 'cafe_resto' })
    const order = await orderWithItem()
    await cancelUnsentOrder(order.id, 'Salah input', actor)
    expect((await db.orders.get(order.id))?.status).toBe('void')
  })
})

describe('bill gantung (kantin)', () => {
  it('nama wajib & pesanan kosong ditolak', async () => {
    const shift = await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 0 })
    const order = await orderWithItem(shift)
    await expect(markOrderPayLater(order.id, { name: '  ', note: '', shiftId: shift.id }, actor)).rejects.toThrow('Nama')
    const empty = await startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'Kasir', shiftId: shift.id })
    await expect(markOrderPayLater(empty.id, { name: 'Budi', note: '', shiftId: shift.id }, actor)).rejects.toThrow('kosong')
  })

  it('tidak menghalangi tutup shift, dan pelunasan masuk ke shift yang sedang buka', async () => {
    const shiftA = await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 0 })
    const order = await orderWithItem(shiftA)
    await markOrderPayLater(order.id, { name: 'Pak Budi (Gudang)', note: 'gajian', shiftId: shiftA.id }, actor)
    expect(await db.syncQueue.where('entity').equals('orders').count()).toBeGreaterThan(0)

    await closeShift({ shiftId: shiftA.id, closingCashActual: 0, notes: '' })
    expect((await db.shifts.get(shiftA.id))?.status).toBe('closed')

    const shiftB = await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 0 })
    const res = await finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: 15000 }], confirmedByUserId: 'u1' })

    expect(res.order).toMatchObject({ lifecycleStatus: 'COMPLETED', shiftId: shiftB.id })
    expect(res.order.payLater).toMatchObject({ name: 'Pak Budi (Gudang)', shiftId: shiftA.id })
    expect((await db.shifts.get(shiftB.id))?.expectedCash).toBe(15000)
    expect((await db.shifts.get(shiftA.id))?.expectedCash).toBe(0)
  })

  it('pesanan terbuka biasa tetap menghalangi tutup shift', async () => {
    const shift = await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 0 })
    await orderWithItem(shift)
    await expect(closeShift({ shiftId: shift.id, closingCashActual: 0, notes: '' })).rejects.toThrow('open bill')
  })
})
