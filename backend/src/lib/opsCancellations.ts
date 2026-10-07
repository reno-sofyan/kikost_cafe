/**
 * Rekap pembatalan pesanan untuk konsol operator (`/ops`). Fungsi murni di atas
 * payload `orders` + `auditLogs` yang sudah tersinkron — tidak menyentuh DB.
 *
 * Pesanan sejak app v1.0.13 membawa `voidRequestedByName`, `voidedByName`, dan
 * `voidApproval`. Untuk data lama, peminta/penyetuju ditebak dari log audit
 * pesanan itu (`order.cancel` → pelaku = peminta; `order.void` → pelaku = penyetuju).
 */

export type CancelStage = 'paid' | 'kitchen' | 'unprocessed'
export type CancelApproval = 'self' | 'supervisor' | 'owner_code' | null

/** Item yang dihapus/dikurangi/di-void SEBELUM pesanan dibatalkan (jejak koreksi). */
export interface CorrectedItem {
  name: string
  qty: number
  /** Nilai yang hilang: lineTotal item yang dihapus/di-void, atau akumulasi pengurangan qty. */
  value: number
  kind: 'removed' | 'voided' | 'reduced'
  reason: string | null
  by: string | null
  at: number | null
  ownerApproved: boolean
}

export interface CancellationRow {
  orderId: string
  orderNumber: string | null
  queueNumber: number | null
  buyer: string | null
  grandTotal: number
  /**
   * Nilai pesanan yang dibatalkan: `grandTotal` bila masih berisi, atau nilai item
   * yang dihapus lebih dulu bila pesanan dikosongkan sebelum dibatalkan.
   */
  value: number
  /** Item dihapus dulu sampai Rp0, lalu dibatalkan sebagai pesanan kosong. */
  emptiedFirst: boolean
  /** Pesanan dibuka lalu dibatalkan tanpa pernah berisi item. */
  neverHadItems: boolean
  corrections: CorrectedItem[]
  stage: CancelStage
  reason: string | null
  createdAt: number | null
  voidedAt: number | null
  cashierName: string | null
  requestedBy: string | null
  approvedBy: string | null
  approval: CancelApproval
  payLater: boolean
}

export interface CancellationGroup {
  name: string
  count: number
  value: number
}

export interface CancellationReport {
  days: number
  totals: {
    count: number
    value: number
    paidCount: number
    paidValue: number
    ownerCodeCount: number
    emptiedFirstCount: number
    emptiedFirstValue: number
    neverHadItemsCount: number
  }
  byRequester: CancellationGroup[]
  byApprover: CancellationGroup[]
  byReason: CancellationGroup[]
  rows: CancellationRow[]
}

type Payload = Record<string, unknown>

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const numOrNull = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)

