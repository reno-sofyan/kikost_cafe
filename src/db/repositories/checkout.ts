import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { addExpectedCash } from '@/db/repositories/shifts'
import { transitionOrder } from '@/db/repositories/orders'
import { restockSaleStock } from '@/db/repositories/stock'
import {
  ensureOrderBill,
  implicitBillId,
  InsufficientPaymentError,
  InsufficientStockError,
  OrderAlreadyFinalizedError,
  payBill,
} from '@/db/repositories/billing'
import type { Order, OrderItem, Payment, PaymentInput, PaymentMethod, ReturnRecord } from '@/types/domain'

export { InsufficientPaymentError, InsufficientStockError, OrderAlreadyFinalizedError }
export type { PaymentInput }

/**
 * Menyelesaikan pembayaran satu order. Membuat bill "seluruh order" bila belum
 * ada, lalu membayarnya lewat `payBill` — yang menangani pembayaran sebulat atau
 * sebagian, pemotongan stok sekali saat lunas, transisi order ke COMPLETED, dan
 * idempotensi. Tetap kompatibel dengan pemanggil lama.
 */
export async function finalizePayment(params: {
  orderId: string
  payments: PaymentInput[]
  confirmedByUserId: string
  allowPartial?: boolean
  allowNegativeStock?: { approverUserId: string; approverName: string }
}): Promise<{ order: Order; payments: Payment[] }> {
  await db.transaction('rw', [db.orders, db.bills, db.syncQueue], async () => {
    const order = await db.orders.get(params.orderId)
    if (!order) throw new Error('Pesanan tidak ditemukan')
    await ensureOrderBill(order)
  })
  const result = await payBill({
    billId: implicitBillId(params.orderId),
    payments: params.payments,
    confirmedByUserId: params.confirmedByUserId,
    allowPartial: params.allowPartial,
    allowNegativeStock: params.allowNegativeStock,
  })
  return { order: result.order, payments: result.payments }
}

/**
 * Membatalkan seluruh transaksi (harus dengan PIN supervisor).
 * - Order yang sudah dibayar: buat pembayaran pembalik (amount negatif) untuk tiap
 *   pembayaran asli, sesuaikan kas shift, dan (opsional) kembalikan stok.
 * - Stok TIDAK otomatis dikembalikan kecuali `restock: true`.
 */
export async function voidOrder(params: {
  orderId: string
  reason: string
  approverUserId: string
  approverName: string
  restock?: boolean
}): Promise<void> {
  await db.transaction(
    'rw',
    [db.orders, db.orderItems, db.bills, db.products, db.ingredients, db.recipes, db.stockMovements, db.cafeTables, db.payments, db.shifts, db.cashMovements, db.syncQueue, db.auditLogs],
    async () => {
      const order = await db.orders.get(params.orderId)
      if (!order) throw new Error('Pesanan tidak ditemukan')
      if (order.status === 'void') throw new Error('Pesanan sudah dibatalkan sebelumnya')
      const now = Date.now()
      const wasPaid = order.status === 'paid' || order.status === 'completed'

      if (wasPaid) {
        const original = await db.payments.where('orderId').equals(order.id).toArray()
        for (const orig of original.filter((p) => p.amount > 0 && !p.reversalOfPaymentId)) {
          await createReversalPayment(order, orig, -orig.amount, params.approverUserId, now)
        }
        if (params.restock) {
          const items = await db.orderItems
            .where('orderId')
            .equals(order.id)
            .filter((i) => !i.voided && !i.removed)
            .toArray()
          await restockSaleStock(
            items.map((it) => ({ productId: it.productId, qty: it.qty })),
            order.id,
            params.approverUserId,
          )
        }
      }

      await transitionOrder(order.id, 'VOIDED', {
        voidReason: params.reason,
        voidedBy: params.approverUserId,
        voidedAt: now,
      })
      for (const b of await db.bills.where('orderId').equals(order.id).toArray()) {
        await db.bills.update(b.id, { paymentStatus: 'VOIDED', updatedAt: now })
        const updated = await db.bills.get(b.id)
        if (updated) await enqueueSync('bills', b.id, updated)
      }

      if (order.tableId) {
        const table = await db.cafeTables.get(order.tableId)
        if (table && table.currentOrderId === order.id) {
          await db.cafeTables.update(order.tableId, {
            status: 'available',
            currentOrderId: null,
            occupiedSince: null,
            guestCount: null,
            updatedAt: now,
          })
        }
      }

      await recordAuditLog({
        userId: params.approverUserId,
        userName: params.approverName,
        action: 'order.void',
        entityType: 'order',
        entityId: order.id,
        details: `Pesanan ${order.orderNumber} dibatalkan. Alasan: ${params.reason}`,
      })
    },
  )
}

/**
 * Membuat pembayaran pembalik (amount negatif) yang mereferensikan pembayaran asli.
 * Menyesuaikan kas shift bila metode tunai. Dipanggil di dalam transaksi pemanggil.
 */
