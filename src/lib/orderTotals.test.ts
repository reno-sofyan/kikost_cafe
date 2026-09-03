import { describe, expect, it } from 'vitest'
import { computeLineTotal, computeOrderTotals, modifiersTotal } from './orderTotals'
import type { OrderItem } from '@/types/domain'

function item(partial: Partial<OrderItem>): OrderItem {
  return {
    id: partial.id ?? 'i1',
    orderId: 'o1',
    productId: 'p1',
    productName: 'Kopi',
    unitPrice: 0,
    qty: 1,
    modifiers: [],
    notes: '',
    discountAmount: 0,
    lineTotal: 0,
    kitchenStatus: 'new',
    removed: false,
    ticketId: null,
    queuedAt: null,
    startedAt: null,
    readyAt: null,
    servedAt: null,
    voided: false,
    voidReason: null,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  }
}

describe('modifiersTotal', () => {
  it('menjumlahkan priceDelta', () => {
    expect(
      modifiersTotal([
        { groupId: 'g', groupName: 'Ukuran', optionId: 'o', optionName: 'L', priceDelta: 3000 },
        { groupId: 'g', groupName: 'Topping', optionId: 'o2', optionName: 'Boba', priceDelta: 5000 },
      ]),
    ).toBe(8000)
  })
})

describe('computeLineTotal', () => {
  it('(harga + modifier) * qty - diskon, tidak negatif', () => {
    expect(
      computeLineTotal({
        unitPrice: 20000,
        qty: 2,
        modifiers: [{ groupId: 'g', groupName: 'Ukuran', optionId: 'o', optionName: 'L', priceDelta: 3000 }],
        discountAmount: 5000,
      }),
    ).toBe(41000)
  })

  it('tidak pernah di bawah nol', () => {
    expect(computeLineTotal({ unitPrice: 10000, qty: 1, modifiers: [], discountAmount: 999999 })).toBe(0)
  })
})

describe('computeOrderTotals', () => {
  const base = {
    discountType: null,
    discountValue: 0,
    taxPercent: 0,
    serviceChargePercent: 0,
    roundingIncrement: 0,
  }

  it('menjumlahkan subtotal dari item yang tidak dibatalkan', () => {
    const totals = computeOrderTotals({
      ...base,
      items: [item({ lineTotal: 15000 }), item({ id: 'i2', lineTotal: 25000 }), item({ id: 'i3', lineTotal: 9000, voided: true })],
    })
    expect(totals.subtotal).toBe(40000)
    expect(totals.grandTotal).toBe(40000)
  })

  it('menerapkan diskon persen lalu service charge lalu pajak (pajak atas base+SC)', () => {
    const totals = computeOrderTotals({
      ...base,
      items: [item({ lineTotal: 100000 })],
      discountType: 'percent',
      discountValue: 10,
      serviceChargePercent: 5,
      taxPercent: 11,
    })
    // base = 90000; SC = 4500; tax = 11% * 94500 = 10395
    expect(totals.discountAmount).toBe(10000)
    expect(totals.serviceChargeAmount).toBe(4500)
    expect(totals.taxAmount).toBe(10395)
    expect(totals.grandTotal).toBe(104895)
  })

  it('diskon nominal dibatasi tidak melebihi subtotal', () => {
    const totals = computeOrderTotals({
      ...base,
      items: [item({ lineTotal: 30000 })],
      discountType: 'amount',
      discountValue: 50000,
    })
    expect(totals.discountAmount).toBe(30000)
    expect(totals.grandTotal).toBe(0)
  })

  it('pembulatan ke kelipatan menghasilkan roundingAdjustment', () => {
    const totals = computeOrderTotals({
      ...base,
      items: [item({ lineTotal: 12345 })],
      roundingIncrement: 100,
    })
    expect(totals.grandTotal).toBe(12300)
    expect(totals.roundingAdjustment).toBe(-45)
  })
})
