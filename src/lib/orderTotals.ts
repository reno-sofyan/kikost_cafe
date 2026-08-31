import { roundToIncrement } from '@/lib/currency'
import type { DiscountType, OrderItem, OrderItemModifierSnapshot } from '@/types/domain'

export function modifiersTotal(modifiers: OrderItemModifierSnapshot[]): number {
  return modifiers.reduce((sum, m) => sum + m.priceDelta, 0)
}

export function computeLineTotal(params: {
  unitPrice: number
  qty: number
  modifiers: OrderItemModifierSnapshot[]
  discountAmount: number
}): number {
  const gross = (params.unitPrice + modifiersTotal(params.modifiers)) * params.qty
  return Math.max(0, gross - params.discountAmount)
}

export interface OrderTotalsInput {
  items: OrderItem[]
  discountType: DiscountType | null
  discountValue: number
  taxPercent: number
  serviceChargePercent: number
  roundingIncrement: number
}

export interface OrderTotals {
  subtotal: number
  discountAmount: number
  taxAmount: number
  serviceChargeAmount: number
  roundingAdjustment: number
  grandTotal: number
}

export function computeOrderTotals(input: OrderTotalsInput): OrderTotals {
  const activeItems = input.items.filter((item) => !item.voided)
  const subtotal = activeItems.reduce((sum, item) => sum + item.lineTotal, 0)

  let discountAmount = 0
  if (input.discountType === 'percent') {
    discountAmount = (subtotal * input.discountValue) / 100
  } else if (input.discountType === 'amount') {
    discountAmount = input.discountValue
  }
  discountAmount = Math.min(Math.max(0, discountAmount), subtotal)

  const base = subtotal - discountAmount
  const serviceChargeAmount = roundHalfUp((base * input.serviceChargePercent) / 100)
  const taxAmount = roundHalfUp(((base + serviceChargeAmount) * input.taxPercent) / 100)
  const preRounding = base + serviceChargeAmount + taxAmount
  const grandTotal = roundToIncrement(preRounding, input.roundingIncrement)
  const roundingAdjustment = grandTotal - preRounding

  return {
    subtotal: roundHalfUp(subtotal),
    discountAmount: roundHalfUp(discountAmount),
    taxAmount,
    serviceChargeAmount,
    roundingAdjustment: roundHalfUp(roundingAdjustment),
    grandTotal: roundHalfUp(grandTotal),
  }
}

function roundHalfUp(value: number): number {
  return Math.round(value)
}
