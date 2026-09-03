import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { addExpectedCash } from '@/db/repositories/shifts'
import { transitionOrder } from '@/db/repositories/orders'
import { recipeItemBaseQty } from '@/db/repositories/stock'
import type { Order, OrderItem, Payment, PaymentMethod, Product, RecipeItem, ReturnRecord } from '@/types/domain'

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

export class InsufficientStockError extends Error {
  constructor(public readonly items: string[]) {
    super(`Stok bahan tidak mencukupi untuk: ${items.join(', ')}. Butuh persetujuan supervisor untuk lanjut.`)
    this.name = 'InsufficientStockError'
  }
}

/**
 * Kunci idempotensi bisnis untuk sebuah pembayaran — deterministik dari
 * (orderId, method, amount, urutan). Dipakai sebagai `payment.id` sehingga dua
 * perangkat yang memproses pembayaran yang sama menghasilkan baris yang identik
 * dan LWW server men-dedup, bukan mencatat dobel.
 */
function paymentKey(orderId: string, method: string, amount: number, index: number): string {
  return `pay_${orderId}_${method}_${Math.round(amount)}_${index}`
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
  /** Diisi (dengan approver) untuk melewati blokir stok tidak mencukupi. */
  allowNegativeStock?: { approverUserId: string; approverName: string }
}): Promise<{ order: Order; payments: Payment[] }> {
  return db.transaction(
    'rw',
    [db.orders, db.orderItems, db.products, db.ingredients, db.recipes, db.stockMovements, db.cafeTables, db.payments, db.syncQueue, db.shifts, db.cashMovements, db.auditLogs],
    async () => {
      const order = await db.orders.get(params.orderId)
      if (!order) throw new Error('Pesanan tidak ditemukan')
      if (order.status !== 'open') throw new OrderAlreadyFinalizedError()

      const totalPaid = params.payments.reduce((sum, p) => sum + p.amount, 0)
      if (totalPaid < order.grandTotal) throw new InsufficientPaymentError()

      const items = await db.orderItems
        .where('orderId')
        .equals(order.id)
        .filter((i) => !i.voided && !i.removed)
        .toArray()

      // C5 — cek kecukupan stok SEBELUM memotong. Stok negatif hanya dengan approval.
      if (!params.allowNegativeStock) {
        const shortItems = await findStockShortages(items)
        if (shortItems.length > 0) throw new InsufficientStockError(shortItems)
      }

      const now = Date.now()
      for (const item of items) {
        await deductStockForItem(item, order.id, params.confirmedByUserId)
      }

      const createdPayments: Payment[] = []
      for (let index = 0; index < params.payments.length; index++) {
        const p = params.payments[index]
        const key = paymentKey(order.id, p.method, p.amount, index)
        const existing = await db.payments.get(key)
        if (existing) {
          createdPayments.push(existing)
          continue
        }
        const payment: Payment = {
          id: key,
          orderId: order.id,
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
        createdPayments.push(payment)
        if (p.method === 'cash' && order.shiftId) {
          await addExpectedCash(order.shiftId, p.amount)
        }
      }

      await transitionOrder(order.id, 'COMPLETED', { paidAt: now })
      const paidOrder = await db.orders.get(order.id)

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

/** Mengembalikan nama produk yang bahannya tidak cukup untuk memenuhi pesanan. */
async function findStockShortages(items: OrderItem[]): Promise<string[]> {
  const need = new Map<string, number>() // ingredientId -> total qty needed
  const productNeed = new Map<string, number>()
  const names = new Map<string, string>()
  for (const item of items) {
    const product = await db.products.get(item.productId)
    if (!product) continue
    if (product.trackOwnStock) {
      productNeed.set(product.id, (productNeed.get(product.id) ?? 0) + item.qty)
      names.set(product.id, product.name)
      continue
    }
    const recipe = await db.recipes.where('productId').equals(product.id).first()
    if (!recipe) continue
    for (const ri of recipe.items) {
      need.set(ri.ingredientId, (need.get(ri.ingredientId) ?? 0) + (await recipeItemBaseQty(ri)) * item.qty)
      names.set(ri.ingredientId, product.name)
    }
  }
  const short = new Set<string>()
  for (const [pid, qty] of productNeed) {
    const p = await db.products.get(pid)
    if (!p || p.stockQty < qty) short.add(names.get(pid) ?? pid)
  }
  for (const [iid, qty] of need) {
    const ing = await db.ingredients.get(iid)
    if (!ing || ing.stockQty < qty) short.add(names.get(iid) ?? iid)
  }
  return [...short]
}

async function deductStockForItem(item: OrderItem, orderId: string, userId: string): Promise<void> {
  const product = await db.products.get(item.productId)
  if (!product) return

  if (product.trackOwnStock) {
    await applyProductStockDelta(product, -item.qty, 'sale', orderId, userId)
    return
  }

  const recipe = await db.recipes.where('productId').equals(product.id).first()
  if (!recipe) return
  for (const recipeItem of recipe.items) {
    const ingredient = await db.ingredients.get(recipeItem.ingredientId)
    if (!ingredient) continue
    await applyIngredientStockDelta(ingredient.id, -((await recipeItemBaseQty(recipeItem)) * item.qty), 'sale', orderId, userId)
  }
}

async function applyProductStockDelta(
  product: Product,
  qtyDelta: number,
  reason: 'sale' | 'return',
  refOrderId: string,
  userId: string,
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
    userId,
    refOrderId,
    refType: 'order',
    refId: refOrderId,
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
  userId: string,
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
    userId,
    refOrderId,
    refType: 'order',
    refId: refOrderId,
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

async function recipeCanFulfillOneUnit(items: RecipeItem[]): Promise<boolean> {
  for (const item of items) {
    const ingredient = await db.ingredients.get(item.ingredientId)
    if (!ingredient || ingredient.stockQty < (await recipeItemBaseQty(item))) return false
  }
  return true
}

/**
 * Membatalkan seluruh transaksi (harus dengan PIN supervisor).
 * - Order yang sudah dibayar: buat pembayaran pembalik (amount negatif) untuk tiap
 *   pembayaran asli, sesuaikan kas shift, dan (opsional) kembalikan stok.
 * - Stok TIDAK otomatis dikembalikan kecuali `restock: true` diberikan oleh
 *   pengguna berwenang — makanan/minuman mungkin sudah dibuat.
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
    [db.orders, db.orderItems, db.products, db.ingredients, db.recipes, db.stockMovements, db.cafeTables, db.payments, db.shifts, db.cashMovements, db.syncQueue, db.auditLogs],
    async () => {
      const order = await db.orders.get(params.orderId)
      if (!order) throw new Error('Pesanan tidak ditemukan')
      if (order.status === 'void') throw new Error('Pesanan sudah dibatalkan sebelumnya')
      const now = Date.now()

      if (order.status === 'paid') {
        // Transaksi pembalik untuk tiap pembayaran asli — transaksi asli tetap tersimpan.
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
          for (const item of items) await restockForItem(item, order.id, params.approverUserId)
        }
      }

      await transitionOrder(order.id, 'VOIDED', {
        voidReason: params.reason,
        voidedBy: params.approverUserId,
        voidedAt: now,
      })

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

async function restockForItem(item: OrderItem, orderId: string, userId: string): Promise<void> {
  const product = await db.products.get(item.productId)
  if (!product) return
  if (product.trackOwnStock) {
    await applyProductStockDelta(product, item.qty, 'return', orderId, userId)
    return
  }
  const recipe = await db.recipes.where('productId').equals(product.id).first()
  if (!recipe) return
  for (const recipeItem of recipe.items) {
    await applyIngredientStockDelta(recipeItem.ingredientId, (await recipeItemBaseQty(recipeItem)) * item.qty, 'return', orderId, userId)
  }
}

/**
 * Membuat pembayaran pembalik (amount negatif) yang mereferensikan pembayaran asli.
 * Menyesuaikan kas shift bila metode tunai. Dipanggil di dalam transaksi pemanggil.
 */
async function createReversalPayment(
  order: Order,
  original: { id: string; method: PaymentMethod },
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
    method: original.method,
    amount, // negatif
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
    await addExpectedCash(order.shiftId, amount) // amount negatif → kas berkurang
  }
  return reversal
}

/**
 * Retur sebagian/seluruh item dari transaksi yang sudah dibayar.
 * - Membuat pembayaran pembalik (amount negatif) sebesar nilai item yang diretur —
 *   transaksi asli tetap utuh; item ditandai sebagai diretur.
 * - Total refund kumulatif tidak boleh melebihi grand total order.
 * - Stok TIDAK dikembalikan kecuali `restock: true` (dari pengguna ber-izin
 *   `refund.restock` — dipaksa di UI).
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
    [db.orders, db.orderItems, db.products, db.ingredients, db.recipes, db.stockMovements, db.returns, db.payments, db.shifts, db.cashMovements, db.syncQueue, db.auditLogs],
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
        await db.orderItems.update(item.id, {
          voided: true,
          voidReason: `Retur: ${params.reason}`,
          updatedAt: now,
        })
        const updated = await db.orderItems.get(item.id)
        if (updated) await enqueueSync('orderItems', item.id, updated)
        if (params.restock) await restockForItem(item, order.id, params.approverUserId)
      }

      // Guard: refund kumulatif tidak melebihi nilai transaksi asli.
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
