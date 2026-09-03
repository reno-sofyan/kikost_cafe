import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { addExpectedCash } from '@/db/repositories/shifts'
import { transitionOrder } from '@/db/repositories/orders'
import { deductSaleStock, findOrderStockShortages } from '@/db/repositories/stock'
import type { Bill, BillPaymentStatus, Order, OrderItem, Payment, PaymentInput } from '@/types/domain'

export class InsufficientPaymentError extends Error {
  constructor() {
    super('Jumlah pembayaran kurang dari total tagihan.')
    this.name = 'InsufficientPaymentError'
  }
}

export class InsufficientStockError extends Error {
  constructor(public readonly items: string[]) {
    super(`Stok bahan tidak mencukupi untuk: ${items.join(', ')}. Butuh persetujuan supervisor untuk lanjut.`)
    this.name = 'InsufficientStockError'
  }
}

export class OrderAlreadyFinalizedError extends Error {
  constructor() {
    super('Pesanan sudah dibayar atau dibatalkan sebelumnya.')
    this.name = 'OrderAlreadyFinalizedError'
  }
}

export function implicitBillId(orderId: string): string {
  return `bill_${orderId}`
}

function paymentKey(billId: string, method: string, amount: number, index: number): string {
  return `pay_${billId}_${method}_${Math.round(amount)}_${index}`
}

function statusFor(bill: { grandTotal: number; amountPaid: number; amountRefunded: number }): BillPaymentStatus {
  if (bill.amountRefunded >= bill.grandTotal && bill.amountRefunded > 0) return 'REFUNDED'
  if (bill.amountRefunded > 0) return 'PARTIALLY_REFUNDED'
  if (bill.amountPaid >= bill.grandTotal) return 'PAID'
  if (bill.amountPaid > 0) return 'PARTIALLY_PAID'
  return 'UNPAID'
}

export async function listOrderBills(orderId: string): Promise<Bill[]> {
  return db.bills.where('orderId').equals(orderId).sortBy('createdAt')
}

/**
 * Memastikan order punya bill "seluruh order" (id deterministik). Menyelaraskan
 * total bill dengan total order. Dipanggil di dalam transaksi pemanggil (harus
 * mencakup db.bills & db.syncQueue).
 */
export async function ensureOrderBill(order: Order): Promise<Bill> {
  const id = implicitBillId(order.id)
  const existing = await db.bills.get(id)
  const now = Date.now()
  const base = {
    subtotal: order.subtotal,
    discountAmount: order.discountAmount,
    serviceChargeAmount: order.serviceChargeAmount,
    taxAmount: order.taxAmount,
    roundingAdjustment: order.roundingAdjustment,
    grandTotal: order.grandTotal,
  }
  // Bila tagihan sudah dipecah (ada bill lain), JANGAN samakan bill utama dengan
  // total order — tiap bill memegang porsinya sendiri.
  const hasSplit = (await db.bills.where('orderId').equals(order.id).toArray()).some((b) => b.id !== id)
  if (existing) {
    // Selama belum ada pembayaran & belum dipecah, jaga total bill sinkron dengan order.
    if (existing.amountPaid === 0 && existing.amountRefunded === 0 && !hasSplit) {
      const updated: Bill = { ...existing, ...base, paymentStatus: statusFor({ ...base, amountPaid: 0, amountRefunded: 0 }), updatedAt: now }
      await db.bills.put(updated)
      await enqueueSync('bills', id, updated)
      return updated
    }
    return existing
  }
  const bill: Bill = {
    id,
    orderId: order.id,
    label: 'Tagihan',
    itemIds: 'all',
    portionAmount: null,
    ...base,
    amountPaid: 0,
    amountRefunded: 0,
    paymentStatus: 'UNPAID',
    createdAt: now,
    updatedAt: now,
  }
  await db.bills.add(bill)
  await enqueueSync('bills', id, bill)
  return bill
}

/**
 * Membayar sebuah bill. Mendukung pembayaran sebulat (default) atau sebagian bila
 * `allowPartial`. Ketika SELURUH bill order menjadi PAID: potong stok sekali,
 * transisikan order ke COMPLETED, tandai meja. Idempoten lewat id pembayaran.
 */
