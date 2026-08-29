import { beforeEach, describe, expect, it } from 'vitest'
import { addCashMovement, getOpenShift, openShift } from './shifts'
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
