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
      ownerCodeOnlineOnly: false,
      payLater: false,
      cashierControls: false,
      shiftReminder: false,
      preBill: false,
      tips: false,
      reservations: false,
      waiterTracking: false,
      onlineOrders: false,
      promos: false,
      loyalty: false,
      combos: false,
      attendance: false,
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
    expect(f.paymentMethods).toEqual(['cash', 'qris', 'transfer'])
    expect(f.paymentProofMethods).toEqual(['qris', 'transfer'])
    expect(f.shiftReminder).toBe(true)
    // Layanan meja ala restoran tak relevan di kantin.
    expect(f).toMatchObject({ preBill: false, tips: false, reservations: false, waiterTracking: false })
    expect(f.onlineOrders).toBe(false)
    expect(f).toMatchObject({ promos: false, loyalty: false, combos: false })
    // Kode pembatalan kantin hanya dari Konsol Pemilik online, bukan dari tablet.
    expect(f.ownerCodeOnlineOnly).toBe(true)
  })

  it('cafe_resto: semua fitur aktif + kode Pemilik, diskon/retur terkendali, pengingat shift', () => {
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
      paymentMethods: ['cash', 'qris', 'transfer', 'card'],
      // Foto bukti & tagihan tertunda tetap khusus kantin.
      paymentProofMethods: [],
      ownerPinCancel: true,
      ownerCodeOnlineOnly: false,
      payLater: false,
      cashierControls: true,
      shiftReminder: true,
      preBill: true,
      tips: true,
      reservations: true,
      waiterTracking: true,
      onlineOrders: true,
      promos: true,
      loyalty: true,
      combos: true,
      attendance: true,
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
      ownerCodeOnlineOnly: false,
      payLater: false,
      cashierControls: false,
      shiftReminder: false,
      preBill: true,
      tips: true,
      reservations: true,
      waiterTracking: true,
      onlineOrders: true,
      promos: true,
      loyalty: true,
      combos: true,
      attendance: true,
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
      ownerCodeOnlineOnly: false,
      payLater: false,
      cashierControls: false,
      shiftReminder: false,
      preBill: true,
      tips: true,
      reservations: true,
      waiterTracking: true,
      onlineOrders: true,
      promos: true,
      loyalty: true,
      combos: true,
      attendance: true,
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
