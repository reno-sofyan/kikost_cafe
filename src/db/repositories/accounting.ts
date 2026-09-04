import { db } from '@/db/schema'
import type { DateRange } from '@/db/repositories/reports'
import type { PaymentMethod } from '@/types/domain'

/**
 * Ekspor jurnal akuntansi sederhana (partai berpasangan) untuk satu rentang
 * tanggal, siap diimpor ke pembukuan (Accurate, Excel, dsb). Semua nilai rupiah
 * bulat. Akun memakai bagan sederhana kafe.
 */

export const ACCOUNTS = {
  CASH: '1-10001 Kas',
  BANK: '1-10002 Bank / QRIS / Kartu',
  INVENTORY: '1-10301 Persediaan Bahan',
  TAX_PAYABLE: '2-20001 Utang Pajak (PB1/PPN)',
  SALES: '4-40001 Pendapatan Penjualan',
  SERVICE_CHARGE: '4-40002 Pendapatan Service Charge',
  DISCOUNT: '4-49001 Potongan Penjualan',
  ROUNDING: '4-49002 Pembulatan',
  REFUND: '4-48001 Retur & Pembatalan',
  COGS: '5-50001 Harga Pokok Penjualan',
  WASTE: '5-59001 Beban Susut / Waste',
  OPEX: '6-60001 Beban Operasional',
  CASH_VARIANCE: '6-69001 Selisih Kas',
} as const

export interface JournalLine {
  date: string // YYYY-MM-DD
  ref: string
  account: string
  description: string
  debit: number
  credit: number
}

export interface AccountingExport {
  range: DateRange
  lines: JournalLine[]
  trialBalance: { account: string; debit: number; credit: number }[]
  totals: { debit: number; credit: number; balanced: boolean }
  /** Nilai persediaan saat ini (semua bahan + produk ber-stok, di harga biaya). */
  inventoryValueNow: number
  /** Ringkasan selisih kas shift yang ditutup dalam rentang. */
  cashVariance: { shiftId: string; closedAt: number; cashierName: string; variance: number }[]
}

/** Tanggal lokal Asia/Jakarta (UTC+7) dari epoch ms. */
function ymd(ts: number): string {
  return new Date(ts + 7 * 3600_000).toISOString().slice(0, 10)
}

const accountForMethod = (m: PaymentMethod) => (m === 'cash' ? ACCOUNTS.CASH : ACCOUNTS.BANK)