export async function payBill(params: {
  billId: string
  payments: PaymentInput[]
  confirmedByUserId: string
  allowPartial?: boolean
  allowNegativeStock?: { approverUserId: string; approverName: string }
}): Promise<{ order: Order; bill: Bill; payments: Payment[] }> {
  return db.transaction(
    'rw',
    [db.orders, db.orderItems, db.bills, db.payments, db.products, db.ingredients, db.recipes, db.stockMovements, db.cafeTables, db.syncQueue, db.shifts, db.cashMovements, db.auditLogs],
    async () => {
      let bill = await db.bills.get(params.billId)
      if (!bill) throw new Error('Tagihan tidak ditemukan')
      const order = await db.orders.get(bill.orderId)
      if (!order) throw new Error('Pesanan tidak ditemukan')

      // Bill "seluruh order" tanpa pecahan: total selalu ikut order terkini
      // (mis. item ditambahkan setelah pembayaran sebagian).
      const otherBills = (await db.bills.where('orderId').equals(order.id).toArray()).filter((b) => b.id !== bill!.id)
      if (bill.itemIds === 'all' && otherBills.length === 0 && bill.grandTotal !== order.grandTotal) {
        bill = {
          ...bill,
          subtotal: order.subtotal,
          discountAmount: order.discountAmount,
          serviceChargeAmount: order.serviceChargeAmount,
          taxAmount: order.taxAmount,
          roundingAdjustment: order.roundingAdjustment,
          grandTotal: order.grandTotal,
        }
      }
      if (order.lifecycleStatus === 'COMPLETED' || order.lifecycleStatus === 'VOIDED' || order.lifecycleStatus === 'CANCELLED') {
        throw new OrderAlreadyFinalizedError()
      }
      if (bill.paymentStatus === 'PAID' || bill.paymentStatus === 'VOIDED') throw new OrderAlreadyFinalizedError()

      const now = Date.now()
      const created: Payment[] = []
      let addedThisCall = 0
      for (let i = 0; i < params.payments.length; i++) {
        const p = params.payments[i]
        const key = paymentKey(bill.id, p.method, p.amount, i)
        const existing = await db.payments.get(key)
        if (existing) {
          created.push(existing)
          continue
        }
        const payment: Payment = {
          id: key,
          orderId: order.id,
          billId: bill.id,
          method: p.method,
          amount: p.amount,
          receivedAmount: p.receivedAmount ?? null,
          changeAmount: p.receivedAmount != null ? Math.max(0, p.receivedAmount - p.amount) : null,
          reference: p.reference ?? null,
          idempotencyKey: key,
          reversalOfPaymentId: null,
          confirmedByUserId: params.confirmedByUserId,
          createdAt: now,
        }
        await db.payments.add(payment)
        await enqueueSync('payments', payment.id, payment)
        created.push(payment)
        addedThisCall += p.amount
        if (p.method === 'cash' && order.shiftId) await addExpectedCash(order.shiftId, p.amount)
      }

      const newPaid = bill.amountPaid + addedThisCall
      if (newPaid < bill.grandTotal && !params.allowPartial) {
        throw new InsufficientPaymentError()
      }

      const updatedBill: Bill = {
        ...bill,
        amountPaid: newPaid,
        paymentStatus: statusFor({ grandTotal: bill.grandTotal, amountPaid: newPaid, amountRefunded: bill.amountRefunded }),
        updatedAt: now,
      }
      await db.bills.put(updatedBill)
      await enqueueSync('bills', updatedBill.id, updatedBill)

      // Order selesai hanya bila SEMUA bill-nya PAID.
      const bills = await db.bills.where('orderId').equals(order.id).toArray()
      const allPaid = bills.length > 0 && bills.every((b) => b.paymentStatus === 'PAID')

      if (allPaid) {
        const items = await db.orderItems
          .where('orderId')
          .equals(order.id)
          .filter((i) => !i.voided && !i.removed)
          .toArray()
        const lines = items.map((it: OrderItem) => ({ productId: it.productId, qty: it.qty }))

        if (!params.allowNegativeStock) {
          const short = await findOrderStockShortages(lines)
          if (short.length > 0) throw new InsufficientStockError(short)
        }
        await deductSaleStock(lines, order.id, params.confirmedByUserId)

        if (params.allowNegativeStock) {
          await recordAuditLog({
            userId: params.allowNegativeStock.approverUserId,
            userName: params.allowNegativeStock.approverName,
            action: 'stock.negative.override',
            entityType: 'order',
            entityId: order.id,
            details: `Pembayaran ${order.orderNumber} diselesaikan meski stok bahan tidak mencukupi.`,
          })
        }

        await transitionOrder(order.id, 'COMPLETED', { paidAt: now })

        if (order.type === 'dine_in' && order.tableId) {
          const table = await db.cafeTables.get(order.tableId)
          if (table) await db.cafeTables.update(order.tableId, { status: 'needs_cleaning', updatedAt: now })
        }
      }

      const finalOrder = (await db.orders.get(order.id)) ?? order
      return { order: finalOrder, bill: updatedBill, payments: created }
    },
  )
}

