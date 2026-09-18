import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { enqueueFullResync } from './outbox'

describe('enqueueFullResync', () => {
  beforeEach(() => resetLocalDb())

  it('mendorong seluruh entitas lokal lintas tabel ke syncQueue, terlepas status sync sebelumnya', async () => {
    await db.categories.add({ id: 'c1', name: 'Kopi', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })
    await db.products.add({
      id: 'p1',
      categoryId: 'c1',
      name: 'Kopi Susu',
      sku: '',
      barcode: null,
      price: 20000,
      costPrice: 0,
      unit: 'pcs',
      photoDataUrl: null,
      trackOwnStock: false,
      stockQty: 0,
      lowStockThreshold: 0,
      isFavorite: false,
      isAvailable: true,
      modifierGroupIds: [],
      createdAt: 1,
      updatedAt: 1,
    })
    await db.cafeTables.add({
      id: 't1',
      name: 'Meja 1',
      area: '',
      capacity: 2,
      status: 'available',
      currentOrderId: null,
      occupiedSince: null,
      guestCount: null,
      qrToken: null,
      qrActive: false,
      posX: null,
      posY: null,
      updatedAt: 1,
    })

    const count = await enqueueFullResync()
    expect(count).toBe(3)

    const queued = await db.syncQueue.toArray()
    expect(queued).toHaveLength(3)
    expect(queued.every((e) => e.status === 'pending')).toBe(true)

    const byEntity = new Map(queued.map((e) => [e.entity, e]))
    expect(byEntity.get('categories')?.entityId).toBe('c1')
    expect(byEntity.get('products')?.entityId).toBe('p1')
    expect(byEntity.get('cafeTables')?.entityId).toBe('t1')
  })

  it('mengembalikan 0 tanpa menulis apa pun bila database lokal kosong', async () => {
    const count = await enqueueFullResync()
    expect(count).toBe(0)
    expect(await db.syncQueue.count()).toBe(0)
  })
})
