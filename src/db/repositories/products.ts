import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import type { Product, Recipe } from '@/types/domain'

export type ProductInput = Omit<Product, 'id' | 'createdAt' | 'updatedAt'>

export async function listProducts(): Promise<Product[]> {
  return db.products.orderBy('name').toArray()
}

export async function listAvailableProducts(): Promise<Product[]> {
  return db.products.filter((p) => p.isAvailable).sortBy('name')
}

export async function getProduct(id: string): Promise<Product | undefined> {
  return db.products.get(id)
}

export async function createProduct(input: ProductInput): Promise<Product> {
  const now = Date.now()
  const product: Product = { ...input, id: newId(), createdAt: now, updatedAt: now }
  await db.transaction('rw', db.products, db.syncQueue, async () => {
    await db.products.add(product)
    await enqueueSync('products', product.id, product)
  })
  return product
}

export async function updateProduct(id: string, patch: Partial<ProductInput>): Promise<void> {
  await db.transaction('rw', db.products, db.syncQueue, async () => {
    await db.products.update(id, { ...patch, updatedAt: Date.now() })
    const updated = await db.products.get(id)
    if (updated) await enqueueSync('products', id, updated)
  })
}

export async function setProductAvailability(id: string, isAvailable: boolean): Promise<void> {
  await updateProduct(id, { isAvailable })
}

export async function toggleFavorite(id: string): Promise<void> {
  const product = await db.products.get(id)
  if (!product) return
  await updateProduct(id, { isFavorite: !product.isFavorite })
}

export async function searchProducts(query: string, categoryId?: string): Promise<Product[]> {
  const lowered = query.trim().toLowerCase()
  const all = await db.products.toArray()
  return all.filter((p) => {
    const matchesCategory = !categoryId || categoryId === 'all' || p.categoryId === categoryId
    if (!matchesCategory) return false
    if (!lowered) return true
    return (
      p.name.toLowerCase().includes(lowered) ||
      p.sku.toLowerCase().includes(lowered) ||
      (p.barcode ?? '').toLowerCase().includes(lowered)
    )
  })
}

export async function getRecipeForProduct(productId: string): Promise<Recipe | undefined> {
  return db.recipes.where('productId').equals(productId).first()
}

export async function saveRecipe(productId: string, items: Recipe['items']): Promise<Recipe> {
  const existing = await getRecipeForProduct(productId)
  const recipe: Recipe = {
    id: existing?.id ?? newId(),
    productId,
    items,
    updatedAt: Date.now(),
  }
  await db.recipes.put(recipe)
  return recipe
}

/** CSV export sederhana: sku,barcode,name,category,price,cost,stock,unit,available */
export async function exportProductsCsv(): Promise<string> {
  const products = await listProducts()
  const categories = await db.categories.toArray()
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? ''
  const header = 'sku,barcode,name,category,price,cost,stock,unit,available,favorite'
  const rows = products.map((p) =>
    [
      p.sku,
      p.barcode ?? '',
      csvEscape(p.name),
      csvEscape(categoryName(p.categoryId)),
      p.price,
      p.costPrice,
      p.stockQty,
      p.unit,
      p.isAvailable ? '1' : '0',
      p.isFavorite ? '1' : '0',
    ].join(','),
  )
  return [header, ...rows].join('\n')
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
