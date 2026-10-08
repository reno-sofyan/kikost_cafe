import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { ensureDefaultSettings, updateSettings } from './settings'
import { createUser } from './users'
import { addOrderItem, cancelUnsentOrder, startOrder } from './orders'
import { openShift } from './shifts'
import { generateCancelCode, getActiveCancelCode, verifyCancelCode } from './cancelCodes'

const consume = vi.fn()
vi.mock('@/sync/client', () => ({
  isBackendConfigured: () => true,
  consumeServerOwnerCode: (code: string) => consume(code),
}))

const actor = { userId: 'u1', userName: 'Kasir' }

beforeEach(async () => {
  consume.mockReset()
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

async function orderWithItem() {
  const shift = (await db.shifts.toArray())[0] ?? (await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 0 }))
  const order = await startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'Kasir', shiftId: shift.id })
  await addOrderItem({ orderId: order.id, productId: 'p1', productName: 'Nasi Goreng', unitPrice: 15000, qty: 1, modifiers: [], notes: '' })
  return order
}

describe('kode pembatalan dari konsol /ops (server)', () => {
  it('tanpa kode lokal: kode server membatalkan pesanan atas nama Pemilik tablet', async () => {
    const owner = await createUser({ name: 'Bu Sari', role: 'pemilik', pin: '9999' })
    consume.mockResolvedValue({ ok: true, createdAt: 123 })
    const order = await orderWithItem()

    const res = await verifyCancelCode('482913')
    expect(consume).toHaveBeenCalledWith('482913')
    if (!res.ok) throw new Error(res.reason)
    expect(res.approval).toMatchObject({ approverUserId: owner.id, approverName: 'Bu Sari', source: 'server' })

    await cancelUnsentOrder(order.id, 'Pembeli tidak jadi', actor, res.approval)
    expect(await db.orders.get(order.id)).toMatchObject({ status: 'void', voidedByName: 'Bu Sari', voidApproval: 'owner_code' })

    // Persetujuan yang sama tak bisa dipakai untuk pembatalan kedua.
    const second = await orderWithItem()
    await expect(cancelUnsentOrder(second.id, 'Salah input', actor, res.approval)).rejects.toThrow('sudah terpakai')
  })

  it('kode server tak menghanguskan kode lokal yang masih aktif', async () => {
    await createUser({ name: 'Bu Sari', role: 'pemilik', pin: '9999' })
    const owner = (await db.users.toArray())[0]
    let local = await generateCancelCode(owner)
    while (local === '482913') local = await generateCancelCode(owner)
    consume.mockResolvedValue({ ok: true, createdAt: 123 })
    const order = await orderWithItem()

    const res = await verifyCancelCode('482913')
    if (!res.ok) throw new Error(res.reason)
    await cancelUnsentOrder(order.id, 'Pembeli tidak jadi', actor, res.approval)
    expect(await getActiveCancelCode()).not.toBeNull()
  })

  it('kode lokal yang cocok tak bertanya ke server', async () => {
    const owner = await createUser({ name: 'Bu Sari', role: 'pemilik', pin: '9999' })
    const code = await generateCancelCode(owner)
    const res = await verifyCancelCode(code)
    expect(res).toMatchObject({ ok: true, approval: { source: 'local' } })
    expect(consume).not.toHaveBeenCalled()
  })

  it('salah di lokal & server → invalid', async () => {
    const owner = await createUser({ name: 'Bu Sari', role: 'pemilik', pin: '9999' })
    let local = await generateCancelCode(owner)
    while (local === '000000') local = await generateCancelCode(owner)
    consume.mockResolvedValue({ ok: false, reason: 'invalid' })
    expect(await verifyCancelCode('000000')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('server tak terjangkau → offline, tidak dihitung salah bila tak ada kode lokal', async () => {
    await createUser({ name: 'Bu Sari', role: 'pemilik', pin: '9999' })
    consume.mockRejectedValue(new TypeError('Failed to fetch'))
    for (let i = 0; i < 6; i++) expect(await verifyCancelCode('111111')).toEqual({ ok: false, reason: 'offline' })
    consume.mockResolvedValue({ ok: true, createdAt: 1 })
    expect((await verifyCancelCode('111111')).ok).toBe(true)
  })

  it('tanpa akun Pemilik: ditolak SEBELUM bertanya ke server (kode tak terbuang)', async () => {
    expect(await verifyCancelCode('482913')).toEqual({ ok: false, reason: 'owner_inactive' })
    expect(consume).not.toHaveBeenCalled()
  })

  it('server mengunci setelah banyak percobaan salah', async () => {
    await createUser({ name: 'Bu Sari', role: 'pemilik', pin: '9999' })
    consume.mockResolvedValue({ ok: false, reason: 'locked', retryInMs: 30000 })
    expect(await verifyCancelCode('482913')).toEqual({ ok: false, reason: 'locked', retryInMs: 30000 })
  })
})
