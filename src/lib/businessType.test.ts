import { describe, expect, it } from 'vitest'
import { BUSINESS_TYPE_ORDER, featuresForBusinessType } from './businessType'
import type { BusinessType } from '@/types/domain'

describe('featuresForBusinessType', () => {
  it('minimarket: kasir cepat (takeaway), tanpa meja, dapur, pesanan QR, pager, modifier, atau resep', () => {
    expect(featuresForBusinessType('minimarket')).toEqual({
      tables: false,
      kitchen: false,
      qrOrdering: false,
      pager: false,
      modifiers: false,
      recipes: false,
      orderTypes: ['takeaway'],
      quickSale: true,
      queueNumbers: false,
      buyerName: false,
      stackSameItems: true,
      serviceCharge: false,
      paymentMethods: ['cash', 'qris', 'transfer', 'card'],
      paymentProofMethods: [],
      ownerPinCancel: false,
      payLater: false,
      cashierControls: false,
      shiftReminder: false,
    })
  })

  it('kantin: dapur & pesanan QR aktif, tanpa meja', () => {
    const f = featuresForBusinessType('kantin')
    expect(f.tables).toBe(false)
    expect(f.kitchen).toBe(true)
    expect(f.qrOrdering).toBe(true)
    expect(f.pager).toBe(true)
    expect(f.modifiers).toBe(true)
    expect(f.recipes).toBe(true)
    expect(f.orderTypes).toEqual(['dine_in', 'takeaway'])
    expect(f.quickSale).toBe(false)
    expect(f.queueNumbers).toBe(true)
    expect(f.buyerName).toBe(true)
    expect(f.stackSameItems).toBe(true)
    expect(f.serviceCharge).toBe(false)
    expect(f.paymentMethods).toEqual(['cash', 'qris'])
    expect(f.paymentProofMethods).toEqual(['qris'])
    expect(f.shiftReminder).toBe(true)
  })

  it('cafe_resto: semua fitur aktif', () => {
    expect(featuresForBusinessType('cafe_resto')).toEqual({
      tables: true,
      kitchen: true,
      qrOrdering: true,
      pager: true,
      modifiers: true,
      recipes: true,
      orderTypes: ['dine_in', 'takeaway', 'delivery'],
      quickSale: false,
      queueNumbers: true,
      buyerName: false,
      stackSameItems: false,
      serviceCharge: true,
      // Kewajiban/pengingat khusus kantin — bukan menu yang disembunyikan.
      paymentMethods: ['cash', 'qris', 'transfer', 'card'],
      paymentProofMethods: [],
      ownerPinCancel: false,
      payLater: false,
      cashierControls: false,
      shiftReminder: false,
    })
  })

  it('lainnya & nilai tak dikenal: semua fitur aktif (jangan pernah menyembunyikan sesuatu secara diam-diam)', () => {
    expect(featuresForBusinessType('lainnya')).toEqual({
      tables: true,
      kitchen: true,
      qrOrdering: true,
      pager: true,
      modifiers: true,
      recipes: true,
      orderTypes: ['dine_in', 'takeaway', 'delivery'],
      quickSale: false,
      queueNumbers: true,
      buyerName: false,
      stackSameItems: false,
      serviceCharge: true,
      // Kewajiban/pengingat khusus kantin — bukan menu yang disembunyikan.
      paymentMethods: ['cash', 'qris', 'transfer', 'card'],
      paymentProofMethods: [],
      ownerPinCancel: false,
      payLater: false,
      cashierControls: false,
      shiftReminder: false,
    })
    expect(featuresForBusinessType('unknown_future_type' as BusinessType)).toEqual({
      tables: true,
      kitchen: true,
      qrOrdering: true,
      pager: true,
      modifiers: true,
      recipes: true,
      orderTypes: ['dine_in', 'takeaway', 'delivery'],
      quickSale: false,
      queueNumbers: true,
      buyerName: false,
      stackSameItems: false,
      serviceCharge: true,
      // Kewajiban/pengingat khusus kantin — bukan menu yang disembunyikan.
      paymentMethods: ['cash', 'qris', 'transfer', 'card'],
      paymentProofMethods: [],
      ownerPinCancel: false,
      payLater: false,
      cashierControls: false,
      shiftReminder: false,
    })
  })

  it('setiap jenis usaha di BUSINESS_TYPE_ORDER punya pemetaan fitur', () => {
    for (const t of BUSINESS_TYPE_ORDER) {
      const f = featuresForBusinessType(t)
      expect(typeof f.tables).toBe('boolean')
      expect(typeof f.kitchen).toBe('boolean')
      expect(typeof f.qrOrdering).toBe('boolean')
      expect(typeof f.pager).toBe('boolean')
      expect(f.orderTypes.length).toBeGreaterThan(0)
    }
  })
})