async function createReversalPayment(
  order: Order,
  original: { id: string; method: PaymentMethod; billId?: string },
  amount: number,
  approverUserId: string,
  at: number,
): Promise<Payment> {
  const key = `refund_${order.id}_${original.id}_${Math.round(Math.abs(amount))}`
  const existing = await db.payments.get(key)
  if (existing) return existing
  const reversal: Payment = {
    id: key,
    orderId: order.id,
    billId: original.billId ?? implicitBillId(order.id),
    method: original.method,
    amount,
    receivedAmount: null,
    changeAmount: null,
    reference: null,
    idempotencyKey: key,
    reversalOfPaymentId: original.id,
    confirmedByUserId: approverUserId,
    createdAt: at,
  }
  await db.payments.add(reversal)
  await enqueueSync('payments', reversal.id, reversal)
  if (original.method === 'cash' && order.shiftId) {
    await addExpectedCash(order.shiftId, amount)
  }
  return reversal
}

/**
 * Retur sebagian/seluruh item dari transaksi yang sudah dibayar. Membuat pembayaran
 * pembalik sebesar nilai item yang diretur; transaksi asli tetap utuh. Total refund
 * kumulatif tidak boleh melebihi grand total. Stok tidak dikembalikan kecuali
 * `restock: true` (izin `refund.restock`).
 */
export async function returnOrderItems(params: {
  orderId: string
  orderItemIds: string[]
  reason: string
  restock: boolean
  approverUserId: string
  approverName: string
}): Promise<ReturnRecord> {
  return db.transaction(
    'rw',
    [db.orders, db.orderItems, db.bills, db.products, db.ingredients, db.recipes, db.stockMovements, db.returns, db.payments, db.shifts, db.cashMovements, db.syncQueue, db.auditLogs],
    async () => {
      const order = await db.orders.get(params.orderId)
      if (!order) throw new Error('Pesanan tidak ditemukan')
      if (order.status !== 'paid' && order.status !== 'completed') {
        throw new Error('Hanya transaksi yang sudah dibayar yang dapat diretur')
      }

      const items = await db.orderItems
        .where('id')
        .anyOf(params.orderItemIds)
        .filter((i) => i.orderId === params.orderId && !i.voided && !i.removed)
        .toArray()
      if (items.length === 0) throw new Error('Tidak ada item valid untuk diretur')

      const now = Date.now()
      let refundAmount = 0
      for (const item of items) {
        refundAmount += item.lineTotal
        await db.orderItems.update(item.id, { voided: true, voidReason: `Retur: ${params.reason}`, updatedAt: now })
        const updated = await db.orderItems.get(item.id)
        if (updated) await enqueueSync('orderItems', item.id, updated)
      }
      if (params.restock) {
        await restockSaleStock(
          items.map((it: OrderItem) => ({ productId: it.productId, qty: it.qty })),
          order.id,
          params.approverUserId,
        )
      }

      const priorRefunds = (await db.payments.where('orderId').equals(order.id).toArray())
        .filter((p) => p.amount < 0)
        .reduce((s, p) => s + Math.abs(p.amount), 0)
      if (priorRefunds + refundAmount > order.grandTotal + 1) {
        throw new Error('Total retur melebihi nilai transaksi asli.')
      }

      const payments = await db.payments.where('orderId').equals(order.id).toArray()
      const dominant = payments.filter((p) => p.amount > 0).sort((a, b) => b.amount - a.amount)[0]
      const reversal = dominant
        ? await createReversalPayment(order, dominant, -refundAmount, params.approverUserId, now)
        : null

      // Perbarui status refund bill.
      for (const b of await db.bills.where('orderId').equals(order.id).toArray()) {
        const refunded = b.amountRefunded + (b.id === (dominant?.billId ?? implicitBillId(order.id)) ? refundAmount : 0)
        const status = refunded >= b.grandTotal ? 'REFUNDED' : refunded > 0 ? 'PARTIALLY_REFUNDED' : b.paymentStatus
        await db.bills.update(b.id, { amountRefunded: refunded, paymentStatus: status, updatedAt: now })
        const updated = await db.bills.get(b.id)
        if (updated) await enqueueSync('bills', b.id, updated)
      }

      const record: ReturnRecord = {
        id: newId(),
        orderId: params.orderId,
        orderItemIds: params.orderItemIds,
        reason: params.reason,
        refundAmount,
        restocked: params.restock,
        reversalPaymentId: reversal?.id ?? null,
        userId: params.approverUserId,
        approverName: params.approverName,
        createdAt: now,
      }
      await db.returns.add(record)
      await enqueueSync('returns', record.id, record)

      await recordAuditLog({
        userId: params.approverUserId,
        userName: params.approverName,
        action: 'order.return',
        entityType: 'order',
        entityId: order.id,
        details: `Retur Rp${refundAmount} pada ${order.orderNumber}${params.restock ? ' (stok dikembalikan)' : ''}. Alasan: ${params.reason}`,
      })

      return record
    },
  )
}
