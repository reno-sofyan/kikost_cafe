import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/schema'
import { resetLocalDb } from '@/test/db'
import { setEscPosSender, resetEscPosSender } from '@/features/printing/printerDrivers'
import { savePrinter, setPrintRoute } from './printers'
import { listPrintJobs, retryPrintJob } from './printQueue'
import { sendOrderToKitchen } from './kitchenDispatch'
import { finalizePayment } from './checkout'
import { addOrderItem, startOrder } from './orders'
import { openShift } from './shifts'
import type { Product } from '@/types/domain'

const sent: { host: string | null; bytes: number }[] = []
let failNext = false

beforeEach(async () => {
  await resetLocalDb()
  sent.length = 0
  failNext = false
  setEscPosSender(async (target, bytes) => {
    if (failNext) throw new Error('printer offline')
    sent.push({ host: target.networkHost, bytes: bytes.length })
  })
  await db.categories.bulkPut([
    { id: 'cat-food', name: 'Makanan', sortOrder: 0, active: true, createdAt: 1, updatedAt: 1 },
    { id: 'cat-drink', name: 'Minuman', sortOrder: 1, active: true, createdAt: 1, updatedAt: 1 },
  ])
})
afterEach(() => resetEscPosSender())

const actor = { userId: 'u1', userName: 'Admin' }

async function seedPrinters() {
  await savePrinter({ name: 'Kitchen', station: 'kitchen', connectionType: 'network', bluetoothAddress: null, bluetoothName: null, networkHost: '10.0.0.1', networkPort: 9100, paperSize: '80mm', active: true, fallbackPrinterId: null }, actor)
  await savePrinter({ name: 'Bar', station: 'bar', connectionType: 'network', bluetoothAddress: null, bluetoothName: null, networkHost: '10.0.0.2', networkPort: 9100, paperSize: '58mm', active: true, fallbackPrinterId: null }, actor)
  await savePrinter({ name: 'Kasir', station: 'cashier', connectionType: 'network', bluetoothAddress: null, bluetoothName: null, networkHost: '10.0.0.3', networkPort: 9100, paperSize: '58mm', active: true, fallbackPrinterId: null }, actor)
  await setPrintRoute('cat-food', 'kitchen')
  await setPrintRoute('cat-drink', 'bar')
}

