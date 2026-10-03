import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { featuresForBusinessType } from '@/lib/businessType'
import { applyRemoteEntities } from '@/sync/applyRemote'
import { ensureDefaultSettings, updateSettings } from './settings'
import { finalizePayment, payOrderBill, PaymentProofRequiredError } from './checkout'
import { ensureOrderBill, implicitBillId } from './billing'
import { addOrderItem, startOrder } from './orders'
import { openShift } from './shifts'
import type { BusinessType, Order, PaymentProof } from '@/types/domain'

const PHOTO = 'data:image/jpeg;base64,AAAA'
const proof = { photoDataUrls: [PHOTO], takenByUserId: 'u1', takenByName: 'Kasir' }

async function setBusinessType(businessType: BusinessType) {
  await ensureDefaultSettings()
  await updateSettings({ businessType })
}

beforeEach(async () => {
  await resetLocalDb()
  await db.categories.put({ id: 'c1', name: 'Umum', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })
  await db.products.put({
    id: 'p1', categoryId: 'c1', name: 'Es Teh', sku: 'T1', barcode: null, price: 5000, costPrice: 1000,
    unit: 'pcs', photoDataUrl: null, trackOwnStock: false, stockQty: 0, lowStockThreshold: 0,
    isFavorite: false, isAvailable: true, modifierGroupIds: [], createdAt: 1, updatedAt: 1,
  })
})

async function openOrder(): Promise<Order> {
  const shift = (await db.shifts.toArray())[0] ?? (await openShift({ cashierId: 'u1', cashierName: 'K', openingCash: 0 }))
  const order = await startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'K', shiftId: shift.id })
  await addOrderItem({ orderId: order.id, productId: 'p1', productName: 'Es Teh', unitPrice: 5000, qty: 1, modifiers: [], notes: '' })
  return order
}

const pay = (orderId: string, withProof: boolean) =>
  finalizePayment({
    orderId,
    payments: [{ method: 'qris', amount: 5000 }],
    confirmedByUserId: 'u1',
    proof: withProof ? proof : undefined,
  })

describe('fitur bukti pembayaran per jenis usaha', () => {
  it('hanya kantin yang mewajibkan', () => {
    expect(featuresForBusinessType('kantin').paymentProof).toBe(true)
    for (const t of ['cafe_resto', 'minimarket', 'lainnya'] as const) expect(featuresForBusinessType(t).paymentProof).toBe(false)
  })
})

describe('kantin: foto bukti wajib', () => {
  beforeEach(() => setBusinessType('kantin'))

  it('menolak pembayaran tanpa foto, dan tidak ada pembayaran yang tercatat', async () => {
    const order = await openOrder()
    await expect(pay(order.id, false)).rejects.toThrow(PaymentProofRequiredError)
    expect(await db.payments.count()).toBe(0)
    expect((await db.orders.get(order.id))?.lifecycleStatus).not.toBe('COMPLETED')
  })

  it('menyimpan foto bersama pembayaran dan mengantrekannya untuk sync', async () => {
    const order = await openOrder()
    const res = await pay(order.id, true)
    expect(res.order.lifecycleStatus).toBe('COMPLETED')

    const proofs = await db.paymentProofs.where('orderId').equals(order.id).toArray()
    expect(proofs).toHaveLength(1)
    expect(proofs[0]).toMatchObject({ photoDataUrl: PHOTO, takenByName: 'Kasir', billId: implicitBillId(order.id) })
    const queued = await db.syncQueue.where('entity').equals('paymentProofs').count()
    expect(queued).toBe(1)
  })

  it('pembayaran online dari gateway (tanpa kasir) boleh tanpa foto', async () => {
    const order = await openOrder()
    await db.transaction('rw', db.orders, db.bills, db.syncQueue, () => ensureOrderBill(order))
    const res = await payOrderBill({
      billId: implicitBillId(order.id),
      payments: [{ method: 'qris', amount: 5000 }],
      confirmedByUserId: 'online',
      skipProofCheck: true,
    })
    expect(res.order.lifecycleStatus).toBe('COMPLETED')
    expect(await db.paymentProofs.count()).toBe(0)
  })
})

describe('usaha lain: foto opsional', () => {
  it('cafe boleh bayar tanpa foto', async () => {
    await setBusinessType('cafe_resto')
    const order = await openOrder()
    expect((await pay(order.id, false)).order.lifecycleStatus).toBe('COMPLETED')
  })
})

describe('sync bukti pembayaran', () => {
  it('append-only: data server tak bisa mengganti foto yang sudah ada', async () => {
    const local: PaymentProof = {
      id: 'pp1', orderId: 'o1', billId: 'b1', photoDataUrl: PHOTO, takenByUserId: 'u1', takenByName: 'Kasir', createdAt: 1, updatedAt: 1,
    }
    await db.paymentProofs.put(local)
    await applyRemoteEntities({ paymentProofs: [{ ...local, photoDataUrl: 'data:image/jpeg;base64,BBBB', updatedAt: 99 }] })
    expect((await db.paymentProofs.get('pp1'))?.photoDataUrl).toBe(PHOTO)
  })
})
