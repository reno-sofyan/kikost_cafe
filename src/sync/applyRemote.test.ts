import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { applyRemoteEntities } from './applyRemote'
import { resetLocalDb } from '@/test/db'
import type { Order } from '@/types/domain'

function order(partial: Partial<Order>): Order {
  return {
    id: 'o1',
    orderNumber: 'KKP-00001',
    type: 'dine_in',
    tableId: null,
    customerId: null,
    queueNumber: null,
    guestCount: null,
    status: 'open',
    subtotal: 10000,
    discountType: null,
    discountValue: 0,
    discountAmount: 0,
    taxPercent: 0,
    taxAmount: 0,
    serviceChargePercent: 0,
    serviceChargeAmount: 0,
    roundingAdjustment: 0,
    grandTotal: 10000,
    shiftId: null,
    cashierId: 'u1',
    cashierName: 'Kasir',
    notes: '',
    idempotencyKey: 'k1',
    parentOrderId: null,
    voidReason: null,
    voidedBy: null,
    voidedAt: null,
    createdAt: 1000,
    updatedAt: 1000,
    paidAt: null,
    ...partial,
  }
}

beforeEach(async () => {
  await resetLocalDb()
})

describe('applyRemoteEntities', () => {
  it('menerapkan entitas generik dengan last-write-wins', async () => {
    await db.customers.put({ id: 'c1', name: 'Lama', phone: '', note: '', createdAt: 1, updatedAt: 100 })
    await applyRemoteEntities({
      customers: [
        { id: 'c1', name: 'Baru', phone: '08', note: '', createdAt: 1, updatedAt: 200 },
        { id: 'c2', name: 'Tambahan', phone: '', note: '', createdAt: 1, updatedAt: 50 },
      ],
    })
    expect((await db.customers.get('c1'))?.name).toBe('Baru')
    expect(await db.customers.count()).toBe(2)
  })

  it('tidak menimpa entitas lokal yang lebih baru', async () => {
    await db.customers.put({ id: 'c1', name: 'Lokal baru', phone: '', note: '', createdAt: 1, updatedAt: 500 })
    await applyRemoteEntities({
      customers: [{ id: 'c1', name: 'Server lama', phone: '', note: '', createdAt: 1, updatedAt: 100 }],
    })
    expect((await db.customers.get('c1'))?.name).toBe('Lokal baru')
  })

  it('TIDAK PERNAH menimpa pesanan lokal yang sudah final (paid/void/completed)', async () => {
    await db.orders.put(order({ status: 'paid', updatedAt: 100, paidAt: 100 }))
    await applyRemoteEntities({ orders: [order({ status: 'open', updatedAt: 99999, notes: 'dari server' })] })
    const local = await db.orders.get('o1')
    expect(local?.status).toBe('paid')
    expect(local?.notes).toBe('')
  })

  it('memperbarui pesanan lokal yang masih open bila server lebih baru', async () => {
    await db.orders.put(order({ status: 'open', updatedAt: 100 }))
    await applyRemoteEntities({ orders: [order({ status: 'open', updatedAt: 200, notes: 'update meja' })] })
    expect((await db.orders.get('o1'))?.notes).toBe('update meja')
  })
})
