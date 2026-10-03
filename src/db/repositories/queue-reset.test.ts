import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { ensureDefaultSettings } from './settings'
import { drawQueueNumber, resetQueueNumbers, startOrder } from './orders'
import { openShift } from './shifts'

const actor = { userId: 'u1', userName: 'Admin' }

beforeEach(async () => {
  await resetLocalDb()
  await ensureDefaultSettings()
})

async function newOrder() {
  const shift = (await db.shifts.toArray())[0] ?? (await openShift({ cashierId: 'u1', cashierName: 'K', openingCash: 0 }))
  return startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'K', shiftId: shift.id })
}

describe('reset nomor antrean', () => {
  it('setelah reset, pesanan berikutnya kembali #1 lalu berlanjut #2', async () => {
    expect((await newOrder()).queueNumber).toBe(1)
    expect((await newOrder()).queueNumber).toBe(2)
    expect((await newOrder()).queueNumber).toBe(3)

    await resetQueueNumbers(actor)

    expect(await drawQueueNumber()).toBe(1)
    expect((await newOrder()).queueNumber).toBe(1)
    expect((await newOrder()).queueNumber).toBe(2)
  })

  it('nomor pesanan lama tidak berubah & reset tercatat di audit log', async () => {
    const old = await newOrder()
    await newOrder()
    await resetQueueNumbers(actor)

    expect((await db.orders.get(old.id))?.queueNumber).toBe(1)
    const log = (await db.auditLogs.toArray()).find((l) => l.action === 'queue.reset')
    expect(log?.details).toContain('sampai #2')
  })

  it('reset ikut disinkronkan lewat pengaturan', async () => {
    await resetQueueNumbers(actor)
    const settings = await db.settings.get('singleton')
    expect(settings?.queueResetAt).toBeGreaterThan(0)
    expect(await db.syncQueue.where('entity').equals('settings').count()).toBeGreaterThan(0)
  })
})