export async function buildAccountingExport(range: DateRange): Promise<AccountingExport> {
  const lines: JournalLine[] = []
  const add = (l: Omit<JournalLine, 'debit' | 'credit'> & { debit?: number; credit?: number }) => {
    const debit = Math.round(l.debit ?? 0)
    const credit = Math.round(l.credit ?? 0)
    if (debit === 0 && credit === 0) return
    lines.push({ ...l, debit, credit })
  }

  // ---- Penjualan ----
  // Termasuk order yang kemudian di-void TAPI sempat dibayar: penjualannya tetap
  // dibukukan supaya refund (di bawah) punya lawan; net-nya nol bila void di
  // periode yang sama.
  const allInRange = await db.orders.where('createdAt').between(range.from, range.to, true, true).toArray()
  const allPayments = await db.payments.toArray()
  const paidOrderIds = new Set(allPayments.filter((p) => p.amount > 0).map((p) => p.orderId))
  const orders = allInRange.filter(
    (o) => o.status === 'paid' || o.status === 'completed' || (o.status === 'void' && paidOrderIds.has(o.id)),
  )
  const orderIds = new Set(orders.map((o) => o.id))
  const items = orderIds.size ? await db.orderItems.where('orderId').anyOf([...orderIds]).toArray() : []
  const payments = allPayments.filter((p) => orderIds.has(p.orderId))
  const products = new Map((await db.products.toArray()).map((p) => [p.id, p]))

  const paymentsByOrder = new Map<string, typeof payments>()
  for (const p of payments) {
    const list = paymentsByOrder.get(p.orderId) ?? []
    list.push(p)
    paymentsByOrder.set(p.orderId, list)
  }

  for (const o of orders) {
    const date = ymd(o.paidAt ?? o.createdAt)
    const ref = o.orderNumber
    // Kas / bank masuk per metode (hanya pembayaran positif).
    for (const p of (paymentsByOrder.get(o.id) ?? []).filter((x) => x.amount > 0)) {
      add({ date, ref, account: accountForMethod(p.method), description: `Terima pembayaran (${p.method})`, debit: p.amount })
    }
    if (o.discountAmount > 0) add({ date, ref, account: ACCOUNTS.DISCOUNT, description: 'Potongan penjualan', debit: o.discountAmount })
    if (o.roundingAdjustment < 0) add({ date, ref, account: ACCOUNTS.ROUNDING, description: 'Pembulatan', debit: -o.roundingAdjustment })

    add({ date, ref, account: ACCOUNTS.SALES, description: 'Pendapatan penjualan', credit: o.subtotal })
    if (o.serviceChargeAmount > 0) add({ date, ref, account: ACCOUNTS.SERVICE_CHARGE, description: 'Service charge', credit: o.serviceChargeAmount })
    if (o.taxAmount > 0) add({ date, ref, account: ACCOUNTS.TAX_PAYABLE, description: 'Pajak dipungut', credit: o.taxAmount })
    if (o.roundingAdjustment > 0) add({ date, ref, account: ACCOUNTS.ROUNDING, description: 'Pembulatan', credit: o.roundingAdjustment })

    // HPP
    const cogs = items
      .filter((it) => it.orderId === o.id && !it.voided && !it.removed)
      .reduce((s, it) => s + (products.get(it.productId)?.costPrice ?? 0) * it.qty, 0)
    if (cogs > 0) {
      add({ date, ref, account: ACCOUNTS.COGS, description: 'HPP penjualan', debit: cogs })
      add({ date, ref, account: ACCOUNTS.INVENTORY, description: 'Pengeluaran persediaan', credit: cogs })
    }
  }

  // ---- Refund (void / retur) ----
  const refunds = await db.refunds.where('createdAt').between(range.from, range.to, true, true).toArray()
  for (const r of refunds) {
    const date = ymd(r.createdAt)
    add({ date, ref: `REF-${r.id.slice(0, 6)}`, account: ACCOUNTS.REFUND, description: `Refund ${r.reason}`, debit: r.amount })
    add({ date, ref: `REF-${r.id.slice(0, 6)}`, account: accountForMethod(r.method), description: `Kembalian dana (${r.method})`, credit: r.amount })
  }

  // ---- Pengeluaran operasional (tunai) ----
  const expenses = await db.expenses.where('createdAt').between(range.from, range.to, true, true).toArray()
  for (const e of expenses) {
    const date = ymd(e.createdAt)
    add({ date, ref: `EXP-${e.id.slice(0, 6)}`, account: ACCOUNTS.OPEX, description: `${e.category}${e.note ? ` — ${e.note}` : ''}`, debit: e.amount })
    add({ date, ref: `EXP-${e.id.slice(0, 6)}`, account: ACCOUNTS.CASH, description: 'Bayar beban', credit: e.amount })
  }

  // ---- Penerimaan pembelian bahan (masuk persediaan) ----
  const purchases = (await db.purchases.toArray()).filter(
    (p) => p.status === 'received' && p.receivedAt != null && p.receivedAt >= range.from && p.receivedAt <= range.to,
  )
  for (const p of purchases) {
    const date = ymd(p.receivedAt as number)
    add({ date, ref: p.invoiceNo || `BELI-${p.id.slice(0, 6)}`, account: ACCOUNTS.INVENTORY, description: `Pembelian bahan — ${p.supplierName}`, debit: p.totalCost })
    add({ date, ref: p.invoiceNo || `BELI-${p.id.slice(0, 6)}`, account: ACCOUNTS.CASH, description: 'Bayar pembelian', credit: p.totalCost })
  }

  // ---- Susut / waste & selisih opname (bernilai biaya) ----
  const ingredients = new Map((await db.ingredients.toArray()).map((i) => [i.id, i]))
  const moves = (await db.stockMovements.where('createdAt').between(range.from, range.to, true, true).toArray()).filter(
    (m) => m.reason === 'waste' || m.reason === 'stock_opname' || m.reason === 'adjustment',
  )
  for (const m of moves) {
    const unitCost =
      m.itemType === 'ingredient' ? ingredients.get(m.itemId)?.costPerUnit ?? 0 : products.get(m.itemId)?.costPrice ?? 0
    const value = Math.round(Math.abs(m.qtyDelta) * unitCost)
    if (value === 0) continue
    const date = ymd(m.createdAt)
    const ref = `STK-${m.id.slice(0, 6)}`
    if (m.qtyDelta < 0) {
      add({ date, ref, account: ACCOUNTS.WASTE, description: `${m.reason} — ${m.itemName}`, debit: value })
      add({ date, ref, account: ACCOUNTS.INVENTORY, description: 'Pengurangan persediaan', credit: value })
    } else {
      add({ date, ref, account: ACCOUNTS.INVENTORY, description: `Koreksi tambah — ${m.itemName}`, debit: value })
      add({ date, ref, account: ACCOUNTS.WASTE, description: 'Koreksi persediaan', credit: value })
    }
  }

  // ---- Selisih kas shift (ditutup dalam rentang) ----
  const shifts = (await db.shifts.toArray()).filter(
    (s) => s.status === 'closed' && s.closedAt != null && s.closedAt >= range.from && s.closedAt <= range.to,
  )
  const cashVariance = shifts
    .filter((s) => typeof s.variance === 'number' && s.variance !== 0)
    .map((s) => ({ shiftId: s.id, closedAt: s.closedAt as number, cashierName: s.cashierName, variance: s.variance as number }))
  for (const s of cashVariance) {
    const date = ymd(s.closedAt)
    const ref = `SHIFT-${s.shiftId.slice(0, 6)}`
    const v = Math.round(Math.abs(s.variance))
    if (s.variance < 0) {
      // kas fisik kurang dari seharusnya → kerugian
      add({ date, ref, account: ACCOUNTS.CASH_VARIANCE, description: `Selisih kas kurang (${s.cashierName})`, debit: v })
      add({ date, ref, account: ACCOUNTS.CASH, description: 'Koreksi kas', credit: v })
    } else {
      add({ date, ref, account: ACCOUNTS.CASH, description: `Selisih kas lebih (${s.cashierName})`, debit: v })
      add({ date, ref, account: ACCOUNTS.CASH_VARIANCE, description: 'Koreksi kas', credit: v })
    }
  }

  // ---- Nilai persediaan saat ini ----
  const ingList = await db.ingredients.toArray()
  const stockedProducts = (await db.products.toArray()).filter((p) => p.trackOwnStock)
  const inventoryValueNow =
    Math.round(ingList.reduce((s, i) => s + i.stockQty * i.costPerUnit, 0)) +
    Math.round(stockedProducts.reduce((s, p) => s + p.stockQty * p.costPrice, 0))

  // ---- Neraca saldo (trial balance) ----
  const balMap = new Map<string, { debit: number; credit: number }>()
  for (const l of lines) {
    const b = balMap.get(l.account) ?? { debit: 0, credit: 0 }
    b.debit += l.debit
    b.credit += l.credit
    balMap.set(l.account, b)
  }
  const trialBalance = [...balMap.entries()]
    .map(([account, b]) => ({ account, ...b }))
    .sort((a, b) => a.account.localeCompare(b.account))
  const totalDebit = trialBalance.reduce((s, r) => s + r.debit, 0)
  const totalCredit = trialBalance.reduce((s, r) => s + r.credit, 0)

  lines.sort((a, b) => (a.date === b.date ? a.ref.localeCompare(b.ref) : a.date.localeCompare(b.date)))

  return {
    range,
    lines,
    trialBalance,
    totals: { debit: totalDebit, credit: totalCredit, balanced: totalDebit === totalCredit },
    inventoryValueNow,
    cashVariance,
  }
}

