import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import { convertQty, roundQty } from '@/lib/units'
import { postStockMovement } from '@/db/repositories/stock'
import { recordAuditLog } from '@/db/repositories/auditLog'
import type { ProductionInputLine, ProductionRun, StockMovementItemType, UnitOfMeasure } from '@/types/domain'

export class InsufficientProductionStockError extends Error {
  constructor(public readonly items: string[]) {
    super(`Stok bahan tidak cukup untuk produksi: ${items.join(', ')}.`)
    this.name = 'InsufficientProductionStockError'
  }
}

export async function listProductions(limit = 50): Promise<ProductionRun[]> {
  return db.productions.orderBy('createdAt').reverse().limit(limit).toArray()
}

export async function getProduction(id: string): Promise<ProductionRun | undefined> {
  return db.productions.get(id)
}

async function baseUnitOf(itemType: StockMovementItemType, itemId: string): Promise<UnitOfMeasure> {
  if (itemType === 'ingredient') {
    const ing = await db.ingredients.get(itemId)
    if (!ing) throw new Error('Bahan tidak ditemukan')
    return ing.unit
  }
  const prod = await db.products.get(itemId)
  if (!prod) throw new Error('Produk tidak ditemukan')
  return prod.unit
}

async function currentQty(itemType: StockMovementItemType, itemId: string): Promise<number> {
  if (itemType === 'ingredient') return (await db.ingredients.get(itemId))?.stockQty ?? 0
  return (await db.products.get(itemId))?.stockQty ?? 0
}

export interface CreateProductionInput {
  outputItemType: StockMovementItemType
  outputItemId: string
  outputQty: number
  outputUnit: UnitOfMeasure
  inputs: { itemType: StockMovementItemType; itemId: string; qty: number; unit: UnitOfMeasure }[]
  note: string
  createdBy: string
}

/** Membuat draf produksi (belum menyentuh stok). */
export async function createProduction(params: CreateProductionInput): Promise<ProductionRun> {
  if (params.outputQty <= 0) throw new Error('Jumlah hasil produksi harus lebih dari nol.')
  if (params.inputs.length === 0) throw new Error('Tambahkan minimal satu bahan input.')

  const outputName =
    params.outputItemType === 'ingredient'
      ? (await db.ingredients.get(params.outputItemId))?.name
      : (await db.products.get(params.outputItemId))?.name
  if (!outputName) throw new Error('Item hasil produksi tidak ditemukan.')

  const inputs: ProductionInputLine[] = []
  for (const raw of params.inputs) {
    if (raw.qty <= 0) throw new Error('Jumlah bahan input harus lebih dari nol.')
    const name =
      raw.itemType === 'ingredient'
        ? (await db.ingredients.get(raw.itemId))?.name
        : (await db.products.get(raw.itemId))?.name
    if (!name) throw new Error('Salah satu bahan input tidak ditemukan.')
    inputs.push({ itemType: raw.itemType, itemId: raw.itemId, itemName: name, qty: raw.qty, unit: raw.unit })
  }

  const now = Date.now()
  const run: ProductionRun = {
    id: newId(),
    outputItemType: params.outputItemType,
    outputItemId: params.outputItemId,
    outputItemName: outputName,
    outputQty: params.outputQty,
    outputUnit: params.outputUnit,
    inputs,
    note: params.note.trim(),
    status: 'draft',
    createdBy: params.createdBy,
    completedBy: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  await db.transaction('rw', db.productions, db.syncQueue, async () => {
    await db.productions.add(run)
    await enqueueSync('productions', run.id, run)
  })
  return run
}

/**
 * Menyelesaikan produksi: potong tiap bahan input (`production_consumption`,
 * dikonversi ke satuan dasar item) dan tambahkan hasil (`production_output`).
 * Menolak bila stok input kurang, kecuali `allowNegative` (persetujuan supervisor).
 */
export async function completeProduction(params: {
  productionId: string
  completedBy: string
  completedByName: string
  allowNegative?: { approverUserId: string; approverName: string }
}): Promise<ProductionRun> {
  return db.transaction(
    'rw',
    [db.productions, db.ingredients, db.products, db.recipes, db.stockMovements, db.syncQueue, db.auditLogs],
    async () => {
      const run = await db.productions.get(params.productionId)
      if (!run) throw new Error('Produksi tidak ditemukan')
      if (run.status === 'completed') return run

      // Konversi tiap input ke satuan dasar item + cek kecukupan stok.
      const consumption: { line: ProductionInputLine; baseQty: number }[] = []
      const short: string[] = []
      for (const line of run.inputs) {
        const base = await baseUnitOf(line.itemType, line.itemId)
        const baseQty = convertQty(line.qty, line.unit, base)
        consumption.push({ line, baseQty })
        if (!params.allowNegative && (await currentQty(line.itemType, line.itemId)) < baseQty) {
          short.push(line.itemName)
        }
      }
      if (short.length > 0) throw new InsufficientProductionStockError(short)

      for (const { line, baseQty } of consumption) {
        await postStockMovement({
          itemType: line.itemType,
          itemId: line.itemId,
          qtyDelta: -baseQty,
          reason: 'production_consumption',
          userId: params.completedBy,
          note: `Produksi: ${run.outputItemName}`,
          refType: 'production',
          refId: run.id,
        })
      }

      const outputBase = await baseUnitOf(run.outputItemType, run.outputItemId)
      const outputBaseQty = roundQty(convertQty(run.outputQty, run.outputUnit, outputBase))
      await postStockMovement({
        itemType: run.outputItemType,
        itemId: run.outputItemId,
        qtyDelta: outputBaseQty,
        reason: 'production_output',
        userId: params.completedBy,
        note: run.note || `Produksi ${run.outputItemName}`,
        refType: 'production',
        refId: run.id,
      })

      const now = Date.now()
      const completed: ProductionRun = {
        ...run,
        status: 'completed',
        completedBy: params.completedBy,
        completedAt: now,
        updatedAt: now,
      }
      await db.productions.put(completed)
      await enqueueSync('productions', completed.id, completed)

      if (params.allowNegative) {
        await recordAuditLog({
          userId: params.allowNegative.approverUserId,
          userName: params.allowNegative.approverName,
          action: 'stock.negative.override',
          entityType: 'production',
          entityId: run.id,
          details: `Produksi ${run.outputItemName} diselesaikan meski stok bahan tidak mencukupi.`,
        })
      }
      await recordAuditLog({
        userId: params.completedBy,
        userName: params.completedByName,
        action: 'production.complete',
        entityType: 'production',
        entityId: run.id,
        details: `Produksi ${run.outputQty} ${run.outputUnit} ${run.outputItemName} dari ${run.inputs.length} bahan.`,
      })
      return completed
    },
  )
}

/** Hapus draf produksi (lokal — draf belum menyentuh stok & jarang tersinkron). */
export async function deleteDraftProduction(id: string): Promise<void> {
  const run = await db.productions.get(id)
  if (!run || run.status === 'completed') return
  await db.productions.delete(id)
}
