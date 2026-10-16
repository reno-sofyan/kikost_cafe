import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { createCategory, createKantinStarterCategories, updateCategory } from '@/db/repositories/categories'
import { discardUntouchedSampleCatalog, isSampleCatalogUntouched, rememberSampleCatalog, sampleCatalogIds } from './sampleCatalog'
import { seedInitialCatalog } from './seed'

describe('katalog contoh (tablet tambahan)', () => {
  beforeEach(async () => {
    await resetLocalDb()
    localStorage.clear()
  })

  it('katalog contoh yang utuh dibuang beserta antrean sinkronnya', async () => {
    await seedInitialCatalog('cafe_resto')
    await rememberSampleCatalog()
    expect(sampleCatalogIds().size).toBe((await db.categories.count()) + (await db.products.count()))

    expect(await discardUntouchedSampleCatalog()).toBe(true)
    expect(await db.categories.count()).toBe(0)
    expect(await db.products.count()).toBe(0)
    expect(await db.recipes.count()).toBe(0)
    expect(await db.modifierOptions.count()).toBe(0)
    // Penanda dihapus — tak dibuang dua kali.
    expect(await discardUntouchedSampleCatalog()).toBe(false)
  })

  it('kategori standar kantin: antrean sinkronnya ikut dihapus', async () => {
    await createKantinStarterCategories()
    await rememberSampleCatalog()
    expect(await db.syncQueue.count()).toBeGreaterThan(0)

    expect(await discardUntouchedSampleCatalog()).toBe(true)
    expect(await db.categories.count()).toBe(0)
    expect(await db.printRoutes.count()).toBe(0)
    expect(await db.syncQueue.count()).toBe(0)
  })

  it('tanpa penanda (katalog dibuat sendiri) tak pernah dibuang', async () => {
    await seedInitialCatalog('kantin')
    expect(await isSampleCatalogUntouched()).toBe(false)
    expect(await discardUntouchedSampleCatalog()).toBe(false)
    expect(await db.products.count()).toBeGreaterThan(0)
  })

  it('katalog yang ditambah atau diedit dianggap katalog asli', async () => {
    await seedInitialCatalog('kantin')
    await rememberSampleCatalog()
    await createCategory('Menu Spesial')
    expect(await isSampleCatalogUntouched()).toBe(false)

    await resetLocalDb()
    localStorage.clear()
    await seedInitialCatalog('kantin')
    await rememberSampleCatalog()
    const [first] = await db.categories.toArray()
    await new Promise((r) => setTimeout(r, 5))
    await updateCategory(first!.id, { name: 'Makanan Berat' })
    expect(await isSampleCatalogUntouched()).toBe(false)
  })

  it('sudah ada transaksi → katalog dipertahankan', async () => {
    await seedInitialCatalog('kantin')
    await rememberSampleCatalog()
    await db.orders.add({ id: 'o1' } as never)
    expect(await discardUntouchedSampleCatalog()).toBe(false)
    expect(await db.products.count()).toBeGreaterThan(0)
  })
})
