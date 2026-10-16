import { db } from '@/db/schema'
import type { SyncEntity } from '@/types/domain'

/**
 * Katalog contoh dari onboarding dicatat (per perangkat) supaya tablet KEDUA yang
 * dihubungkan ke server usaha yang sudah berisi katalog tidak mendorong katalog
 * contohnya sendiri — tanpa ini kategori & produk contoh bercampur dengan katalog
 * asli (mis. "Minuman" muncul dua kali). Katalog contoh hanya dibuang selama masih
 * utuh: belum ada transaksi, tak ada baris katalog baru, dan tak ada yang diedit.
 */

const STORAGE_KEY = 'kione.sampleCatalog'

const CATALOG_TABLES = ['categories', 'products', 'modifierGroups', 'modifierOptions', 'ingredients', 'recipes', 'printRoutes'] as const
type CatalogTable = (typeof CATALOG_TABLES)[number] & SyncEntity

interface SampleCatalogMarker {
  seededAt: number
  ids: Record<CatalogTable, string[]>
}

function readMarker(): SampleCatalogMarker | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as SampleCatalogMarker) : null
  } catch {
    return null
  }
}

function clearMarker(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // penyimpanan tak tersedia — penanda memang tak pernah tersimpan
  }
}

async function currentRows(table: CatalogTable): Promise<{ id: string; updatedAt?: number }[]> {
  return (await db.table(table).toArray()) as { id: string; updatedAt?: number }[]
}

/** Dipanggil sesudah onboarding mengisi katalog contoh: seluruh katalog saat itu = contoh. */
export async function rememberSampleCatalog(): Promise<void> {
  const ids = {} as Record<CatalogTable, string[]>
  // Sebagian baris memakai jam terpercaya (bisa sedikit di depan Date.now) — jangan sampai terbaca "diedit".
  let seededAt = Date.now()
  for (const table of CATALOG_TABLES) {
    const rows = await currentRows(table)
    ids[table] = rows.map((r) => r.id)
    for (const r of rows) seededAt = Math.max(seededAt, r.updatedAt ?? 0)
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ seededAt, ids } satisfies SampleCatalogMarker))
  } catch {
    // tanpa penanda, katalog contoh diperlakukan sebagai katalog asli (aman: tak ada yang dibuang)
  }
}

/** ID kategori & produk katalog contoh — untuk membedakan katalog server milik perangkat ini sendiri. */
export function sampleCatalogIds(): Set<string> {
  const marker = readMarker()
  return new Set(marker ? [...marker.ids.categories, ...marker.ids.products] : [])
}

/** Katalog contoh masih utuh: belum ada transaksi, tak ada baris tambahan, tak ada yang diedit. */
export async function isSampleCatalogUntouched(): Promise<boolean> {
  const marker = readMarker()
  if (!marker) return false
  if ((await db.orders.count()) > 0) return false
  for (const table of CATALOG_TABLES) {
    const seeded = new Set(marker.ids[table] ?? [])
    for (const row of await currentRows(table)) {
      if (!seeded.has(row.id)) return false
      if (row.updatedAt !== undefined && row.updatedAt > marker.seededAt) return false
    }
  }
  return true
}

/**
 * Buang katalog contoh yang masih utuh beserta antrean sinkronnya. Mengembalikan
 * true bila dibuang. Katalog yang sudah dipakai/diubah tidak pernah disentuh.
 */
export async function discardUntouchedSampleCatalog(): Promise<boolean> {
  if (!(await isSampleCatalogUntouched())) return false
  const marker = readMarker()!
  const allIds = new Set(CATALOG_TABLES.flatMap((t) => marker.ids[t] ?? []))
  await db.transaction('rw', [...CATALOG_TABLES.map((t) => db.table(t)), db.syncQueue], async () => {
    for (const table of CATALOG_TABLES) await db.table(table).bulkDelete(marker.ids[table] ?? [])
    await db.syncQueue
      .filter((e) => (CATALOG_TABLES as readonly string[]).includes(e.entity) && allIds.has(e.entityId))
      .delete()
  })
  clearMarker()
  return true
}
