import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import type { Ingredient, Product, StockMovementReason } from '@/types/domain'

export async function listIngredients(): Promise<Ingredient[]> {
  return db.ingredients.orderBy('name').toArray()
}

export async function createIngredient(input: Omit<Ingredient, 'id' | 'createdAt' | 'updatedAt'>): Promise<Ingredient> {
  const now = Date.now()
  const ingredient: Ingredient = { ...input, id: newId(), createdAt: now, updatedAt: now }
  await db.transaction('rw', db.ingredients, db.syncQueue, async () => {
    await db.ingredients.add(ingredient)
    await enqueueSync('ingredients', ingredient.id, ingredient)
  })
  return ingredient
}

export async function updateIngredient(
  id: string,
  patch: Partial<Omit<Ingredient, 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<void> {
  await db.transaction('rw', db.ingredients, db.syncQueue, async () => {
    await db.ingredients.update(id, { ...patch, updatedAt: Date.now() })
    const updated = await db.ingredients.get(id)
    if (updated) await enqueueSync('ingredients', id, updated)
  })
}

/**
 * Menyesuaikan stok bahan baku secara atomik dan mencatat riwayat pergerakan stok.
 * qtyDelta negatif = pengurangan (penjualan/waste/stok keluar), positif = penambahan (stok masuk/retur).
 */
export async function adjustIngredientStock(params: {
  ingredientId: string
  qtyDelta: number
  reason: StockMovementReason
  userId: string
  refOrderId?: string
  note?: string
}): Promise<void> {
  await db.transaction('rw', db.ingredients, db.stockMovements, db.syncQueue, db.products, async () => {
    const ingredient = await db.ingredients.get(params.ingredientId)
    if (!ingredient) throw new Error('Bahan baku tidak ditemukan')
    const resultingQty = roundQty(ingredient.stockQty + params.qtyDelta)
    await db.ingredients.update(params.ingredientId, { stockQty: resultingQty, updatedAt: Date.now() })
    const movement = {
      id: newId(),
      itemType: 'ingredient' as const,
      itemId: params.ingredientId,
      itemName: ingredient.name,
      reason: params.reason,
      qtyDelta: params.qtyDelta,
      resultingQty,
      note: params.note ?? '',
      userId: params.userId,
      refOrderId: params.refOrderId ?? null,
      createdAt: Date.now(),
    }
    await db.stockMovements.add(movement)
    await enqueueSync('stockMovements', movement.id, movement)
    const updatedIngredient = await db.ingredients.get(params.ingredientId)
    if (updatedIngredient) await enqueueSync('ingredients', params.ingredientId, updatedIngredient)
    await recomputeAvailabilityForIngredient(params.ingredientId)
  })
}

export async function adjustProductStock(params: {
  productId: string
  qtyDelta: number
  reason: StockMovementReason
  userId: string
  refOrderId?: string
  note?: string
}): Promise<void> {
  await db.transaction('rw', db.products, db.stockMovements, db.syncQueue, async () => {
    const product = await db.products.get(params.productId)
    if (!product) throw new Error('Produk tidak ditemukan')
    const resultingQty = roundQty(product.stockQty + params.qtyDelta)
    const isAvailable = resultingQty > 0 ? product.isAvailable : false
    await db.products.update(params.productId, {
      stockQty: resultingQty,
      isAvailable,
      updatedAt: Date.now(),
    })
    const movement = {
      id: newId(),
      itemType: 'product' as const,
      itemId: params.productId,
      itemName: product.name,
      reason: params.reason,
      qtyDelta: params.qtyDelta,
      resultingQty,
      note: params.note ?? '',
      userId: params.userId,
      refOrderId: params.refOrderId ?? null,
      createdAt: Date.now(),
    }
    await db.stockMovements.add(movement)
    await enqueueSync('stockMovements', movement.id, movement)
    const updatedProduct = await db.products.get(params.productId)
    if (updatedProduct) await enqueueSync('products', params.productId, updatedProduct)
  })
}

/** Menghitung ulang ketersediaan seluruh produk yang resepnya memakai bahan baku tertentu. */
async function recomputeAvailabilityForIngredient(ingredientId: string): Promise<void> {
  const recipes = await db.recipes.filter((r) => r.items.some((i) => i.ingredientId === ingredientId)).toArray()
  for (const recipe of recipes) {
    await recomputeProductAvailabilityByRecipe(recipe.productId)
  }
}

export async function recomputeProductAvailabilityByRecipe(productId: string): Promise<void> {
  const product = await db.products.get(productId)
  if (!product) return
  const recipe = await db.recipes.where('productId').equals(productId).first()
  if (!recipe || recipe.items.length === 0) return
  const hasAllIngredients = await hasEnoughIngredientsForOneUnit(recipe.items)
  const nextAvailability = hasAllIngredients
  if (product.isAvailable !== nextAvailability) {
    await db.products.update(productId, { isAvailable: nextAvailability, updatedAt: Date.now() })
    const updated = await db.products.get(productId)
    if (updated) await enqueueSync('products', productId, updated)
  }
}

async function hasEnoughIngredientsForOneUnit(items: { ingredientId: string; qty: number }[]): Promise<boolean> {
  for (const item of items) {
    const ingredient = await db.ingredients.get(item.ingredientId)
    if (!ingredient || ingredient.stockQty < item.qty) return false
  }
  return true
}

/** Memeriksa apakah suatu produk dapat memenuhi qty pesanan berdasarkan resep bahan baku. */
export async function canFulfillProductQty(product: Product, qty: number): Promise<boolean> {
  if (product.trackOwnStock) return product.stockQty >= qty
  const recipe = await db.recipes.where('productId').equals(product.id).first()
  if (!recipe || recipe.items.length === 0) return true
  for (const item of recipe.items) {
    const ingredient = await db.ingredients.get(item.ingredientId)
    if (!ingredient || ingredient.stockQty < item.qty * qty) return false
  }
  return true
}

export async function listLowStockIngredients(): Promise<Ingredient[]> {
  return db.ingredients.filter((i) => i.stockQty <= i.lowStockThreshold).toArray()
}

export async function listLowStockProducts(): Promise<Product[]> {
  return db.products.filter((p) => p.trackOwnStock && p.stockQty <= p.lowStockThreshold).toArray()
}

function roundQty(value: number): number {
  return Math.round(value * 1000) / 1000
}
