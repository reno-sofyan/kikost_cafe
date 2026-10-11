import type { OnlinePlatform, Order, Product } from '@/types/domain'

/** Platform pesan-antar yang dikenal. `other` = WhatsApp, situs sendiri, dsb. */
export const ONLINE_PLATFORMS: OnlinePlatform[] = ['gofood', 'grabfood', 'shopeefood', 'other']

export const ONLINE_PLATFORM_LABELS: Record<OnlinePlatform, string> = {
  gofood: 'GoFood',
  grabfood: 'GrabFood',
  shopeefood: 'ShopeeFood',
  other: 'Online Lainnya',
}

/**
 * Pesanan online = jenis pesanan `delivery` (di UI berlabel "Online"). Pesanan
 * lama bertipe delivery tanpa platform tetap dihitung online (platform "lainnya").
 */
export function isOnlineOrder(order: Pick<Order, 'type'>): boolean {
  return order.type === 'delivery'
}

export function onlinePlatformOf(order: Pick<Order, 'type' | 'onlinePlatform'>): OnlinePlatform | null {
  return isOnlineOrder(order) ? (order.onlinePlatform ?? 'other') : null
}

/** Label kanal untuk struk/tiket dapur, mis. "GoFood #F-1234". Kosong bila bukan online. */
export function onlineChannelLabel(order: Pick<Order, 'type' | 'onlinePlatform' | 'onlineOrderRef'>): string {
  const platform = onlinePlatformOf(order)
  if (!platform) return ''
  const ref = order.onlineOrderRef?.trim()
  return `${ONLINE_PLATFORM_LABELS[platform]}${ref ? ` #${ref}` : ''}`
}

/** Harga jual produk untuk sebuah kanal: harga online bila diisi, selain itu harga biasa. */
export function productPriceFor(product: Pick<Product, 'price' | 'onlinePrice'>, online: boolean): number {
  return online && product.onlinePrice != null && product.onlinePrice > 0 ? product.onlinePrice : product.price
}

/** Estimasi komisi platform (Rp) dari penjualan bersih sebuah pesanan online. */
export function onlineCommissionOf(order: Pick<Order, 'type' | 'subtotal' | 'discountAmount' | 'onlineCommissionPercent'>): number {
  if (!isOnlineOrder(order)) return 0
  const pct = Math.min(100, Math.max(0, order.onlineCommissionPercent ?? 0))
  return Math.round(((order.subtotal - order.discountAmount) * pct) / 100)
}
