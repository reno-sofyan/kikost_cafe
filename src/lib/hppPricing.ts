import { computeLineTotal } from '@/lib/orderTotals'
import type { HppPricing, HppPricingKind, OrderItem, Product } from '@/types/domain'

/**
 * Pesanan KOL / Compliment (kafe): tamu membayar seharga HPP (harga pokok), bukan
 * harga jual. Semua item dihargai HPP produknya, tambahan (modifier) dan diskon item
 * dinolkan, dan harga jual semula disimpan di `normalPrice` supaya bisa dikembalikan
 * dan dilaporkan sebagai "nilai jual".
 */

export const HPP_PRICING_LABELS: Record<HppPricingKind, string> = { kol: 'KOL', compliment: 'Compliment' }

export class HppPricingBlockedError extends Error {
  constructor(what: string) {
    super(`${what} tidak bisa dipakai pada pesanan KOL/Compliment (harga sudah HPP).`)
    this.name = 'HppPricingBlockedError'
  }
}

/** HPP satu produk: harga pokoknya, atau jumlah HPP isi paket bila produk paket tanpa HPP sendiri. */
export function productHpp(product: Pick<Product, 'costPrice' | 'comboItems'> | undefined, componentCost: (productId: string) => number): number {
  if (!product) return 0
  if (product.costPrice > 0) return Math.round(product.costPrice)
  return Math.round((product.comboItems ?? []).reduce((s, c) => s + componentCost(c.productId) * c.qty, 0))
}

type PricedFields = Pick<OrderItem, 'unitPrice' | 'modifiers' | 'discountAmount' | 'lineTotal' | 'normalPrice'>

/** Perubahan item agar dihargai HPP (idempoten: harga normal hanya direkam sekali). */
export function hppItemPatch(item: Pick<OrderItem, 'unitPrice' | 'qty' | 'modifiers' | 'discountAmount' | 'normalPrice'>, hpp: number): PricedFields {
  const normalPrice = item.normalPrice ?? { unitPrice: item.unitPrice, modifierDeltas: item.modifiers.map((m) => m.priceDelta), discountAmount: item.discountAmount }
  const modifiers = item.modifiers.map((m) => ({ ...m, priceDelta: 0 }))
  return { unitPrice: hpp, modifiers, discountAmount: 0, lineTotal: computeLineTotal({ unitPrice: hpp, qty: item.qty, modifiers, discountAmount: 0 }), normalPrice }
}

/** Mengembalikan item ke harga jual semula (kebalikan `hppItemPatch`). */
export function normalItemPatch(item: Pick<OrderItem, 'qty' | 'modifiers' | 'normalPrice' | 'unitPrice' | 'discountAmount'>): PricedFields {
  const np = item.normalPrice
  if (!np) return { unitPrice: item.unitPrice, modifiers: item.modifiers, discountAmount: item.discountAmount, lineTotal: computeLineTotal({ ...item }), normalPrice: null }
  const modifiers = item.modifiers.map((m, i) => ({ ...m, priceDelta: np.modifierDeltas[i] ?? 0 }))
  return { unitPrice: np.unitPrice, modifiers, discountAmount: np.discountAmount, lineTotal: computeLineTotal({ unitPrice: np.unitPrice, qty: item.qty, modifiers, discountAmount: np.discountAmount }), normalPrice: null }
}

/** Nilai jual normal satu item (untuk laporan "nilai jual" pesanan KOL/Compliment). */
export function normalLineValue(item: Pick<OrderItem, 'qty' | 'normalPrice' | 'lineTotal'>): number {
  const np = item.normalPrice
  if (!np) return item.lineTotal
  const gross = (np.unitPrice + np.modifierDeltas.reduce((s, d) => s + d, 0)) * item.qty
  return Math.max(0, gross - np.discountAmount)
}

/** Label untuk struk — ASCII saja (printer thermal tak selalu bisa mencetak "—"). */
export function describeHppPricing(p: Pick<HppPricing, 'kind' | 'name'>): string {
  return `${HPP_PRICING_LABELS[p.kind]} - ${p.name}`
}
