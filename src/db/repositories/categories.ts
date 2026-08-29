import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import type { Category } from '@/types/domain'

export async function listCategories(): Promise<Category[]> {
  return db.categories.orderBy('sortOrder').toArray()
}

export async function createCategory(name: string): Promise<Category> {
  const count = await db.categories.count()
  const now = Date.now()
  const category: Category = { id: newId(), name, sortOrder: count, active: true, createdAt: now, updatedAt: now }
  await db.transaction('rw', db.categories, db.syncQueue, async () => {
    await db.categories.add(category)
    await enqueueSync('categories', category.id, category)
  })
  return category
}

export async function updateCategory(id: string, patch: Partial<Pick<Category, 'name' | 'sortOrder' | 'active'>>): Promise<void> {
  await db.transaction('rw', db.categories, db.syncQueue, async () => {
    await db.categories.update(id, { ...patch, updatedAt: Date.now() })
    const updated = await db.categories.get(id)
    if (updated) await enqueueSync('categories', id, updated)
  })
}
