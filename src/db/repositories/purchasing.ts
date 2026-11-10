import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import { convertQty } from '@/lib/units'
import { postStockMovement } from '@/db/repositories/stock'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { addCashMovement, getOpenShift } from '@/db/repositories/shifts'
import { getSettings, updateSettings } from '@/db/repositories/settings'
import type { Purchase, PurchaseLine, PurchasePayment, Supplier } from '@/types/domain'
import { getTrustedNow } from '@/lib/clockGuard'
import { jakartaDateKey } from '@/lib/datetime'
import { isValidDateKey } from '@/lib/expiryBatches'
import { addDaysToKey, purchaseBalance, weightedAverageCost } from '@/lib/retailAnalysis'

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
  supplierId?: string | null
  invoiceNo: string
  note: string
  createdBy: string
  lines: Array<Omit<PurchaseLine, 'lineCost'>>
}): Promise<Purchase> {
  const now = getTrustedNow()
  const lines: PurchaseLine[] = params.lines.map((l) => ({ ...l, lineCost: lineCost(l) }))
  const purchase: Purchase = {
    id: newId(),
    supplierName: params.supplierName.trim(),
    ...(params.supplierId ? { supplierId: params.supplierId } : {}),
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
  /** Minimarket: tanggal kedaluwarsa per indeks baris (`YYYY-MM-DD`) — baris produk saja. */
  expiryDates?: Record<number, string | null | undefined>
  /** Minimarket: jumlah yang benar-benar datang per indeks baris (bila beda dari pesanan). */
  receivedQtys?: Record<number, number | undefined>
  /** Minimarket: produk yang habis tampil lagi di kasir begitu barang diterima. */
  restoreAvailability?: boolean
  /** Minimarket: tempo pembayaran (hari) → `dueDate`, tercatat sebagai hutang. 0/kosong = tunai. */
  termDays?: number
}): Promise<Purchase> {
  return db.transaction(
    'rw',
    [db.purchases, db.ingredients, db.products, db.recipes, db.stockMovements, db.syncQueue, db.auditLogs],
    async () => {
      const purchase = await db.purchases.get(params.purchaseId)
      if (!purchase) throw new Error('Pembelian tidak ditemukan')
      if (purchase.status === 'received') return purchase

      const now = getTrustedNow()
      const lines: PurchaseLine[] = purchase.lines.map((l, i) => {
        const qty = params.receivedQtys?.[i]
        const expiryDate = l.itemType === 'product' && isValidDateKey(params.expiryDates?.[i]) ? params.expiryDates![i]! : (l.expiryDate ?? null)
        return qty !== undefined && qty >= 0 && qty !== l.qty ? { ...l, qty, lineCost: lineCost({ ...l, qty }), expiryDate } : { ...l, expiryDate }
      })
      for (const line of lines) {
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
          // HPP rata-rata tertimbang: stok SEBELUM barang ini masuk × HPP lama + barang masuk.
          const before = await db.products.get(line.itemId)
          await postStockMovement({
            itemType: 'product',
            itemId: line.itemId,
            qtyDelta: line.qty,
            reason: 'purchase_receipt',
            userId: params.receivedBy,
            note: `${purchase.supplierName} / ${purchase.invoiceNo || 'tanpa no.'}`,
            refType: 'purchase',
            refId: purchase.id,
            expiryDate: line.expiryDate,
            restoreAvailability: params.restoreAvailability,
          })
          // Harga beli 0 = tak diisi — jangan menimpa HPP produk dengan nol.
          if (before && line.qty > 0 && line.unitCost > 0) {
            const costPrice = weightedAverageCost(before.stockQty, before.costPrice, line.qty, line.unitCost)
            await db.products.update(line.itemId, { costPrice, updatedAt: now })
            const updated = await db.products.get(line.itemId)
            if (updated) await enqueueSync('products', line.itemId, updated)
          }
        }
      }

      const received: Purchase = {
        ...purchase,
        lines,
        totalCost: lines.reduce((s, l) => s + l.lineCost, 0),
        status: 'received',
        receivedBy: params.receivedBy,
        receivedAt: now,
        ...(params.termDays && params.termDays > 0 ? { dueDate: addDaysToKey(jakartaDateKey(now), Math.floor(params.termDays)) } : {}),
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

// ---- Pemasok, hutang, & retur (minimarket) ----

export async function listSuppliers(): Promise<Supplier[]> {
  return [...((await getSettings()).suppliers ?? [])].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'id'))
}

/** Membuat/mengubah pemasok di master (`AppSettings.suppliers`). */
export async function saveSupplier(input: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<Supplier> {
  const name = input.name.trim()
  if (!name) throw new Error('Nama pemasok wajib diisi.')
  const suppliers = (await getSettings()).suppliers ?? []
  if (suppliers.some((s) => s.id !== input.id && s.name.trim().toLowerCase() === name.toLowerCase())) throw new Error('Nama pemasok sudah ada.')
  const now = getTrustedNow()
  const existing = input.id ? suppliers.find((s) => s.id === input.id) : undefined
  const supplier: Supplier = {
    id: existing?.id ?? newId(),
    name,
    phone: input.phone.trim(),
    address: input.address.trim(),
    termDays: Math.max(0, Math.floor(input.termDays || 0)),
    note: input.note.trim(),
    active: input.active,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await updateSettings({ suppliers: existing ? suppliers.map((s) => (s.id === supplier.id ? supplier : s)) : [...suppliers, supplier] })
  return supplier
}

/**
 * Mencatat pembayaran hutang ke pemasok. `fromDrawer` = uang diambil dari laci kas
 * shift yang sedang buka (tercatat sebagai kas keluar supaya setoran tetap cocok).
 */
export async function recordPurchasePayment(params: {
  purchaseId: string
  amount: number
  method: PurchasePayment['method']
  fromDrawer: boolean
  note: string
  actor: { userId: string; userName: string }
}): Promise<Purchase> {
  const amount = Math.round(params.amount)
  if (!(amount > 0)) throw new Error('Jumlah pembayaran harus lebih dari 0.')
  const shift = params.fromDrawer ? await getOpenShift() : null
  if (params.fromDrawer && !shift) throw new Error('Tidak ada shift aktif — tidak bisa mengambil dari laci kas.')
  const updated = await db.transaction('rw', [db.purchases, db.syncQueue, db.auditLogs], async () => {
    const purchase = await db.purchases.get(params.purchaseId)
    if (!purchase) throw new Error('Pembelian tidak ditemukan')
    const balance = purchaseBalance(purchase)
    if (balance <= 0) throw new Error('Pembelian ini tidak punya sisa hutang.')
    if (amount > balance) throw new Error(`Melebihi sisa hutang (${balance.toLocaleString('id-ID')}).`)
    const now = getTrustedNow()
    const payment: PurchasePayment = {
      id: newId(),
      amount,
      method: params.method,
      fromDrawer: params.fromDrawer && params.method === 'cash',
      note: params.note.trim(),
      byName: params.actor.userName,
      at: now,
    }
    const next: Purchase = { ...purchase, payments: [...(purchase.payments ?? []), payment], updatedAt: now }
    await db.purchases.put(next)
    await enqueueSync('purchases', next.id, next)
    await recordAuditLog({
      userId: params.actor.userId,
      userName: params.actor.userName,
      action: 'purchase.pay',
      entityType: 'purchase',
      entityId: next.id,
      details: `Bayar hutang ${next.supplierName} Rp${amount} (${params.method}${payment.fromDrawer ? ', dari laci kas' : ''}).`,
    })
    return next
  })
  if (shift && params.method === 'cash') {
    await addCashMovement({ shiftId: shift.id, type: 'out', amount, reason: `Bayar pemasok ${updated.supplierName}`, userId: params.actor.userId })
  }
  return updated
}

/**
 * Retur barang ke pemasok (rusak/kedaluwarsa): stok langsung keluar (alasan
 * `supplier_return`, batch yang dipilih dipotong lebih dulu). Nilainya memotong
 * hutang (`debt`), dikembalikan tunai (`refund`), atau diganti barang (`replace`).
 */
export async function createSupplierReturn(params: {
  supplierId?: string | null
  supplierName: string
  settlement: NonNullable<Purchase['returnSettlement']>
  note: string
  lines: Array<{ productId: string; qty: number; unitCost: number; batchId?: string | null }>
  actor: { userId: string; userName: string }
}): Promise<Purchase> {
  const lines = params.lines.filter((l) => l.qty > 0)
  if (!lines.length) throw new Error('Pilih minimal satu produk yang diretur.')
  return db.transaction('rw', [db.purchases, db.products, db.ingredients, db.recipes, db.stockMovements, db.syncQueue, db.auditLogs], async () => {
    const now = getTrustedNow()
    const docLines: PurchaseLine[] = []
    for (const l of lines) {
      const product = await db.products.get(l.productId)
      if (!product) throw new Error('Produk tidak ditemukan')
      if (product.stockQty < l.qty) throw new Error(`Stok ${product.name} hanya ${product.stockQty} — tidak bisa diretur ${l.qty}.`)
      docLines.push({ itemType: 'product', itemId: product.id, itemName: product.name, qty: l.qty, unit: product.unit, unitCost: l.unitCost, lineCost: lineCost({ itemType: 'product', itemId: product.id, itemName: product.name, qty: l.qty, unit: product.unit, unitCost: l.unitCost }), batchId: l.batchId ?? null })
    }
    const doc: Purchase = {
      id: newId(),
      supplierName: params.supplierName.trim(),
      ...(params.supplierId ? { supplierId: params.supplierId } : {}),
      invoiceNo: '',
      lines: docLines,
      totalCost: docLines.reduce((s, l) => s + l.lineCost, 0),
      status: 'received',
      docType: 'return',
      returnSettlement: params.settlement,
      note: params.note.trim(),
      createdBy: params.actor.userId,
      receivedBy: params.actor.userId,
      receivedAt: now,
      createdAt: now,
      updatedAt: now,
    }
    for (const l of docLines) {
      await postStockMovement({
        itemType: 'product',
        itemId: l.itemId,
        qtyDelta: -l.qty,
        reason: 'supplier_return',
        userId: params.actor.userId,
        note: `Retur ke ${doc.supplierName}${doc.note ? ` — ${doc.note}` : ''}`,
        refType: 'purchase',
        refId: doc.id,
        ...(l.batchId ? { batchId: l.batchId } : {}),
      })
    }
    await db.purchases.add(doc)
    await enqueueSync('purchases', doc.id, doc)
    await recordAuditLog({
      userId: params.actor.userId,
      userName: params.actor.userName,
      action: 'purchase.return',
      entityType: 'purchase',
      entityId: doc.id,
      details: `Retur ke ${doc.supplierName} senilai Rp${doc.totalCost} (${params.settlement === 'debt' ? 'potong hutang' : params.settlement === 'refund' ? 'uang kembali' : 'tukar barang'}).`,
    })
    return doc
  })
}
