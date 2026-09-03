import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import { convertQty } from '@/lib/units'
import type {
  Ingredient,
  Product,
  RecipeItem,
  StockMovement,
  StockMovementItemType,
  StockMovementReason,
} from '@/types/domain'

/** Jumlah bahan yang dibutuhkan sebuah item resep, dikonversi ke satuan dasar bahan. */
export async function recipeItemBaseQty(item: RecipeItem): Promise<number> {
  const ingredient = await db.ingredients.get(item.ingredientId)
  if (!ingredient) return item.qty
  const from = item.unit ?? ingredient.unit
  return convertQty(item.qty, from, ingredient.unit)
}

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

export interface StockPostInput {
  itemType: StockMovementItemType
  itemId: string
  qtyDelta: number
  reason: StockMovementReason
  userId: string
  note?: string
  refType?: string
  refId?: string
}

/**
 * Memposting satu pergerakan stok — sumber tunggal kebenaran untuk semua perubahan
 * stok manual/dokumen (pembelian, opname, waste, transfer, adjustment). HARUS
 * dipanggil di dalam transaksi yang mencakup ingredients, products, stockMovements,
 * syncQueue. Menjaga histori: `stockMovements` tak pernah dihapus.
 */
export async function postStockMovement(input: StockPostInput): Promise<void> {
  const now = Date.now()
  if (input.itemType === 'ingredient') {
    const ingredient = await db.ingredients.get(input.itemId)
    if (!ingredient) throw new Error('Bahan baku tidak ditemukan')
    const resultingQty = roundQty(ingredient.stockQty + input.qtyDelta)
    await db.ingredients.update(input.itemId, { stockQty: resultingQty, updatedAt: now })
    await addMovement(input, ingredient.name, resultingQty, now)
    const updated = await db.ingredients.get(input.itemId)
    if (updated) await enqueueSync('ingredients', input.itemId, updated)
    await recomputeAvailabilityForIngredient(input.itemId)
  } else {
    const product = await db.products.get(input.itemId)
    if (!product) throw new Error('Produk tidak ditemukan')
    const resultingQty = roundQty(product.stockQty + input.qtyDelta)
    await db.products.update(input.itemId, {
      stockQty: resultingQty,
      isAvailable: resultingQty > 0 ? product.isAvailable : false,
      updatedAt: now,
    })
    await addMovement(input, product.name, resultingQty, now)
    const updated = await db.products.get(input.itemId)
    if (updated) await enqueueSync('products', input.itemId, updated)
  }
}

async function addMovement(input: StockPostInput, itemName: string, resultingQty: number, at: number): Promise<void> {
  const movement: StockMovement = {
    id: newId(),
    itemType: input.itemType,
    itemId: input.itemId,
    itemName,
    reason: input.reason,
    qtyDelta: input.qtyDelta,
    resultingQty,
    note: input.note ?? '',
    userId: input.userId,
    refOrderId: input.refType === 'order' ? (input.refId ?? null) : null,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    createdAt: at,
  }
  await db.stockMovements.add(movement)
  await enqueueSync('stockMovements', movement.id, movement)
}

export async function adjustIngredientStock(params: {
  ingredientId: string
  qtyDelta: number
  reason: StockMovementReason
  userId: string
  note?: string
}): Promise<void> {
  await db.transaction('rw', db.ingredients, db.stockMovements, db.syncQueue, db.products, db.recipes, async () => {
    await postStockMovement({
      itemType: 'ingredient',
      itemId: params.ingredientId,
      qtyDelta: params.qtyDelta,
      reason: params.reason,
      userId: params.userId,
      note: params.note,
    })
  })
}

