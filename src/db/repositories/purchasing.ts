import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import { convertQty } from '@/lib/units'
import { postStockMovement } from '@/db/repositories/stock'
import { recordAuditLog } from '@/db/repositories/auditLog'
import type { Purchase, PurchaseLine } from '@/types/domain'

export async function listPurchases(limit = 100): Promise<Purchase[]> {
  return db.purchases.orderBy('createdAt').reverse().limit(limit).toArray()
}

export async function getPurchase(id: string): Promise<Purchase | undefined> {
  return db.purchases.get(id)
}

function lineCost(line: Omit<PurchaseLine, 'lineCost'>): number {
  return Math.round(line.qty * line.unitCost)
}

/** Membuat draf pembelian. Belum mengubah stok. */
export async function createPurchase(params: {
  supplierName: string
  invoiceNo: string
  note: string
  createdBy: string
  lines: Array<Omit<PurchaseLine, 'lineCost'>>
}): Promise<Purchase> {
  const now = Date.now()
  const lines: PurchaseLine[] = params.lines.map((l) => ({ ...l, lineCost: lineCost(l) }))
  const purchase: Purchase = {
    id: newId(),
    supplierName: params.supplierName.trim(),
    invoiceNo: params.invoiceNo.trim(),
    lines,
    totalCost: lines.reduce((s, l) => s + l.lineCost, 0),
    status: 'draft',
    note: params.note.trim(),
    createdBy: params.createdBy,
    receivedBy: null,
    receivedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  await db.transaction('rw', db.purchases, db.syncQueue, async () => {
    await db.purchases.add(purchase)
    await enqueueSync('purchases', purchase.id, purchase)
  })
  return purchase
}

/**
 * Menerima pembelian: posting stok masuk (PURCHASE_RECEIPT) untuk tiap baris,
 * memperbarui biaya per satuan bahan (harga terakhir), menutup dokumen. Idempoten
 * — pembelian yang sudah `received` tidak diproses ulang.
 */
export async function receivePurchase(params: {
  purchaseId: string
  receivedBy: string
  receivedByName: string
}): Promise<Purchase> {
  return db.transaction(
    'rw',
    [db.purchases, db.ingredients, db.products, db.recipes, db.stockMovements, db.syncQueue, db.auditLogs],
    async () => {
      const purchase = await db.purchases.get(params.purchaseId)
      if (!purchase) throw new Error('Pembelian tidak ditemukan')
      if (purchase.status === 'received') return purchase

      const now = Date.now()
      for (const line of purchase.lines) {
        if (line.qty <= 0) continue
        if (line.itemType === 'ingredient') {
          const ingredient = await db.ingredients.get(line.itemId)
          const baseQty = ingredient
            ? convertQty(line.qty, line.unit, ingredient.unit)
            : line.qty
          await postStockMovement({
            itemType: 'ingredient',
            itemId: line.itemId,
            qtyDelta: baseQty,
            reason: 'purchase_receipt',
            userId: params.receivedBy,
            note: `${purchase.supplierName} / ${purchase.invoiceNo || 'tanpa no.'}`,
            refType: 'purchase',
            refId: purchase.id,
          })
          if (ingredient && line.qty > 0) {
            const perBase = Math.round((line.unitCost * line.qty) / baseQty)
            await db.ingredients.update(line.itemId, { costPerUnit: perBase, updatedAt: now })
            const updated = await db.ingredients.get(line.itemId)
            if (updated) await enqueueSync('ingredients', line.itemId, updated)
          }
        } else {
          await postStockMovement({
            itemType: 'product',
            itemId: line.itemId,
            qtyDelta: line.qty,
            reason: 'purchase_receipt',
            userId: params.receivedBy,
            note: `${purchase.supplierName} / ${purchase.invoiceNo || 'tanpa no.'}`,
            refType: 'purchase',
            refId: purchase.id,
          })
          const product = await db.products.get(line.itemId)
          if (product && line.qty > 0) {
            await db.products.update(line.itemId, { costPrice: Math.round(line.unitCost), updatedAt: now })
            const updated = await db.products.get(line.itemId)
            if (updated) await enqueueSync('products', line.itemId, updated)
          }
        }
      }

      const received: Purchase = {
        ...purchase,
        status: 'received',
        receivedBy: params.receivedBy,
        receivedAt: now,
        updatedAt: now,
      }
      await db.purchases.put(received)
      await enqueueSync('purchases', received.id, received)
      await recordAuditLog({
        userId: params.receivedBy,
        userName: params.receivedByName,
        action: 'purchase.receive',
        entityType: 'purchase',
        entityId: received.id,
        details: `Penerimaan barang dari ${received.supplierName} senilai Rp${received.totalCost}.`,
      })
      return received
    },
  )
}
