import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { enqueueSync, enqueueSyncDelete } from '@/sync/outbox'
import type { SyncPushItem } from '@/sync/client'

const pushSyncBatch = vi.fn()
const pullSyncChanges = vi.fn()

vi.mock('@/sync/client', () => ({
  isBackendConfigured: () => true,
  pushSyncBatch: (...args: unknown[]) => pushSyncBatch(...args),
  pullSyncChanges: (...args: unknown[]) => pullSyncChanges(...args),
}))

const { runSyncCycle } = await import('./engine')

beforeEach(async () => {
  await resetLocalDb()
  pushSyncBatch.mockReset()
  pullSyncChanges.mockReset()
  pushSyncBatch.mockImplementation(async (_deviceId: string, items: SyncPushItem[]) => ({
    results: items.map((i) => ({ idempotencyKey: i.idempotencyKey, status: 'accepted' })),
    serverTime: 1,
  }))
  pullSyncChanges.mockResolvedValue({ entities: {}, serverTime: 1 })
})

describe('runSyncCycle — penghapusan', () => {
  it('mengirim entri hapus dengan deleted=true, upsert tanpa flag', async () => {
    await enqueueSync('ingredients', 'i1', { id: 'i1', updatedAt: 1 })
    await enqueueSyncDelete('ingredients', 'i2')

    await runSyncCycle()

    const items = pushSyncBatch.mock.calls[0][1] as SyncPushItem[]
    expect(items.find((i) => i.entityId === 'i1')).not.toHaveProperty('deleted')
    expect(items.find((i) => i.entityId === 'i2')).toMatchObject({ entity: 'ingredients', deleted: true })
    expect(await db.syncQueue.where('status').equals('synced').count()).toBe(2)
  })

  it('menerapkan deletions dari pull; server lama tanpa field deletions tetap aman', async () => {
    await db.ingredients.put({ id: 'i9', name: 'Susu' } as never)
    pullSyncChanges.mockResolvedValueOnce({ entities: {}, deletions: { ingredients: ['i9'] }, serverTime: 2 })
    await runSyncCycle()
    expect(await db.ingredients.get('i9')).toBeUndefined()

    pullSyncChanges.mockResolvedValueOnce({ entities: {}, serverTime: 3 })
    await expect(runSyncCycle()).resolves.toBeUndefined()
  })
})

describe('runSyncCycle — kecepatan', () => {
  it('mengirim antrean besar dalam batch ≤100 item', async () => {
    for (let i = 0; i < 250; i++) await enqueueSync('categories', `c${i}`, { id: `c${i}`, updatedAt: 1 })
    await runSyncCycle()
    expect(pushSyncBatch.mock.calls.map((c) => (c[1] as SyncPushItem[]).length)).toEqual([100, 100, 50])
    expect(await db.syncQueue.where('status').equals('synced').count()).toBe(250)
  })

  it('memecah batch berisi payload besar (mis. foto) di bawah ±2 MB', async () => {
    const photo = 'x'.repeat(900 * 1024)
    for (let i = 0; i < 4; i++) await enqueueSync('products', `p${i}`, { id: `p${i}`, photoDataUrl: photo, updatedAt: 1 })
    await runSyncCycle()
    expect(pushSyncBatch.mock.calls.map((c) => (c[1] as SyncPushItem[]).length)).toEqual([2, 2])
  })

  it('HTTP 429: entri kembali pending tanpa menambah attempts', async () => {
    await enqueueSync('categories', 'c1', { id: 'c1', updatedAt: 1 })
    pushSyncBatch.mockRejectedValueOnce(Object.assign(new Error('Sinkronisasi gagal (HTTP 429)'), { status: 429 }))
    await runSyncCycle()
    const [entry] = await db.syncQueue.toArray()
    expect(entry).toMatchObject({ status: 'pending', attempts: 0 })

    await runSyncCycle()
    expect((await db.syncQueue.toArray())[0].status).toBe('synced')
  })

  it('pull berhalaman: menarik lagi selama hasMore', async () => {
    pullSyncChanges
      .mockResolvedValueOnce({ entities: {}, serverTime: 10, hasMore: true })
      .mockResolvedValueOnce({ entities: {}, serverTime: 20, hasMore: true })
      .mockResolvedValueOnce({ entities: {}, serverTime: 25 })
    await runSyncCycle()
    expect(pullSyncChanges.mock.calls.map((c) => c[0])).toEqual([expect.any(Number), 10, 20])
  })
})