/**
 * Memecah bill "seluruh order" jadi bill terpisah bernominal `amount`; sisanya
 * tetap di bill utama. Hanya untuk bill yang belum ada pembayaran.
 */
export async function splitBillByAmount(orderId: string, amount: number, label: string): Promise<Bill> {
  return db.transaction('rw', [db.orders, db.bills, db.syncQueue], async () => {
    const order = await db.orders.get(orderId)
    if (!order) throw new Error('Pesanan tidak ditemukan')
    const main = await ensureOrderBill(order)
    if (main.amountPaid > 0) throw new Error('Tidak bisa memecah tagihan yang sudah ada pembayaran.')
    const portion = Math.min(Math.max(0, Math.round(amount)), main.grandTotal - 1)
    if (portion <= 0) throw new Error('Nominal pecahan tidak valid.')
    const now = Date.now()

    const portionBill: Bill = {
      id: `bill_${orderId}_p${(await db.bills.where('orderId').equals(orderId).count()) + 1}`,
      orderId,
      label: label.trim() || 'Pecahan',
      itemIds: [],
      portionAmount: portion,
      subtotal: portion,
      discountAmount: 0,
      serviceChargeAmount: 0,
      taxAmount: 0,
      roundingAdjustment: 0,
      grandTotal: portion,
      amountPaid: 0,
      amountRefunded: 0,
      paymentStatus: 'UNPAID',
      createdAt: now,
      updatedAt: now,
    }
    await db.bills.add(portionBill)
    await enqueueSync('bills', portionBill.id, portionBill)

    const remain = main.grandTotal - portion
    const updatedMain: Bill = {
      ...main,
      grandTotal: remain,
      subtotal: Math.max(0, main.subtotal - portion),
      paymentStatus: 'UNPAID',
      updatedAt: now,
    }
    await db.bills.put(updatedMain)
    await enqueueSync('bills', updatedMain.id, updatedMain)
    return portionBill
  })
}

/**
 * Memecah tagihan satu order menjadi beberapa bill per-ITEM (partisi: tiap item
 * aktif masuk tepat satu grup). Diskon/SC/pajak/pembulatan order dialokasikan
 * proporsional terhadap subtotal tiap grup; bill terakhir menyerap sisa pembulatan
 * sehingga jumlah seluruh bill = grand total order persis. Hanya bila belum ada
 * pembayaran & belum pernah dipecah.
 */
