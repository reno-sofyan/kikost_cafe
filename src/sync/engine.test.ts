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
