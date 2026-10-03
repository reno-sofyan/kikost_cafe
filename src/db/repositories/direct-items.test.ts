import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { setPrintRoute, stationForCategory } from './printers'
import { sendOrderToKitchen } from './kitchenDispatch'
import { addOrderItem, listActiveKitchenItems, setOrderItemKitchenStatus, startOrder } from './orders'
import { openShift } from './shifts'
import { createKantinStarterCategories, listCategories } from './categories'
import type { Product } from '@/types/domain'

const actor = { userId: 'u1', userName: 'Admin' }

beforeEach(async () => {
  await resetLocalDb()
  await db.categories.bulkPut([
    { id: 'cat-masakan', name: 'Masakan', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 },
    { id: 'cat-botol', name: 'Minuman Dingin', sortOrder: 1, active: true, createdAt: 1, updatedAt: 1 },
  ])
  await setPrintRoute('cat-masakan', 'kitchen')
  await setPrintRoute('cat-botol', 'direct')
})

async function product(id: string, categoryId: string): Promise<Product> {
  const p: Product = {
    id, categoryId, name: id, sku: id, barcode: null, price: 5000, costPrice: 3000, unit: 'pcs',
    photoDataUrl: null, trackOwnStock: true, stockQty: 100, lowStockThreshold: 0, isFavorite: false,
    isAvailable: true, modifierGroupIds: [], createdAt: 1, updatedAt: 1,
  }
  await db.products.put(p)
  return p
}

async function newOrder() {
  const shift = await openShift({ cashierId: 'u1', cashierName: 'Admin', openingCash: 0 })
  return startOrder({ type: 'takeaway', cashierId: 'u1', cashierName: 'Admin', shiftId: shift.id })
}

const add = (orderId: string, productId: string) =>
  addOrderItem({ orderId, productId, productName: productId, unitPrice: 5000, qty: 1, modifiers: [], notes: '' })

describe('kategori "Langsung (tanpa dapur)"', () => {
  it('item barang siap jual langsung selesai dan tidak muncul di Layar Dapur', async () => {
    await product('teh-botol', 'cat-botol')
    const order = await newOrder()
    const item = await add(order.id, 'teh-botol')

    expect(item).toMatchObject({ skipKitchen: true, kitchenStatus: 'done' })
    expect((await listActiveKitchenItems()).map((i) => i.id)).not.toContain(item.id)
  })

  it('tidak dikirim ke dapur; hanya masakan yang dapat tiket', async () => {
    await product('nasi-goreng', 'cat-masakan')
    await product('teh-botol', 'cat-botol')
    const order = await newOrder()
    const nasi = await add(order.id, 'nasi-goreng')
    const teh = await add(order.id, 'teh-botol')

    const res = await sendOrderToKitchen(order.id, actor)

    expect(res).toEqual({ stations: ['kitchen'], itemCount: 1 })
    const tickets = await db.kitchenTickets.where('orderId').equals(order.id).toArray()
    expect(tickets).toHaveLength(1)
    expect(tickets[0].itemIds).toEqual([nasi.id])
    expect((await db.orderItems.get(teh.id))?.ticketId).toBeNull()
  })

  it('pesanan berisi barang siap jual saja: tak ada yang dikirim ke dapur', async () => {
    await product('teh-botol', 'cat-botol')
    const order = await newOrder()
    await add(order.id, 'teh-botol')
    expect(await sendOrderToKitchen(order.id, actor)).toEqual({ stations: [], itemCount: 0 })
  })

  it('tidak menahan status pesanan: masakan siap → pesanan READY walau ada minuman botol', async () => {
    await product('nasi-goreng', 'cat-masakan')
    await product('teh-botol', 'cat-botol')
    const order = await newOrder()
    const nasi = await add(order.id, 'nasi-goreng')
    await add(order.id, 'teh-botol')

    // Minuman botol yang langsung "done" tidak membuat pesanan tampak sedang dimasak.
    expect((await db.orders.get(order.id))?.lifecycleStatus).toBe('CONFIRMED')

    await setOrderItemKitchenStatus(nasi.id, 'in_progress')
    await setOrderItemKitchenStatus(nasi.id, 'ready')
    expect((await db.orders.get(order.id))?.lifecycleStatus).toBe('READY')
  })
})

describe('kategori standar kantin', () => {
  it('membuat 5 kategori dengan tujuan yang benar, dan tidak menduplikasi', async () => {
    await resetLocalDb()
    expect(await createKantinStarterCategories()).toBe(5)
    const cats = await listCategories()
    const stationOf = async (name: string) => stationForCategory(cats.find((c) => c.name === name)!.id)
    expect(await stationOf('Masakan')).toBe('kitchen')
    expect(await stationOf('Minuman Seduh')).toBe('kitchen')
    expect(await stationOf('Minuman Dingin')).toBe('direct')
    expect(await stationOf('Es Krim')).toBe('direct')
    expect(await stationOf('Snack & Kerupuk')).toBe('direct')

    expect(await createKantinStarterCategories()).toBe(0)
    expect(await db.categories.count()).toBe(5)
  })

  it('melewati kategori yang namanya sudah ada (abaikan besar-kecil huruf)', async () => {
    await resetLocalDb()
    await db.categories.put({ id: 'x', name: 'es krim', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 })
    expect(await createKantinStarterCategories()).toBe(4)
  })
})
