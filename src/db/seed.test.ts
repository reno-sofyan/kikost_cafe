import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { seedInitialCatalog } from './seed'

describe('seedInitialCatalog', () => {
  beforeEach(async () => {
    await resetLocalDb()
  })

  it('kafe: katalog kopi dengan modifier & resep', async () => {
    await seedInitialCatalog('cafe_resto')
    const products = await db.products.toArray()
    expect(products.some((p) => p.name === 'Espresso')).toBe(true)
    expect(await db.recipes.count()).toBeGreaterThan(0)
  })

  it('kantin: menu kantin dengan modifier sederhana, tanpa resep/bahan baku', async () => {
    await seedInitialCatalog('kantin')
    const products = await db.products.toArray()
    expect(products.some((p) => p.name === 'Nasi Ayam Goreng')).toBe(true)
    expect(products.some((p) => p.name === 'Espresso')).toBe(false)
    expect(await db.modifierGroups.count()).toBeGreaterThan(0)
    expect(await db.recipes.count()).toBe(0)
    expect(await db.ingredients.count()).toBe(0)
  })

  it('minimarket: barang ber-barcode unik, tanpa modifier/resep', async () => {
    await seedInitialCatalog('minimarket')
    const products = await db.products.toArray()
    expect(products.length).toBeGreaterThan(0)
    expect(products.every((p) => p.barcode && p.modifierGroupIds.length === 0 && p.trackOwnStock)).toBe(true)
    expect(new Set(products.map((p) => p.barcode)).size).toBe(products.length)
    expect(await db.modifierGroups.count()).toBe(0)
    expect(await db.recipes.count()).toBe(0)
  })

  it('tidak menimpa katalog yang sudah ada', async () => {
    await seedInitialCatalog('minimarket')
    const before = await db.products.count()
    await seedInitialCatalog('cafe_resto')
    expect(await db.products.count()).toBe(before)
  })
})
