import type { Product, ScaleBarcodeConfig, SellUnit, TierPrice } from '@/types/domain'

/**
 * Pengali jumlah di kolom cari kasir: `12*` lalu pindai/ketik kode = 12 pcs.
 * `12*8991234` juga diterima (pemindai mengetik kode tepat setelah bintang).
 * Tanpa bintang = qty 1 dan seluruh teks adalah kode.
 */
export function parseQtyMultiplier(text: string): { qty: number; code: string } {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*[*xX×]\s*(.*)$/.exec(text)
  if (!m) return { qty: 1, code: text.trim() }
  const qty = Number(m[1].replace(',', '.'))
  return { qty: Number.isFinite(qty) && qty > 0 ? qty : 1, code: m[2].trim() }
}

/** Tingkat harga grosir yang valid, urut dari minQty terkecil. */
export function sortedTiers(tiers: TierPrice[] | undefined): TierPrice[] {
  return (tiers ?? []).filter((t) => t.minQty > 1 && t.price > 0).sort((a, b) => a.minQty - b.minQty)
}

/** Harga per satuan dasar untuk `qty` satuan dasar: tingkat grosir tertinggi yang tercapai, atau harga normal. */
export function tierUnitPrice(product: Pick<Product, 'price' | 'tierPrices'>, qty: number): number {
  let price = product.price
  for (const t of sortedTiers(product.tierPrices)) if (qty >= t.minQty) price = t.price
  return price
}

/** Satuan jual yang valid (isi > 1, harga > 0). */
export function validSellUnits(units: SellUnit[] | undefined): SellUnit[] {
  return (units ?? []).filter((u) => u.name.trim() && u.qty > 1 && u.price > 0)
}

/** Satuan jual yang barcode-nya persis `code`. */
export function sellUnitByBarcode(product: Pick<Product, 'sellUnits'>, code: string): SellUnit | undefined {
  const wanted = code.trim()
  return validSellUnits(product.sellUnits).find((u) => u.barcode?.trim() === wanted)
}

/** "Dus (40)" — label satuan jual di keranjang & struk. */
export function sellUnitLabel(unit: Pick<SellUnit, 'name' | 'qty'>): string {
  return `${unit.name} (${unit.qty.toLocaleString('id-ID')})`
}

// ---- EAN-13 ----

/** Digit cek EAN-13 dari 12 digit pertama. */
export function ean13CheckDigit(first12: string): number {
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3)
  return (10 - (sum % 10)) % 10
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12])
}

export const DEFAULT_SCALE_BARCODE: ScaleBarcodeConfig = { enabled: false, prefix: '2', flagLength: 2, pluLength: 5, valueKind: 'weight' }

export interface ScaleBarcode {
  plu: string
  /** Gram (valueKind weight) atau rupiah (valueKind price). */
  value: number
}

/**
 * Barcode timbangan: EAN-13 berawalan `prefix`, [penanda][PLU][nilai][cek].
 * null bila bukan barcode timbangan (format/awalan/digit cek tak cocok).
 */
export function parseScaleBarcode(code: string, config: ScaleBarcodeConfig | undefined): ScaleBarcode | null {
  if (!config?.enabled) return null
  const c = code.trim()
  if (!isValidEan13(c) || !c.startsWith(config.prefix)) return null
  const flag = Math.max(1, config.flagLength)
  const pluEnd = flag + Math.max(1, config.pluLength)
  if (pluEnd >= 12) return null
  const value = Number(c.slice(pluEnd, 12))
  return { plu: c.slice(flag, pluEnd), value }
}

/** Kode PLU disamakan tanpa nol di depan ("00123" = "123"). */
export function samePlu(a: string | null | undefined, b: string): boolean {
  if (!a?.trim()) return false
  return a.trim().replace(/^0+/, '') === b.replace(/^0+/, '')
}

/**
 * Jumlah (satuan dasar produk, mis. kg) dari barcode timbangan. Berat dalam gram →
 * kg bila satuan produk kg, gram bila satuan gram. Harga → nilai ÷ harga per satuan.
 */
export function scaleQty(product: Pick<Product, 'price' | 'unit'>, scan: ScaleBarcode, config: ScaleBarcodeConfig): number {
  if (config.valueKind === 'price') return product.price > 0 ? Math.round((scan.value / product.price) * 1000) / 1000 : 0
  return product.unit === 'g' ? scan.value : Math.round(scan.value) / 1000
}

/** Membersihkan isian sebelum disimpan; melempar pesan bila ada yang janggal. */
export function cleanRetailPricing(sellUnits: SellUnit[], tierPrices: TierPrice[], basePrice: number): { sellUnits: SellUnit[]; tierPrices: TierPrice[] } {
  const units = sellUnits.filter((u) => u.name.trim() || u.qty || u.price)
  for (const u of units) {
    if (!u.name.trim() || u.qty < 2 || u.price <= 0) throw new Error('Satuan jual: isi nama, isi (≥ 2), dan harganya.')
  }
  const tiers = tierPrices.filter((t) => t.minQty || t.price).sort((a, b) => a.minQty - b.minQty)
  for (const t of tiers) {
    if (t.minQty < 2 || t.price <= 0) throw new Error('Harga grosir: isi minimal beli (≥ 2) dan harganya.')
    if (basePrice > 0 && t.price >= basePrice) throw new Error('Harga grosir harus lebih murah dari harga jual normal.')
  }
  if (new Set(tiers.map((t) => t.minQty)).size !== tiers.length) throw new Error('Harga grosir: minimal beli tiap tingkat harus berbeda.')
  return { sellUnits: units.map((u) => ({ ...u, name: u.name.trim() })), tierPrices: tiers }
}