const OWNER_APPROVAL_RE = /Disetujui Pemilik: (.+?) \(kode/
const REQUESTED_BY_RE = /Diminta oleh: ([^•]+)/

function stageOf(order: Payload): CancelStage {
  if (order.paidAt != null) return 'paid'
  return order.lifecycleStatus === 'CANCELLED' ? 'unprocessed' : 'kitchen'
}

function approvalOf(order: Payload): CancelApproval {
  const a = order.voidApproval
  return a === 'self' || a === 'supervisor' || a === 'owner_code' ? a : null
}

function correctionsOf(items: Payload[]): CorrectedItem[] {
  const out: CorrectedItem[] = []
  for (const i of items) {
    const base = {
      name: str(i.productName) ?? 'Item',
      by: str(i.removedByName),
      at: numOrNull(i.removedAt) ?? numOrNull(i.updatedAt),
      ownerApproved: i.removedApproval === 'owner_code',
    }
    if (i.removed === true) out.push({ ...base, qty: num(i.qty), value: num(i.lineTotal), kind: 'removed', reason: str(i.removedReason) })
    else if (i.voided === true) out.push({ ...base, qty: num(i.qty), value: num(i.lineTotal), kind: 'voided', reason: str(i.voidReason) })
    if (num(i.reducedValue) > 0) {
      out.push({ ...base, qty: 0, value: num(i.reducedValue), kind: 'reduced', reason: null, ownerApproved: false })
    }
  }
  return out.sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
}

export function describeCancellation(order: Payload, audits: Payload[], items: Payload[] = []): CancellationRow {
  const cancelLog = audits.find((a) => a.action === 'order.cancel' || a.action === 'order.cancelEmpty')
  const voidLog = audits.find((a) => a.action === 'order.void')
  let requestedBy = str(order.voidRequestedByName)
  let approvedBy = str(order.voidedByName)
  let approval = approvalOf(order)

  if (!requestedBy || !approvedBy || !approval) {
    if (cancelLog) {
      const ownerName = OWNER_APPROVAL_RE.exec(String(cancelLog.details ?? ''))?.[1] ?? null
      requestedBy ??= str(cancelLog.userName)
      approvedBy ??= ownerName ?? str(cancelLog.userName)
      approval ??= ownerName ? 'owner_code' : 'self'
    } else if (voidLog) {
      const details = String(voidLog.details ?? '')
      requestedBy ??= str(REQUESTED_BY_RE.exec(details)?.[1])
      approvedBy ??= str(voidLog.userName)
      approval ??= details.includes('Disetujui Pemilik') ? 'owner_code' : 'supervisor'
    }
  }

  const grandTotal = num(order.grandTotal)
  const corrections = correctionsOf(items)
  const correctedValue = corrections.reduce((s, c) => s + c.value, 0)
  return {
    orderId: String(order.id ?? ''),
    orderNumber: str(order.orderNumber),
    queueNumber: numOrNull(order.queueNumber),
    buyer: str(order.notes),
    grandTotal,
    value: grandTotal > 0 ? grandTotal : correctedValue,
    emptiedFirst: grandTotal <= 0 && corrections.some((c) => c.kind !== 'reduced'),
    neverHadItems: items.length === 0,
    corrections,
    stage: stageOf(order),
    reason: str(order.voidReason),
    createdAt: numOrNull(order.createdAt),
    voidedAt: numOrNull(order.voidedAt) ?? numOrNull(order.updatedAt),
    cashierName: str(order.cashierName),
    requestedBy,
    approvedBy,
    approval,
    payLater: !!order.payLater,
  }
}

function groupBy(rows: CancellationRow[], key: (r: CancellationRow) => string | null): CancellationGroup[] {
  const map = new Map<string, CancellationGroup>()
  for (const r of rows) {
    const name = key(r) ?? 'Tidak diketahui'
    const g = map.get(name) ?? { name, count: 0, value: 0 }
    g.count += 1
    g.value += r.value
    map.set(name, g)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.value - a.value)
}

/**
 * Semua pesanan batal ikut dihitung — termasuk yang dikosongkan dulu lalu dibatalkan
 * sebagai pesanan Rp0 (celah yang sengaja disorot), dengan item yang dihapusnya.
 */
export function buildCancellationReport(days: number, orders: Payload[], audits: Payload[], items: Payload[] = []): CancellationReport {
  const byOrder = <T extends Payload>(list: T[], key: string) => {
    const map = new Map<string, T[]>()
    for (const x of list) {
      const id = String(x[key] ?? '')
      const arr = map.get(id) ?? []
      arr.push(x)
      map.set(id, arr)
    }
    return map
  }
  const auditsByOrder = byOrder(audits, 'entityId')
  const itemsByOrder = byOrder(items, 'orderId')
  const rows = orders
    .map((o) => {
      const id = String(o.id ?? '')
      return describeCancellation(o, auditsByOrder.get(id) ?? [], itemsByOrder.get(id) ?? [])
    })
    .sort((a, b) => (b.voidedAt ?? 0) - (a.voidedAt ?? 0))

  const paid = rows.filter((r) => r.stage === 'paid')
  const emptied = rows.filter((r) => r.emptiedFirst)
  return {
    days,
    totals: {
      count: rows.length,
      value: rows.reduce((s, r) => s + r.value, 0),
      paidCount: paid.length,
      paidValue: paid.reduce((s, r) => s + r.value, 0),
      ownerCodeCount: rows.filter((r) => r.approval === 'owner_code').length,
      emptiedFirstCount: emptied.length,
      emptiedFirstValue: emptied.reduce((s, r) => s + r.value, 0),
      neverHadItemsCount: rows.filter((r) => r.neverHadItems).length,
    },
    byRequester: groupBy(rows, (r) => r.requestedBy),
    byApprover: groupBy(rows, (r) => r.approvedBy),
    byReason: groupBy(rows, (r) => r.reason),
    rows,
  }
}
