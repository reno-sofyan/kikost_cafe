import { beforeEach, describe, expect, it } from 'vitest'
import { addOrderItem, startOrder, updateOrderItemQty } from './orders'
import { openShift } from './shifts'
import { createTable } from './tables'
import { enqueuePreBillForOrder } from './receiptDispatch'
import { sendOrderToKitchen } from './kitchenDispatch'
import { ensureDefaultSettings, getSettings } from './settings'
import { buildReceiptData } from '@/features/printing/receiptData'
import { buildEscPosKitchenTicket, buildEscPosReceipt } from '@/features/printing/escpos'
import { billAdditions } from '@/lib/billAdditions'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import type { KitchenTicketPayload } from '@/types/domain'

const actor = { userId: 'u1', userName: 'Kasir' }
const decode = (b: Uint8Array) => new TextDecoder().decode(b)

beforeEach(async () => {
  await resetLocalDb()
  await ensureDefaultSettings()
})

async function dineInOrder() {
  const shift = await openShift({ cashierId: 'u1', cashierName: 'Kasir', openingCash: 0 })
  const table = await createTable({ name: 'Meja 5', area: 'Dalam', capacity: 4 })
  const order = await startOrder({ type: 'dine_in', cashierId: 'u1', cashierName: 'Kasir', shiftId: shift.id, tableId: table.id })
  const kopi = await addOrderItem({ orderId: order.id, productId: 'p1', productName: 'Kopi Susu', unitPrice: 22000, qty: 1, modifiers: [], notes: '' })
  return { order, kopi }
}

describe('Tagihan Tambahan', () => {
  it('hanya item & qty yang ditambahkan setelah tagihan terakhir; total tetap keseluruhan', async () => {
    const { order, kopi } = await dineInOrder()
    await enqueuePreBillForOrder(order.id, actor)
    expect((await db.orders.get(order.id))?.billSnapshot).toEqual({ [kopi.id]: 1 })

    await addOrderItem({ orderId: order.id, productId: 'p2', productName: 'Croffle', unitPrice: 25000, qty: 1, modifiers: [], notes: '' })
    await updateOrderItemQty(kopi.id, 3) // +2 pada baris lama ikut terhitung
    const fresh = (await db.orders.get(order.id))!
    const data = await buildReceiptData(fresh, await getSettings(), { preBill: true, additionsOnly: true })
    expect(data.lines.map((l) => [l.name, l.qty, l.lineTotal]).sort()).toEqual([
      ['Croffle', 1, 25000],
      ['Kopi Susu', 2, 44000],
    ])
    expect(data.additions).toEqual({ subtotal: 69000 })

    const text = decode(buildEscPosReceipt(data))
    expect(text).toContain('TAGIHAN TAMBAHAN')
    expect(text).toMatch(/Subtotal tambahan\s+Rp69\.000/)
    expect(text).toContain('TOTAL KESELURUHAN')
    expect(text).toContain(data.grandTotal.toLocaleString('id-ID'))
    expect(text).not.toMatch(/\nSubtotal\s+Rp/)

    // Setelah dicetak, tak ada tambahan lagi sampai ada item baru.
    await enqueuePreBillForOrder(order.id, actor, { additionsOnly: true })
    const after = (await db.orders.get(order.id))!
    expect(billAdditions(after, await db.orderItems.where('orderId').equals(order.id).toArray())).toEqual([])
  })

  it('tanpa tagihan sebelumnya → tak ada tambahan', async () => {
    const { order } = await dineInOrder()
    expect(billAdditions((await db.orders.get(order.id))!, await db.orderItems.toArray())).toEqual([])
  })
})

describe('Tiket dapur TAMBAHAN', () => {
  it('tiket pertama tanpa penanda; tiket tambahan memuat nomor pesanan & meja', async () => {
    const { order } = await dineInOrder()
    await sendOrderToKitchen(order.id, actor)
    await addOrderItem({ orderId: order.id, productId: 'p2', productName: 'Croffle', unitPrice: 25000, qty: 1, modifiers: [], notes: '' })
    await sendOrderToKitchen(order.id, actor)

    const jobs = (await db.printJobs.where('orderId').equals(order.id).toArray()).sort((a, b) => a.createdAt - b.createdAt)
    const [first, second] = jobs.map((j) => j.payload as KitchenTicketPayload)
    expect(first.isAddition).toBe(false)
    expect(decode(buildEscPosKitchenTicket(first))).not.toContain(order.orderNumber)

    expect(second).toMatchObject({ isAddition: true, tableOrQueue: expect.stringContaining('MEJA 5') })
    const text = decode(buildEscPosKitchenTicket(second))
    expect(text).toContain('PESANAN TAMBAHAN #2')
    expect(text).toContain(`No   : ${order.orderNumber}`)
    expect(text).toContain('MEJA 5')
    expect(text).toContain('Croffle')
    expect(text).not.toContain('Kopi Susu')
  })
})
