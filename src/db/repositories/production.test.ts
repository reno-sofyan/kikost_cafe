import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import {
  completeProduction,
  createProduction,
  InsufficientProductionStockError,
  listProductions,
} from './production'
import type { Ingredient, Product } from '@/types/domain'

async function ing(id: string, unit: Ingredient['unit'], stockQty: number): Promise<void> {
  await db.ingredients.put({
    id, name: id, unit, stockQty, lowStockThreshold: 0, costPerUnit: 10, createdAt: 1, updatedAt: 1,
  })
}
async function prod(id: string, unit: Product['unit'], stockQty: number): Promise<void> {
  await db.products.put({
    id, categoryId: 'c1', name: id, sku: id, barcode: null, price: 1000, costPrice: 100, unit,
    photoDataUrl: null, trackOwnStock: true, stockQty, lowStockThreshold: 0, isFavorite: false,
    isAvailable: true, modifierGroupIds: [], createdAt: 1, updatedAt: 1,
  })
}

beforeEach(async () => {
  await resetLocalDb()
  await db.categories.put({ id: 'c1', name: 'Umum', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })
})

const actor = { completedBy: 'u1', completedByName: 'Admin' }

describe('Produksi / olahan', () => {
  it('memotong stok input (dengan konversi satuan) & menambah stok hasil', async () => {
    await ing('gula', 'g', 5000)
    await ing('air', 'ml', 5000)
    await ing('syrup', 'ml', 0)

    const run = await createProduction({
      outputItemType: 'ingredient', outputItemId: 'syrup', outputQty: 1.8, outputUnit: 'l',
      inputs: [
        { itemType: 'ingredient', itemId: 'gula', qty: 1, unit: 'kg' },
        { itemType: 'ingredient', itemId: 'air', qty: 1, unit: 'l' },
      ],
      note: 'batch pagi', createdBy: 'u1',
    })
    expect(run.status).toBe('draft')
    expect((await db.ingredients.get('gula'))?.stockQty).toBe(5000) // belum berubah

    await completeProduction({ productionId: run.id, ...actor })

    expect((await db.ingredients.get('gula'))?.stockQty).toBe(4000) // -1000 g
    expect((await db.ingredients.get('air'))?.stockQty).toBe(4000) // -1000 ml
    expect((await db.ingredients.get('syrup'))?.stockQty).toBe(1800) // +1.8 l = 1800 ml
    expect((await db.productions.get(run.id))?.status).toBe('completed')

    const moves = await db.stockMovements.toArray()
    expect(moves.filter((m) => m.reason === 'production_consumption')).toHaveLength(2)
    expect(moves.filter((m) => m.reason === 'production_output')).toHaveLength(1)
    expect(await db.auditLogs.where('action').equals('production.complete').count()).toBe(1)
  })

  it('output boleh berupa produk ber-stok sendiri', async () => {
    await ing('beans', 'g', 1000)
    await prod('coldbrew', 'pcs', 0)
    const run = await createProduction({
      outputItemType: 'product', outputItemId: 'coldbrew', outputQty: 20, outputUnit: 'pcs',
      inputs: [{ itemType: 'ingredient', itemId: 'beans', qty: 500, unit: 'g' }],
      note: '', createdBy: 'u1',
    })
    await completeProduction({ productionId: run.id, ...actor })
    expect((await db.products.get('coldbrew'))?.stockQty).toBe(20)
    expect((await db.ingredients.get('beans'))?.stockQty).toBe(500)
  })

  it('menolak bila stok input kurang; draf tetap tersimpan', async () => {
    await ing('gula', 'g', 100)
    await ing('syrup', 'ml', 0)
    const run = await createProduction({
      outputItemType: 'ingredient', outputItemId: 'syrup', outputQty: 500, outputUnit: 'ml',
      inputs: [{ itemType: 'ingredient', itemId: 'gula', qty: 1, unit: 'kg' }],
      note: '', createdBy: 'u1',
    })
    await expect(completeProduction({ productionId: run.id, ...actor })).rejects.toThrow(InsufficientProductionStockError)
    expect((await db.ingredients.get('gula'))?.stockQty).toBe(100) // tak berubah
    expect((await db.productions.get(run.id))?.status).toBe('draft')
  })

  it('supervisor bisa menembus stok kurang (allowNegative) + ber-audit', async () => {
    await ing('gula', 'g', 100)
    await ing('syrup', 'ml', 0)
    const run = await createProduction({
      outputItemType: 'ingredient', outputItemId: 'syrup', outputQty: 500, outputUnit: 'ml',
      inputs: [{ itemType: 'ingredient', itemId: 'gula', qty: 1, unit: 'kg' }],
      note: '', createdBy: 'u1',
    })
    await completeProduction({
      productionId: run.id, ...actor,
      allowNegative: { approverUserId: 's1', approverName: 'Supervisor' },
    })
    expect((await db.ingredients.get('gula'))?.stockQty).toBe(-900)
    expect(await db.auditLogs.where('action').equals('stock.negative.override').count()).toBe(1)
  })

  it('completeProduction idempoten — panggil dua kali tak potong dua kali', async () => {
    await ing('gula', 'g', 5000)
    await ing('syrup', 'ml', 0)
    const run = await createProduction({
      outputItemType: 'ingredient', outputItemId: 'syrup', outputQty: 500, outputUnit: 'ml',
      inputs: [{ itemType: 'ingredient', itemId: 'gula', qty: 500, unit: 'g' }],
      note: '', createdBy: 'u1',
    })
    await completeProduction({ productionId: run.id, ...actor })
    await completeProduction({ productionId: run.id, ...actor })
    expect((await db.ingredients.get('gula'))?.stockQty).toBe(4500)
    expect(await listProductions()).toHaveLength(1)
  })

  it('menolak konversi lintas keluarga satuan (g → ml)', async () => {
    await ing('gula', 'g', 5000)
    await ing('syrup', 'ml', 0)
    await expect(
      createProduction({
        outputItemType: 'ingredient', outputItemId: 'syrup', outputQty: 500, outputUnit: 'ml',
        inputs: [{ itemType: 'ingredient', itemId: 'gula', qty: 100, unit: 'ml' }],
        note: '', createdBy: 'u1',
      }).then((r) => completeProduction({ productionId: r.id, ...actor })),
    ).rejects.toThrow(/sepadan/i)
  })
})
