import { describe, expect, it } from 'vitest'
import { BUSINESS_TYPE_ORDER, featuresForBusinessType } from './businessType'
import type { BusinessType } from '@/types/domain'

describe('featuresForBusinessType', () => {
  it('minimarket: tanpa meja, dapur, pesanan QR, atau pager', () => {
    expect(featuresForBusinessType('minimarket')).toEqual({
      tables: false,
      kitchen: false,
      qrOrdering: false,
      pager: false,
    })
  })

  it('kantin: dapur & pesanan QR aktif, tanpa meja', () => {
    const f = featuresForBusinessType('kantin')
    expect(f.tables).toBe(false)
    expect(f.kitchen).toBe(true)
    expect(f.qrOrdering).toBe(true)
    expect(f.pager).toBe(true)
  })

  it('cafe_resto: semua fitur aktif', () => {
    expect(featuresForBusinessType('cafe_resto')).toEqual({
      tables: true,
      kitchen: true,
      qrOrdering: true,
      pager: true,
    })
  })

  it('lainnya & nilai tak dikenal: semua fitur aktif (jangan pernah menyembunyikan sesuatu secara diam-diam)', () => {
    expect(featuresForBusinessType('lainnya')).toEqual({
      tables: true,
      kitchen: true,
      qrOrdering: true,
      pager: true,
    })
    expect(featuresForBusinessType('unknown_future_type' as BusinessType)).toEqual({
      tables: true,
      kitchen: true,
      qrOrdering: true,
      pager: true,
    })
  })

  it('setiap jenis usaha di BUSINESS_TYPE_ORDER punya pemetaan fitur', () => {
    for (const t of BUSINESS_TYPE_ORDER) {
      const f = featuresForBusinessType(t)
      expect(typeof f.tables).toBe('boolean')
      expect(typeof f.kitchen).toBe('boolean')
      expect(typeof f.qrOrdering).toBe('boolean')
      expect(typeof f.pager).toBe('boolean')
    }
  })
})
