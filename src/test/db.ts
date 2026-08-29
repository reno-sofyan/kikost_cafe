import { db } from '@/db/schema'

/**
 * Reset database lokal antar test tanpa menghapus/membuat ulang skema
 * (db.delete()+open() rapuh di fake-indexeddb). Cukup kosongkan semua tabel.
 */
export async function resetLocalDb(): Promise<void> {
  if (!db.isOpen()) await db.open()
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
  })
}