export function accountingExportToCsv(exp: AccountingExport): string {
  const rows: string[] = []
  const esc = (s: string | number) => {
    const str = String(s)
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
  }
  rows.push('Tanggal,Referensi,Akun,Keterangan,Debit,Kredit')
  for (const l of exp.lines) {
    rows.push([l.date, l.ref, l.account, l.description, l.debit || '', l.credit || ''].map(esc).join(','))
  }
  rows.push('')
  rows.push('NERACA SALDO')
  rows.push('Akun,Debit,Kredit')
  for (const r of exp.trialBalance) rows.push([r.account, r.debit, r.credit].map(esc).join(','))
  rows.push(['TOTAL', exp.totals.debit, exp.totals.credit].map(esc).join(','))
  rows.push(`Seimbang,${exp.totals.balanced ? 'YA' : 'TIDAK'}`)
  rows.push('')
  rows.push('INFORMASI TAMBAHAN')
  rows.push(`Nilai persediaan saat ini (biaya),${exp.inventoryValueNow}`)
  if (exp.cashVariance.length) {
    rows.push('Selisih kas per shift,,')
    for (const c of exp.cashVariance) {
      rows.push([new Date(c.closedAt + 7 * 3600_000).toISOString().slice(0, 10), c.cashierName, c.variance].map(esc).join(','))
    }
  }
  return rows.join('\n')
}
