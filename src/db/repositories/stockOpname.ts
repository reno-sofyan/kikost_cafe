import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import { roundQty } from '@/lib/units'
import { postStockMovement } from '@/db/repositories/stock'
import { recordAuditLog } from '@/db/repositories/auditLog'
import type { OpnameLine, StockOpname } from '@/types/domain'

export async function listStockOpnames(limit = 50): Promise<StockOpname[]> {
  return db.stockOpnames.orderBy('createdAt').reverse().limit(limit).toArray()
}

export async function getStockOpname(id: string): Promise<StockOpname | undefined> {
  return db.stockOpnames.get(id)
}

/**
 * Membuat draf opname — snapshot stok sistem semua bahan (+ produk ber-stok
 * sendiri) saat ini. Kasir/inventory lalu mengisi `countedQty` hasil hitung fisik.
 */
export async function createStockOpname(params: { createdBy: string; note: string }): Promise<StockOpname> {
  const ingredients = await db.ingredients.orderBy('name').toArray()
  const products = (await db.products.toArray()).filter((p) => p.trackOwnStock)
  const now = Date.now()
  const lines: OpnameLine[] = [
    ...ingredients.map((i) => ({
      itemType: 'ingredient' as const,
      itemId: i.id,
      itemName: i.name,
      systemQty: i.stockQty,
      countedQty: null,
      unit: i.unit,
    })),
    ...products.map((p) => ({
      itemType: 'product' as const,
      itemId: p.id,
      itemName: p.name,
      systemQty: p.stockQty,
      countedQty: null,
      unit: p.unit,
    })),
  ]
  const opname: StockOpname = {
    id: newId(),
    lines,
    status: 'draft',
    note: params.note.trim(),
    createdBy: params.createdBy,
    finalizedBy: null,
    finalizedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  await db.transaction('rw', db.stockOpnames, db.syncQueue, async () => {
    await db.stockOpnames.add(opname)
    await enqueueSync('stockOpnames', opname.id, opname)
  })
  return opname
}

export async function saveOpnameCounts(id: string, counts: Record<string, number | null>): Promise<void> {
  await db.transaction('rw', db.stockOpnames, db.syncQueue, async () => {
    const opname = await db.stockOpnames.get(id)
    if (!opname || opname.status === 'finalized') return
    const lines = opname.lines.map((l) =>
      l.itemId in counts ? { ...l, countedQty: counts[l.itemId] } : l,
    )
    await db.stockOpnames.update(id, { lines, updatedAt: Date.now() })
    const updated = await db.stockOpnames.get(id)
    if (updated) await enqueueSync('stockOpnames', id, updated)
  })
}

/**
 * Finalisasi opname: untuk tiap baris dengan `countedQty` terisi dan berbeda dari
 * `systemQty`, posting pergerakan `stock_opname` sebesar selisihnya. Wajib beralasan
 * (`note`). Menutup dokumen; tak bisa difinalisasi dua kali.
 */
export async function finalizeStockOpname(params: {
  opnameId: string
  finalizedBy: string
  finalizedByName: string
  note: string
}): Promise<StockOpname> {
  if (!params.note.trim()) throw new Error('Alasan / catatan opname wajib diisi.')
  return db.transaction(
    'rw',
    [db.stockOpnames, db.ingredients, db.products, db.recipes, db.stockMovements, db.syncQueue, db.auditLogs],
    async () => {
      const opname = await db.stockOpnames.get(params.opnameId)
      if (!opname) throw new Error('Opname tidak ditemukan')
      if (opname.status === 'finalized') return opname

      const now = Date.now()
      let adjustedCount = 0
      for (const line of opname.lines) {
        if (line.countedQty == null) continue
        const delta = roundQty(line.countedQty - line.systemQty)
        if (delta === 0) continue
        adjustedCount++
        await postStockMovement({
          itemType: line.itemType,
          itemId: line.itemId,
          qtyDelta: delta,
          reason: 'stock_opname',
          userId: params.finalizedBy,
          note: params.note.trim(),
          refType: 'opname',
          refId: opname.id,
        })
      }

      const finalized: StockOpname = {
        ...opname,
        status: 'finalized',
        note: params.note.trim(),
        finalizedBy: params.finalizedBy,
        finalizedAt: now,
        updatedAt: now,
      }
      await db.stockOpnames.put(finalized)
      await enqueueSync('stockOpnames', finalized.id, finalized)
      await recordAuditLog({
        userId: params.finalizedBy,
        userName: params.finalizedByName,
        action: 'stock.opname.finalize',
        entityType: 'stockOpname',
        entityId: finalized.id,
        details: `Opname difinalisasi: ${adjustedCount} item disesuaikan. Alasan: ${params.note.trim()}`,
      })
      return finalized
    },
  )
}
