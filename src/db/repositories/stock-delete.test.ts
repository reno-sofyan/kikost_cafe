import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { roleHasPermission } from '@/lib/permissions'
import { applyRemoteDeletions } from '@/sync/applyRemote'
import {
  adjustIngredientStock,
  clearStockMovements,
  deleteIngredient,
  deleteStockMovement,
  ingredientDeleteBlockReason,
} from './stock'
import { createPurchase } from './purchasing'
import type { Ingredient } from '@/types/domain'

const actor = { userId: 'u1', userName: 'Admin' }

async function ingredient(p: Partial<Ingredient> = {}): Promise<Ingredient> {
  const i: Ingredient = {
    id: 'i1', name: 'Gula', unit: 'g', stockQty: 500, lowStockThreshold: 100, costPerUnit: 10,
    createdAt: 1, updatedAt: 1, ...p,
  }
  await db.ingredients.put(i)
  return i
}

const pendingDeletes = async (entity: string) =>
  (await db.syncQueue.toArray()).filter((e) => e.operation === 'delete' && e.entity === entity)

beforeEach(async () => {
  await resetLocalDb()
})

describe('izin hapus stok', () => {
  it('hanya pemilik & administrator', () => {
    expect(roleHasPermission('pemilik', 'stock.delete')).toBe(true)
    expect(roleHasPermission('administrator', 'stock.delete')).toBe(true)
    for (const role of ['supervisor', 'kasir', 'pramusaji', 'dapur'] as const) {
      expect(roleHasPermission(role, 'stock.delete')).toBe(false)
    }
  })
})

describe('hapus bahan baku', () => {
  it('menghapus lokal, mengantre tombstone sync, dan mencatat audit log', async () => {
    await ingredient()
    await deleteIngredient('i1', actor)

    expect(await db.ingredients.get('i1')).toBeUndefined()
    const deletes = await pendingDeletes('ingredients')
    expect(deletes).toHaveLength(1)
    expect(deletes[0]).toMatchObject({ entityId: 'i1', status: 'pending' })
    expect((deletes[0].payload as { deletedAt: number }).deletedAt).toBeGreaterThan(0)
    const logs = await db.auditLogs.toArray()
    expect(logs.find((l) => l.action === 'ingredient.deleted')?.details).toContain('Gula')
  })

  it('ditolak bila masih dipakai resep, dengan nama produknya', async () => {
    await ingredient()
    await db.products.put({ id: 'p1', name: 'Es Teh' } as never)
    await db.recipes.put({ id: 'r1', productId: 'p1', items: [{ ingredientId: 'i1', qty: 10 }], updatedAt: 1 })

    expect(await ingredientDeleteBlockReason('i1')).toContain('Es Teh')
    await expect(deleteIngredient('i1', actor)).rejects.toThrow('Es Teh')
    expect(await db.ingredients.get('i1')).toBeDefined()
    expect(await pendingDeletes('ingredients')).toHaveLength(0)
  })

  it('ditolak bila masih ada di draft pembelian', async () => {
    await ingredient()
    await createPurchase({
      supplierName: 'Toko', invoiceNo: '', note: '', createdBy: 'u1',
      lines: [{ itemType: 'ingredient', itemId: 'i1', itemName: 'Gula', qty: 1, unit: 'kg', unitCost: 15000 }],
    })
    expect(await ingredientDeleteBlockReason('i1')).toContain('draft pembelian')
  })
})

describe('hapus riwayat pergerakan stok', () => {
  it('hapus satu entri tidak mengubah stok saat ini', async () => {
    await ingredient({ stockQty: 500 })
    await adjustIngredientStock({ ingredientId: 'i1', qtyDelta: 100, reason: 'stock_in', userId: 'u1' })
    const [movement] = await db.stockMovements.toArray()

    await deleteStockMovement(movement.id, actor)

    expect(await db.stockMovements.count()).toBe(0)
    expect((await db.ingredients.get('i1'))?.stockQty).toBe(600)
    expect((await pendingDeletes('stockMovements')).map((e) => e.entityId)).toEqual([movement.id])
  })

  it('hapus semua riwayat mengantre tombstone untuk tiap entri', async () => {
    await ingredient()
    for (const qty of [10, 20, 30]) {
      await adjustIngredientStock({ ingredientId: 'i1', qtyDelta: qty, reason: 'stock_in', userId: 'u1' })
    }
    expect(await clearStockMovements(actor)).toBe(3)
    expect(await db.stockMovements.count()).toBe(0)
    expect(await pendingDeletes('stockMovements')).toHaveLength(3)
    expect((await db.auditLogs.toArray()).some((l) => l.action === 'stock_movement.cleared')).toBe(true)
  })
})

describe('applyRemoteDeletions (penghapusan dari perangkat lain)', () => {
  it('menghapus bahan & riwayat yang dikirim server', async () => {
    await ingredient({ id: 'i1' })
    await ingredient({ id: 'i2', name: 'Kopi' })
    await adjustIngredientStock({ ingredientId: 'i2', qtyDelta: 5, reason: 'stock_in', userId: 'u1' })
    const [movement] = await db.stockMovements.toArray()

    await applyRemoteDeletions({ ingredients: ['i1'], stockMovements: [movement.id] })

    expect(await db.ingredients.get('i1')).toBeUndefined()
    expect(await db.ingredients.get('i2')).toBeDefined()
    expect(await db.stockMovements.count()).toBe(0)
  })

  it('mengabaikan entitas di luar daftar putih (mis. shift tak bisa dihapus dari server)', async () => {
    await db.shifts.put({ id: 's1' } as never)
    await applyRemoteDeletions({ shifts: ['s1'] })
    expect(await db.shifts.get('s1')).toBeDefined()
  })
})
