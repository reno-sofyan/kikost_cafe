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

/**
 * Harga jual produk untuk sebuah kanal: harga khusus aplikasi itu → harga online
 * umum → harga jual biasa (yang pertama terisi).
 */
export function productPriceFor(product: Pick<Product, 'price' | 'onlinePrice' | 'platformPrices'>, online: boolean, platform?: OnlinePlatform | null): number {
  if (!online) return product.price
  const perPlatform = platform ? product.platformPrices?.[platform] : undefined
  if (perPlatform != null && perPlatform > 0) return perPlatform
  return product.onlinePrice != null && product.onlinePrice > 0 ? product.onlinePrice : product.price
}

/** Harga jual + markup persen, dibulatkan KE ATAS ke kelipatan `roundTo` (mis. 500). */
export function markedUpPrice(price: number, percent: number, roundTo: number): number {
  const raw = price * (1 + percent / 100)
  const step = Math.max(1, Math.round(roundTo))
  return Math.ceil(Math.round(raw) / step) * step
}

/** Estimasi komisi platform (Rp) dari penjualan bersih sebuah pesanan online. */
export function onlineCommissionOf(order: Pick<Order, 'type' | 'subtotal' | 'discountAmount' | 'onlineCommissionPercent'>): number {
  if (!isOnlineOrder(order)) return 0
  const pct = Math.min(100, Math.max(0, order.onlineCommissionPercent ?? 0))
  return Math.round(((order.subtotal - order.discountAmount) * pct) / 100)
}
