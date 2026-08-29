import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { addExpectedCash } from '@/db/repositories/shifts'
import type { Order, OrderItem, Payment, PaymentMethod, Product, ReturnRecord } from '@/types/domain'

export class OrderAlreadyFinalizedError extends Error {
  constructor() {
    super('Pesanan sudah dibayar atau dibatalkan sebelumnya.')
    this.name = 'OrderAlreadyFinalizedError'
  }
}

export class InsufficientPaymentError extends Error {
  constructor() {
    super('Jumlah pembayaran kurang dari total tagihan.')
    this.name = 'InsufficientPaymentError'
  }
}

export interface PaymentInput {
  method: PaymentMethod
  amount: number
  receivedAmount?: number
  reference?: string
}

/**
 * Menyelesaikan pembayaran secara atomik: memverifikasi status pesanan (mencegah klik ganda /
 * pembayaran dobel), mengurangi stok tepat satu kali, mencatat pembayaran, memperbarui status
 * meja, dan mendaftarkan seluruh perubahan ke antrean sinkronisasi — semua dalam satu transaksi.
 */
export async function finalizePayment(params: {
  orderId: string
  payments: PaymentInput[]
  confirmedByUserId: string
}): Promise<{ order: Order; payments: Payment[] }> {
  return db.transaction(
    'rw',
    [db.orders, db.orderItems, db.products, db.ingredients, db.recipes, db.stockMovements, db.cafeTables, db.payments, db.syncQueue, db.shifts, db.cashMovements],
    async () => {
      const order = await db.orders.get(params.orderId)
      if (!order) throw new Error('Pesanan tidak ditemukan')
      if (order.status !== 'open') throw new OrderAlreadyFinalizedError()

      const totalPaid = params.payments.reduce((sum, p) => sum + p.amount, 0)
      if (totalPaid < order.grandTotal) throw new InsufficientPaymentError()

      const items = await db.orderItems.where('orderId').equals(order.id).filter((i) => !i.voided).toArray()
      for (const item of items) {
        await deductStockForItem(item, order.id)
      }

      const now = Date.now()
      const createdPayments: Payment[] = []
      for (const p of params.payments) {
        const payment: Payment = {
          id: newId(),
          orderId: order.id,
          method: p.method,
          amount: p.amount,
          receivedAmount: p.receivedAmount ?? null,
          changeAmount: p.receivedAmount != null ? Math.max(0, p.receivedAmount - p.amount) : null,
          reference: p.reference ?? null,
          confirmedByUserId: params.confirmedByUserId,
          createdAt: now,
        }
        await db.payments.add(payment)
        await enqueueSync('payments', payment.id, payment)
        createdPayments.push(payment)
        if (p.method === 'cash' && order.shiftId) {
          await addExpectedCash(order.shiftId, p.amount)
        }
      }

      await db.orders.update(order.id, { status: 'paid', paidAt: now, updatedAt: now })
      const paidOrder = await db.orders.get(order.id)
      if (paidOrder) await enqueueSync('orders', order.id, paidOrder)

      if (order.type === 'dine_in' && order.tableId) {
        const table = await db.cafeTables.get(order.tableId)
        if (table) {
          await db.cafeTables.update(order.tableId, { status: 'needs_cleaning', updatedAt: now })
        }
      }

      return { order: paidOrder ?? order, payments: createdPayments }
    },
  )
}

async function deductStockForItem(item: OrderItem, orderId: string): Promise<void> {
  const product = await db.products.get(item.productId)
  if (!product) return

  if (product.trackOwnStock) {
    await applyProductStockDelta(product, -item.qty, 'sale', orderId)
    return
  }

  const recipe = await db.recipes.where('productId').equals(product.id).first()
  if (!recipe) return
  for (const recipeItem of recipe.items) {
    const ingredient = await db.ingredients.get(recipeItem.ingredientId)
    if (!ingredient) continue
    await applyIngredientStockDelta(ingredient.id, -(recipeItem.qty * item.qty), 'sale', orderId)
  }
}

async function applyProductStockDelta(
  product: Product,
  qtyDelta: number,
  reason: 'sale' | 'return',
  refOrderId: string,
): Promise<void> {
  const resultingQty = Math.round((product.stockQty + qtyDelta) * 1000) / 1000
  await db.products.update(product.id, {
    stockQty: resultingQty,
    isAvailable: resultingQty > 0 ? product.isAvailable : false,
    updatedAt: Date.now(),
  })
  const movement = {
    id: newId(),
    itemType: 'product' as const,
    itemId: product.id,
    itemName: product.name,
    reason,
    qtyDelta,
    resultingQty,
    note: '',
    userId: 'system',
    refOrderId,
    createdAt: Date.now(),
  }
  await db.stockMovements.add(movement)
  await enqueueSync('stockMovements', movement.id, movement)
  const updated = await db.products.get(product.id)
  if (updated) await enqueueSync('products', product.id, updated)
}