async function seedProduct(id: string, categoryId: string): Promise<Product> {
  const p: Product = {
    id, categoryId, name: id, sku: id, barcode: null, price: 20000, costPrice: 5000, unit: 'pcs',
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

describe('Print queue', () => {
  it('routing: makanan → kitchen, minuman → bar (printer berbeda)', async () => {
    await seedPrinters()
    await seedProduct('nasi', 'cat-food')
    await seedProduct('kopi', 'cat-drink')
    const order = await newOrder()
    await addOrderItem({ orderId: order.id, productId: 'nasi', productName: 'Nasi', unitPrice: 20000, qty: 1, modifiers: [], notes: '' })
    await addOrderItem({ orderId: order.id, productId: 'kopi', productName: 'Kopi', unitPrice: 20000, qty: 2, modifiers: [], notes: '' })

    await sendOrderToKitchen(order.id, actor)

    const jobs = await listPrintJobs()
    const kt = jobs.filter((j) => j.kind === 'kitchen_ticket')
    expect(kt.map((j) => j.station).sort()).toEqual(['bar', 'kitchen'])
    expect(kt.every((j) => j.status === 'PRINTED')).toBe(true)
    expect(sent.map((s) => s.host).sort()).toEqual(['10.0.0.1', '10.0.0.2'])
  })

  it('printer offline saat dikirim → job RETRYING, tak batalkan pesanan; item tetap terkirim', async () => {
    await seedPrinters()
    await seedProduct('nasi', 'cat-food')
    const order = await newOrder()
    await addOrderItem({ orderId: order.id, productId: 'nasi', productName: 'Nasi', unitPrice: 20000, qty: 1, modifiers: [], notes: '' })
    failNext = true
    await sendOrderToKitchen(order.id, actor)

    const job = (await listPrintJobs()).find((j) => j.kind === 'kitchen_ticket')!
    expect(job.status).toBe('RETRYING')
    expect(job.attempts).toBe(1)
    expect((await db.orders.get(order.id))?.lifecycleStatus).not.toBe('VOIDED')
    expect((await db.orderItems.where('orderId').equals(order.id).first())?.kitchenPrintedAt).toBeTruthy()
  })

  it('retry tidak mencetak dua kali (job idempoten)', async () => {
    await seedPrinters()
    await seedProduct('nasi', 'cat-food')
    const order = await newOrder()
    await addOrderItem({ orderId: order.id, productId: 'nasi', productName: 'Nasi', unitPrice: 20000, qty: 1, modifiers: [], notes: '' })
    failNext = true
    await sendOrderToKitchen(order.id, actor)
    expect(sent).toHaveLength(0)

    // sendOrderToKitchen lagi → tak ada item baru → tak ada job baru
    await sendOrderToKitchen(order.id, actor)
    const jobs = (await listPrintJobs()).filter((j) => j.kind === 'kitchen_ticket')
    expect(jobs).toHaveLength(1)

    failNext = false
    const job = jobs[0]
    await db.printJobs.update(job.id, { updatedAt: 0 }) // lewati backoff
    await retryPrintJob(job.id, actor)
    expect(sent).toHaveLength(1)
    expect((await db.printJobs.get(job.id))?.status).toBe('PRINTED')
  })

  it('item tambahan hanya mencetak item baru, bukan pesanan lama', async () => {
    await seedPrinters()
    await seedProduct('nasi', 'cat-food')
    await seedProduct('ayam', 'cat-food')
    const order = await newOrder()
    await addOrderItem({ orderId: order.id, productId: 'nasi', productName: 'Nasi', unitPrice: 20000, qty: 1, modifiers: [], notes: '' })
    await sendOrderToKitchen(order.id, actor)
    sent.length = 0

    await addOrderItem({ orderId: order.id, productId: 'ayam', productName: 'Ayam', unitPrice: 20000, qty: 1, modifiers: [], notes: '' })
    await sendOrderToKitchen(order.id, actor)

    const tickets = await db.kitchenTickets.where('orderId').equals(order.id).sortBy('sequenceNo')
    expect(tickets).toHaveLength(2)
    expect(tickets[1].sequenceNo).toBe(2)
    expect(tickets[1].itemIds).toHaveLength(1) // hanya "ayam"
    const job2 = (await listPrintJobs()).find((j) => j.ticketId === tickets[1].id)!
    expect((job2.payload as { lines: unknown[] }).lines).toHaveLength(1)
  })

  it('bayar sukses walau printer nota gagal — job RETRYING, order tetap COMPLETED', async () => {
    await seedPrinters()
    await seedProduct('nasi', 'cat-food')
    const order = await newOrder()
    await addOrderItem({ orderId: order.id, productId: 'nasi', productName: 'Nasi', unitPrice: 20000, qty: 1, modifiers: [], notes: '' })
    failNext = true
    const res = await finalizePayment({ orderId: order.id, payments: [{ method: 'cash', amount: 20000 }], confirmedByUserId: 'u1' })
    expect(res.order.lifecycleStatus).toBe('COMPLETED')
    const receiptJob = (await listPrintJobs()).find((j) => j.kind === 'receipt')!
    expect(['RETRYING', 'PERMANENTLY_FAILED']).toContain(receiptJob.status)
  })

  it('tak ada printer untuk station → job QUEUED dengan catatan, tak crash', async () => {
    // hanya printer kasir
    await savePrinter({ name: 'Kasir', station: 'cashier', connectionType: 'network', bluetoothAddress: null, bluetoothName: null, networkHost: '10.0.0.3', networkPort: 9100, paperSize: '58mm', active: true, fallbackPrinterId: null }, actor)
    await seedProduct('nasi', 'cat-food')
    await setPrintRoute('cat-food', 'kitchen')
    const order = await newOrder()
    await addOrderItem({ orderId: order.id, productId: 'nasi', productName: 'Nasi', unitPrice: 20000, qty: 1, modifiers: [], notes: '' })
    await sendOrderToKitchen(order.id, actor)
    const job = (await listPrintJobs()).find((j) => j.kind === 'kitchen_ticket')!
    expect(['QUEUED', 'RETRYING', 'PERMANENTLY_FAILED']).toContain(job.status)
    expect(job.lastError).toMatch(/printer/i)
  })
})
