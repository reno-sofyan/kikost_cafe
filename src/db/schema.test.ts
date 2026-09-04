import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { listTables } from '@/db/repositories/tables'
import { listUsers } from '@/db/repositories/users'
import { listCategories } from '@/db/repositories/categories'
import { listProducts } from '@/db/repositories/products'
import { listModifierGroups } from '@/db/repositories/modifiers'
import { listAuditLogs } from '@/db/repositories/auditLog'
import { listLowStockIngredients } from '@/db/repositories/stock'

beforeEach(async () => {
  await resetLocalDb()
})

/**
 * Regresi: setiap `orderBy(field)` / `where(field)` di repository harus memakai
 * field yang ter-indeks di schema, kalau tidak Dexie melempar SchemaError saat
 * runtime (mis. NewOrderModal / TablesScreen / UserManager jadi blank).
 */
describe('query repository tidak melempar SchemaError', () => {
  it('listTables (cafeTables.orderBy(name))', async () => {
    await expect(listTables()).resolves.toEqual([])
  })
  it('listUsers (users.orderBy(name))', async () => {
    await expect(listUsers()).resolves.toEqual([])
  })
  it('listCategories / listProducts / listModifierGroups / listAuditLogs / listLowStockIngredients', async () => {
    await expect(listCategories()).resolves.toEqual([])
    await expect(listProducts()).resolves.toEqual([])
    await expect(listModifierGroups()).resolves.toEqual([])
    await expect(listAuditLogs()).resolves.toEqual([])
    await expect(listLowStockIngredients()).resolves.toEqual([])
  })

  it('schema versi terkini = 11', () => {
    expect(db.verno).toBe(11)
  })

  it('listActiveKitchenItems (orderItems.where(kitchenStatus))', async () => {
    const { listActiveKitchenItems } = await import('@/db/repositories/orders')
    await expect(listActiveKitchenItems()).resolves.toEqual([])
  })
})
