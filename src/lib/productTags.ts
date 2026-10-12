/** Label menu & info alergen. `allergen: true` = wajib terlihat saat tamu bertanya soal pantangan. */
export interface ProductTagInfo {
  id: string
  label: string
  /** Singkatan untuk ruang sempit (ubin kasir). */
  short: string
  allergen: boolean
}

export const PRODUCT_TAGS: ProductTagInfo[] = [
  { id: 'best_seller', label: 'Terlaris', short: 'Terlaris', allergen: false },
  { id: 'new', label: 'Baru', short: 'Baru', allergen: false },
  { id: 'spicy', label: 'Pedas', short: 'Pedas', allergen: false },
  { id: 'vegetarian', label: 'Vegetarian', short: 'Vege', allergen: false },
  { id: 'vegan', label: 'Vegan', short: 'Vegan', allergen: false },
  { id: 'nuts', label: 'Mengandung kacang', short: 'Kacang', allergen: true },
  { id: 'dairy', label: 'Mengandung susu', short: 'Susu', allergen: true },
  { id: 'egg', label: 'Mengandung telur', short: 'Telur', allergen: true },
  { id: 'gluten', label: 'Mengandung gluten', short: 'Gluten', allergen: true },
  { id: 'seafood', label: 'Mengandung seafood', short: 'Seafood', allergen: true },
  { id: 'soy', label: 'Mengandung kedelai', short: 'Kedelai', allergen: true },
  { id: 'alcohol', label: 'Mengandung alkohol', short: 'Alkohol', allergen: true },
]

const BY_ID = new Map(PRODUCT_TAGS.map((t) => [t.id, t]))

/** Tag yang dikenal saja, dalam urutan baku (bukan urutan dipilih). */
export function productTagsOf(tags: readonly string[] | null | undefined): ProductTagInfo[] {
  if (!tags?.length) return []
  const wanted = new Set(tags)
  return PRODUCT_TAGS.filter((t) => wanted.has(t.id))
}

export function normalizeProductTags(tags: readonly string[] | null | undefined): string[] {
  return productTagsOf(tags).map((t) => t.id)
}

export function productTagLabel(id: string): string {
  return BY_ID.get(id)?.label ?? id
}
