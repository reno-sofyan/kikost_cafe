import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { buildOperationsReport } from './reports'
import type { OrderItem, StockMovement, StockMovementReason } from '@/types/domain'

const T0 = new Date('2026-06-01T03:00:00Z').getTime()

beforeEach(async () => {
  await resetLocalDb()
  await db.ingredients.put({ id: 'milk', name: 'Susu', unit: 'ml', stockQty: 5000, lowStockThreshold: 0, costPerUnit: 2, createdAt: 1, updatedAt: 1 })
  await db.ingredients.put({ id: 'sugar', name: 'Gula', unit: 'g', stockQty: 5000, lowStockThreshold: 0, costPerUnit: 1, createdAt: 1, updatedAt: 1 })
})

let seq = 0
async function move(itemId: string, reason: StockMovementReason, qtyDelta: number, at = T0 + 1000): Promise<void> {
  const m: StockMovement = {
    id: `m${seq++}`,
    itemType: 'ingredient',
    itemId,
    itemName: (await db.ingredients.get(itemId))?.name ?? itemId,
    reason,
    qtyDelta,
    resultingQty: 0,
    note: '',
    userId: 'u1',
    refOrderId: null,
    refType: null,
    refId: null,
    createdAt: at,
  }
  await db.stockMovements.put(m)
}

describe('buildOperationsReport', () => {
  it('agregasi waste (jumlah + estimasi biaya) dalam rentang', async () => {
    await move('milk', 'waste', -200)
    await move('sugar', 'waste', -100)
    await move('milk', 'waste', -50, T0 - 999_999) // di luar rentang

    const r = await buildOperationsReport({ from: T0, to: T0 + 86_400_000 })
    expect(r.wasteByItem.map((w) => [w.itemName, w.qty, w.estCost])).toEqual([
      ['Susu', 200, 400], // 200 * 2
      ['Gula', 100, 100],
    ])
    expect(r.wasteTotalCost).toBe(500)
  })

  it('pemakaian bahan dipecah per alasan', async () => {
    await move('milk', 'sale', -300)
    await move('milk', 'production_consumption', -1000)
    await move('milk', 'waste', -50)
    await move('sugar', 'adjustment', -20)

    const r = await buildOperationsReport({ from: T0, to: T0 + 86_400_000 })
    const milk = r.ingredientUsage.find((u) => u.itemName === 'Susu')!
    expect(milk).toMatchObject({ sale: 300, production: 1000, waste: 50, adjustment: 0 })
    const sugar = r.ingredientUsage.find((u) => u.itemName === 'Gula')!
    expect(sugar.adjustment).toBe(20)
  })

  it('hasil produksi diagregasi', async () => {
    await db.ingredients.put({ id: 'syrup', name: 'Syrup', unit: 'ml', stockQty: 0, lowStockThreshold: 0, costPerUnit: 5, createdAt: 1, updatedAt: 1 })
    await move('syrup', 'production_output', 1800)
    const r = await buildOperationsReport({ from: T0, to: T0 + 86_400_000 })
    expect(r.productionOutput).toEqual([{ itemName: 'Syrup', unit: 'ml', qty: 1800, estCost: 9000 }])
  })

  it('durasi dapur dari queuedAt → servedAt', async () => {
    const base: Omit<OrderItem, 'id' | 'queuedAt' | 'servedAt' | 'productName'> = {
      orderId: 'o1', productId: 'p1', unitPrice: 0, qty: 1, modifiers: [], notes: '', discountAmount: 0,
      lineTotal: 0, kitchenStatus: 'done', removed: false, kitchenPrintedAt: null, ticketId: null,
      startedAt: null, readyAt: null, voided: false, voidReason: null, createdAt: T0, updatedAt: T0,
    }
    await db.orderItems.put({ ...base, id: 'a', productName: 'Latte', queuedAt: T0, servedAt: T0 + 5 * 60_000 })
    await db.orderItems.put({ ...base, id: 'b', productName: 'Latte', queuedAt: T0, servedAt: T0 + 7 * 60_000 })
    await db.orderItems.put({ ...base, id: 'c', productName: 'Teh', queuedAt: T0, servedAt: T0 + 2 * 60_000 })

    const r = await buildOperationsReport({ from: T0 - 1, to: T0 + 86_400_000 })
    expect(r.kitchenDuration).toEqual([
      { productName: 'Latte', count: 2, avgPrepMinutes: 6 },
      { productName: 'Teh', count: 1, avgPrepMinutes: 2 },
    ])
    // (5+7+2)/3 = 4.67 → 4.7
    expect(r.avgKitchenMinutes).toBe(4.7)
  })
})