export async function adjustProductStock(params: {
  productId: string
  qtyDelta: number
  reason: StockMovementReason
  userId: string
  note?: string
}): Promise<void> {
  await db.transaction('rw', db.products, db.ingredients, db.stockMovements, db.syncQueue, db.recipes, async () => {
    await postStockMovement({
      itemType: 'product',
      itemId: params.productId,
      qtyDelta: params.qtyDelta,
      reason: params.reason,
      userId: params.userId,
      note: params.note,
    })
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

async function hasEnoughIngredientsForOneUnit(items: RecipeItem[]): Promise<boolean> {
  for (const item of items) {
    const ingredient = await db.ingredients.get(item.ingredientId)
    if (!ingredient) return false
    if (ingredient.stockQty < (await recipeItemBaseQty(item))) return false
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
    if (!ingredient || ingredient.stockQty < (await recipeItemBaseQty(item)) * qty) return false
  }
  return true
}

export async function listLowStockIngredients(): Promise<Ingredient[]> {
  return db.ingredients.filter((i) => i.stockQty <= i.lowStockThreshold).toArray()
}

// ---- Pergerakan stok akibat penjualan / retur (dipakai billing & checkout) ----

interface SaleLine {
  productId: string
  qty: number
}

/** Nama produk yang stok/bahannya tidak cukup untuk memenuhi seluruh baris. */
export async function findOrderStockShortages(lines: SaleLine[]): Promise<string[]> {
  const ingNeed = new Map<string, number>()
  const prodNeed = new Map<string, number>()
  const names = new Map<string, string>()
  for (const line of lines) {
    const product = await db.products.get(line.productId)
    if (!product) continue
    if (product.trackOwnStock) {
      prodNeed.set(product.id, (prodNeed.get(product.id) ?? 0) + line.qty)
      names.set(product.id, product.name)
      continue
    }
    const recipe = await db.recipes.where('productId').equals(product.id).first()
    if (!recipe) continue
    for (const ri of recipe.items) {
      ingNeed.set(ri.ingredientId, (ingNeed.get(ri.ingredientId) ?? 0) + (await recipeItemBaseQty(ri)) * line.qty)
      names.set(ri.ingredientId, product.name)
    }
  }
  const short = new Set<string>()
  for (const [pid, qty] of prodNeed) {
    const p = await db.products.get(pid)
    if (!p || p.stockQty < qty) short.add(names.get(pid) ?? pid)
  }
  for (const [iid, qty] of ingNeed) {
    const ing = await db.ingredients.get(iid)
    if (!ing || ing.stockQty < qty) short.add(names.get(iid) ?? iid)
  }
  return [...short]
}

async function applySaleDelta(lines: SaleLine[], orderId: string, userId: string, sign: -1 | 1): Promise<void> {
  const reason = sign < 0 ? 'sale' : 'return'
  for (const line of lines) {
    const product = await db.products.get(line.productId)
    if (!product) continue
    if (product.trackOwnStock) {
      await postStockMovement({
        itemType: 'product',
        itemId: product.id,
        qtyDelta: sign * line.qty,
        reason,
        userId,
        refType: 'order',
        refId: orderId,
      })
      continue
    }
    const recipe = await db.recipes.where('productId').equals(product.id).first()
    if (!recipe) continue
    for (const ri of recipe.items) {
      await postStockMovement({
        itemType: 'ingredient',
        itemId: ri.ingredientId,
        qtyDelta: sign * (await recipeItemBaseQty(ri)) * line.qty,
        reason,
        userId,
        refType: 'order',
        refId: orderId,
      })
    }
  }
}

/** Memotong stok untuk penjualan (di dalam transaksi pemanggil). */
export function deductSaleStock(lines: SaleLine[], orderId: string, userId: string): Promise<void> {
  return applySaleDelta(lines, orderId, userId, -1)
}

/** Mengembalikan stok (retur/void yang di-restock). */
export function restockSaleStock(lines: SaleLine[], orderId: string, userId: string): Promise<void> {
  return applySaleDelta(lines, orderId, userId, 1)
}

export async function listLowStockProducts(): Promise<Product[]> {
  return db.products.filter((p) => p.trackOwnStock && p.stockQty <= p.lowStockThreshold).toArray()
}

function roundQty(value: number): number {
  return Math.round(value * 1000) / 1000
}
