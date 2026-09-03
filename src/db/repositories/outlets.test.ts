import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { ensureDefaultSettings, getSettings } from './settings'
import { getActiveOutlet, listOutlets, saveOutlet, setActiveOutlet } from './outlets'
import { openShift } from './shifts'
import { startOrder } from './orders'

const actor = { userId: 'u1', userName: 'Admin' }

beforeEach(async () => {
  await resetLocalDb()
  await ensureDefaultSettings()
})

describe('Outlet', () => {
  it('getActiveOutlet membuat outlet default & menyetel pointer di settings', async () => {
    const outlet = await getActiveOutlet()
    expect(outlet.timezone).toBe('Asia/Jakarta')
    expect((await getSettings()).activeOutletId).toBe(outlet.id)
    // idempoten
    expect((await getActiveOutlet()).id).toBe(outlet.id)
    expect(await listOutlets()).toHaveLength(1)
  })

  it('pesanan & shift baru ditandai outlet aktif', async () => {
    const outlet = await getActiveOutlet()
    const shift = await openShift({ cashierId: 'u1', cashierName: 'K', openingCash: 0 })
    expect(shift.outletId).toBe(outlet.id)
    const order = await startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'K', shiftId: shift.id })
    expect(order.outletId).toBe(outlet.id)
  })

  it('saveOutlet baru + ganti outlet aktif; ber-audit', async () => {
    await getActiveOutlet()
    const cabang = await saveOutlet(
      { name: 'Cabang 2', address: 'Jl. B', phone: '', timezone: 'Asia/Jakarta', active: true },
      actor,
    )
    expect(await listOutlets()).toHaveLength(2)
    await setActiveOutlet(cabang.id)
    expect((await getSettings()).activeOutletId).toBe(cabang.id)
    expect(await db.auditLogs.where('action').equals('outlet.create').count()).toBe(1)
  })
})
