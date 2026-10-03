import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import type { Category, RouteStation } from '@/types/domain'
import { setPrintRoute } from '@/db/repositories/printers'
import { getTrustedNow } from '@/lib/clockGuard'

export async function listCategories(): Promise<Category[]> {
  return db.categories.orderBy('sortOrder').toArray()
}

export async function createCategory(name: string): Promise<Category> {
  const count = await db.categories.count()
  const now = getTrustedNow()
  const category: Category = { id: newId(), name, sortOrder: count, active: true, createdAt: now, updatedAt: now }
  await db.transaction('rw', db.categories, db.syncQueue, async () => {
    await db.categories.add(category)
    await enqueueSync('categories', category.id, category)
  })
  return category
}

export async function updateCategory(id: string, patch: Partial<Pick<Category, 'name' | 'sortOrder' | 'active'>>): Promise<void> {
  await db.transaction('rw', db.categories, db.syncQueue, async () => {
    await db.categories.update(id, { ...patch, updatedAt: getTrustedNow() })
    const updated = await db.categories.get(id)
    if (updated) await enqueueSync('categories', id, updated)
  })
}

/**
 * Kategori standar kantin beserta tujuannya: masakan & minuman seduh disiapkan di
 * dapur; barang siap jual langsung diserahkan kasir (tanpa dapur). Hanya kategori
 * kosong — produknya diisi sendiri oleh pemilik.
 */
export const KANTIN_STARTER_CATEGORIES: ReadonlyArray<{ name: string; station: RouteStation }> = [
  { name: 'Masakan', station: 'kitchen' },
  { name: 'Minuman Seduh', station: 'kitchen' },
  { name: 'Minuman Dingin', station: 'direct' },
  { name: 'Es Krim', station: 'direct' },
  { name: 'Snack & Kerupuk', station: 'direct' },
]

/** Membuat kategori standar kantin yang belum ada (cocok nama, abaikan besar-kecil huruf). */
export async function createKantinStarterCategories(): Promise<number> {
  const existing = new Set((await listCategories()).map((c) => c.name.trim().toLowerCase()))
  let created = 0
  for (const { name, station } of KANTIN_STARTER_CATEGORIES) {
    if (existing.has(name.toLowerCase())) continue
    const category = await createCategory(name)
    await setPrintRoute(category.id, station)
    created++
  }
  return created
}