export async function splitBillByItems(
  orderId: string,
  groups: string[][],
  labels?: string[],
): Promise<Bill[]> {
  return db.transaction('rw', [db.orders, db.orderItems, db.bills, db.syncQueue], async () => {
    const order = await db.orders.get(orderId)
    if (!order) throw new Error('Pesanan tidak ditemukan')
    const activeItems = await db.orderItems
      .where('orderId')
      .equals(orderId)
      .filter((i) => !i.voided && !i.removed)
      .toArray()

    const main = await ensureOrderBill(order)
    if (main.amountPaid > 0 || main.amountRefunded > 0) {
      throw new Error('Tidak bisa memecah tagihan yang sudah ada pembayaran.')
    }
    const alreadySplit = (await db.bills.where('orderId').equals(orderId).toArray()).some((b) => b.id !== main.id)
    if (alreadySplit) throw new Error('Tagihan sudah dipecah. Gabungkan dulu untuk memecah ulang.')

    const validGroups = groups.map((g) => [...new Set(g)]).filter((g) => g.length > 0)
    if (validGroups.length < 2) throw new Error('Butuh minimal dua bagian.')

    const assigned = validGroups.flat()
    if (new Set(assigned).size !== assigned.length) throw new Error('Satu item tidak boleh masuk dua bagian.')
    const activeIds = new Set(activeItems.map((i) => i.id))
    if (assigned.some((id) => !activeIds.has(id))) throw new Error('Ada item yang tidak valid.')
    if (assigned.length !== activeItems.length) throw new Error('Semua item harus masuk salah satu bagian.')

    const itemById = new Map(activeItems.map((i) => [i.id, i]))
    const groupSubtotals = validGroups.map((g) => g.reduce((s, id) => s + itemById.get(id)!.lineTotal, 0))
    const orderSubtotal = order.subtotal || groupSubtotals.reduce((a, b) => a + b, 0) || 1

    const allocate = (total: number): number[] => {
      const out = groupSubtotals.map((gs) => Math.round((total * gs) / orderSubtotal))
      out[out.length - 1] = total - out.slice(0, -1).reduce((a, b) => a + b, 0)
      return out
    }
    const discs = allocate(order.discountAmount)
    const scs = allocate(order.serviceChargeAmount)
    const taxes = allocate(order.taxAmount)
    const grands = allocate(order.grandTotal)

    const now = Date.now()
    const bills: Bill[] = []
    for (let i = 0; i < validGroups.length; i++) {
      const billId = i === 0 ? main.id : `${main.id}_i${i}`
      const bill: Bill = {
        id: billId,
        orderId,
        label: labels?.[i]?.trim() || `Tagihan ${i + 1}`,
        itemIds: validGroups[i],
        portionAmount: null,
        subtotal: groupSubtotals[i],
        discountAmount: discs[i],
        serviceChargeAmount: scs[i],
        taxAmount: taxes[i],
        roundingAdjustment: grands[i] - (groupSubtotals[i] - discs[i] + scs[i] + taxes[i]),
        grandTotal: grands[i],
        amountPaid: 0,
        amountRefunded: 0,
        paymentStatus: grands[i] <= 0 ? 'PAID' : 'UNPAID',
        createdAt: i === 0 ? main.createdAt : now,
        updatedAt: now,
      }
      if (i === 0) await db.bills.put(bill)
      else await db.bills.add(bill)
      await enqueueSync('bills', billId, bill)
      bills.push(bill)
    }
    return bills
  })
}

/** Menggabungkan kembali bill yang dipecah menjadi satu bill "seluruh order". */
export async function unsplitBills(orderId: string): Promise<void> {
  await db.transaction('rw', [db.orders, db.bills, db.syncQueue], async () => {
    const order = await db.orders.get(orderId)
    if (!order) throw new Error('Pesanan tidak ditemukan')
    const bills = await db.bills.where('orderId').equals(orderId).toArray()
    if (bills.some((b) => b.amountPaid > 0 || b.amountRefunded > 0)) {
      throw new Error('Tidak bisa menggabungkan tagihan yang sudah ada pembayaran.')
    }
    const mainId = implicitBillId(orderId)
    for (const b of bills) {
      if (b.id === mainId) continue
      await db.bills.delete(b.id)
      // Backend tak punya operasi hapus: dorong bill "kosong & lunas" supaya
      // re-sync tak menghidupkan tagihan lama & tak menghalangi order selesai.
      await enqueueSync('bills', b.id, {
        ...b,
        itemIds: [],
        subtotal: 0,
        discountAmount: 0,
        serviceChargeAmount: 0,
        taxAmount: 0,
        roundingAdjustment: 0,
        grandTotal: 0,
        paymentStatus: 'PAID',
        updatedAt: Date.now(),
      })
    }
    const now = Date.now()
    const main: Bill = {
      id: mainId,
      orderId,
      label: 'Tagihan',
      itemIds: 'all',
      portionAmount: null,
      subtotal: order.subtotal,
      discountAmount: order.discountAmount,
      serviceChargeAmount: order.serviceChargeAmount,
      taxAmount: order.taxAmount,
      roundingAdjustment: order.roundingAdjustment,
      grandTotal: order.grandTotal,
      amountPaid: 0,
      amountRefunded: 0,
      paymentStatus: order.grandTotal <= 0 ? 'PAID' : 'UNPAID',
      createdAt: bills.find((b) => b.id === mainId)?.createdAt ?? now,
      updatedAt: now,
    }
    await db.bills.put(main)
    await enqueueSync('bills', mainId, main)
  })
}
