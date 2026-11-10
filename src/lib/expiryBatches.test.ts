import { describe, expect, it } from 'vitest'
import { applyBatchDelta, clampBatches, daysUntil, expiryLabel, isValidDateKey, productExpiry } from './expiryBatches'
import type { ExpiryBatch } from '@/types/domain'

// 10 Nov 2026 10:00 WIB
const NOW = Date.UTC(2026, 10, 10, 3, 0, 0)
let seq = 0
const opts = (extra: Partial<Parameters<typeof applyBatchDelta>[3]> = {}) => ({ newId: () => `b${++seq}`, now: NOW, ...extra })
const batch = (id: string, expiryDate: string, qty: number, receivedAt = 1): ExpiryBatch => ({ id, expiryDate, qty, receivedAt })

describe('expiryBatches', () => {
  it('stok masuk bertanggal menambah batch; tanggal sama digabung', () => {
    let b = applyBatchDelta([], 10, 10, opts({ expiryDate: '2026-12-01' }))
    b = applyBatchDelta(b, 5, 15, opts({ expiryDate: '2026-11-20' }))
    b = applyBatchDelta(b, 2, 17, opts({ expiryDate: '2026-12-01' }))
    expect(b.map((x) => [x.expiryDate, x.qty])).toEqual([
      ['2026-11-20', 5],
      ['2026-12-01', 12],
    ])
  })

  it('stok masuk tanpa tanggal tidak membuat batch', () => {
    expect(applyBatchDelta([batch('a', '2026-12-01', 3)], 4, 7, opts())).toEqual([batch('a', '2026-12-01', 3)])
  })

  it('penjualan memotong FEFO (kedaluwarsa terdekat dulu)', () => {
    const b = applyBatchDelta([batch('late', '2027-01-01', 5), batch('soon', '2026-11-15', 3)], -4, 6, opts())
    expect(b).toEqual([batch('late', '2027-01-01', 4)])
  })

  it('waste batch tertentu memotong batch itu dulu', () => {
    const b = applyBatchDelta([batch('soon', '2026-11-15', 3), batch('late', '2027-01-01', 5)], -5, 3, opts({ batchId: 'late' }))
    expect(b).toEqual([batch('soon', '2026-11-15', 3)])
  })

  it('batch dipangkas supaya tak melebihi stok', () => {
    expect(clampBatches([batch('a', '2026-11-15', 3), batch('b', '2027-01-01', 5)], 4)).toEqual([batch('b', '2027-01-01', 4)])
    expect(clampBatches([batch('a', '2026-11-15', 3)], -2)).toEqual([])
  })

  it('status kedaluwarsa & label', () => {
    expect(daysUntil('2026-11-10', NOW)).toBe(0)
    expect(expiryLabel('2026-11-10', NOW)).toBe('Hari ini')
    expect(expiryLabel('2026-11-12', NOW)).toBe('2 Hari Lagi')
    expect(expiryLabel('2026-11-08', NOW)).toBe('Lewat 2 hari')
    expect(expiryLabel('2026-12-12', NOW)).toMatch(/12 Des 2026/)
    const e = productExpiry({ expiryBatches: [batch('x', '2026-11-08', 2), batch('y', '2026-11-20', 4)] }, NOW)
    expect(e.state).toBe('expired')
    expect(e.expiredQty).toBe(2)
    expect(productExpiry({ expiryBatches: [batch('y', '2026-11-20', 4)] }, NOW).state).toBe('near')
    expect(productExpiry({}, NOW).state).toBeNull()
  })

  it('validasi tanggal', () => {
    expect(isValidDateKey('2026-02-30')).toBe(false)
    expect(isValidDateKey('2026-02-28')).toBe(true)
    expect(isValidDateKey('')).toBe(false)
  })
})