async function applyIngredientStockDelta(
  ingredientId: string,
  qtyDelta: number,
  reason: 'sale' | 'return',
  refOrderId: string,
): Promise<void> {
  const ingredient = await db.ingredients.get(ingredientId)
  if (!ingredient) return
  const resultingQty = Math.round((ingredient.stockQty + qtyDelta) * 1000) / 1000
  await db.ingredients.update(ingredientId, { stockQty: resultingQty, updatedAt: Date.now() })
  const movement = {
    id: newId(),
    itemType: 'ingredient' as const,
    itemId: ingredientId,
    itemName: ingredient.name,
    reason,
    qtyDelta,
    resultingQty,
    note: '',
    userId: 'system',
    refOrderId,
    createdAt: Date.now(),
  }
  await db.stockMovements.add(movement)
  await enqueueSync('stockMovements', movement.id, movement)
  const updated = await db.ingredients.get(ingredientId)
  if (updated) await enqueueSync('ingredients', ingredientId, updated)

  const affectedRecipes = await db.recipes.filter((r) => r.items.some((i) => i.ingredientId === ingredientId)).toArray()
  for (const recipe of affectedRecipes) {
    const relatedProduct = await db.products.get(recipe.productId)
    if (!relatedProduct) continue
    const canFulfill = await recipeCanFulfillOneUnit(recipe.items)
    if (relatedProduct.isAvailable !== canFulfill) {
      await db.products.update(recipe.productId, { isAvailable: canFulfill, updatedAt: Date.now() })
      const updatedProduct = await db.products.get(recipe.productId)
      if (updatedProduct) await enqueueSync('products', recipe.productId, updatedProduct)
    }
  }
}

async function recipeCanFulfillOneUnit(items: { ingredientId: string; qty: number }[]): Promise<boolean> {
  for (const item of items) {
    const ingredient = await db.ingredients.get(item.ingredientId)
    if (!ingredient || ingredient.stockQty < item.qty) return false
  }
  return true
}

/** Membatalkan seluruh transaksi (harus dengan PIN supervisor). Mengembalikan stok jika sudah dibayar. */
export async function voidOrder(params: {
  orderId: string
  reason: string
  approverUserId: string
  approverName: string
}): Promise<void> {
  await db.transaction(
    'rw',
    [db.orders, db.orderItems, db.products, db.ingredients, db.recipes, db.stockMovements, db.cafeTables, db.syncQueue, db.auditLogs],
    async () => {
      const order = await db.orders.get(params.orderId)
      if (!order) throw new Error('Pesanan tidak ditemukan')
      if (order.status === 'void') throw new Error('Pesanan sudah dibatalkan sebelumnya')

      if (order.status === 'paid') {
        const items = await db.orderItems.where('orderId').equals(order.id).filter((i) => !i.voided).toArray()
        for (const item of items) {
          await restockForItem(item, order.id)
        }
      }

      const now = Date.now()
      await db.orders.update(order.id, {
        status: 'void',
        voidReason: params.reason,
        voidedBy: params.approverUserId,
        voidedAt: now,
        updatedAt: now,
      })
      const updated = await db.orders.get(order.id)
      if (updated) await enqueueSync('orders', order.id, updated)

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

async function restockForItem(item: OrderItem, orderId: string): Promise<void> {
  const product = await db.products.get(item.productId)
  if (!product) return
  if (product.trackOwnStock) {
    await applyProductStockDelta(product, item.qty, 'return', orderId)
    return
  }
  const recipe = await db.recipes.where('productId').equals(product.id).first()
  if (!recipe) return
  for (const recipeItem of recipe.items) {
    await applyIngredientStockDelta(recipeItem.ingredientId, recipeItem.qty * item.qty, 'return', orderId)
  }
}

/** Retur sebagian/seluruh item dari transaksi yang sudah dibayar. Stok dikembalikan jika restock=true. */
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
    [db.orders, db.orderItems, db.products, db.ingredients, db.recipes, db.stockMovements, db.returns, db.syncQueue, db.auditLogs],
    async () => {
      const order = await db.orders.get(params.orderId)
      if (!order) throw new Error('Pesanan tidak ditemukan')
      if (order.status !== 'paid' && order.status !== 'completed') {
        throw new Error('Hanya transaksi yang sudah dibayar yang dapat diretur')
      }

      const items = await db.orderItems
        .where('id')
        .anyOf(params.orderItemIds)
        .filter((i) => i.orderId === params.orderId && !i.voided)
        .toArray()
      if (items.length === 0) throw new Error('Tidak ada item valid untuk diretur')

      let refundAmount = 0
      for (const item of items) {
        refundAmount += item.lineTotal
        await db.orderItems.update(item.id, {
          voided: true,
          voidReason: `Retur: ${params.reason}`,
          updatedAt: Date.now(),
        })
        const updated = await db.orderItems.get(item.id)
        if (updated) await enqueueSync('orderItems', item.id, updated)
        if (params.restock) {
          await restockForItem(item, order.id)
        }
      }

      const record: ReturnRecord = {
        id: newId(),
        orderId: params.orderId,
        orderItemIds: params.orderItemIds,
        reason: params.reason,
        refundAmount,
        restocked: params.restock,
        userId: params.approverUserId,
        createdAt: Date.now(),
      }
      await db.returns.add(record)
      await enqueueSync('returns', record.id, record)

      await recordAuditLog({
        userId: params.approverUserId,
        userName: params.approverName,
        action: 'order.return',
        entityType: 'order',
        entityId: order.id,
        details: `Retur sebesar ${refundAmount} pada pesanan ${order.orderNumber}. Alasan: ${params.reason}`,
      })

      return record
    },
  )
}
