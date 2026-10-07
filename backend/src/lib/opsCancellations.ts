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

export interface CancellationRow {
  orderId: string
  orderNumber: string | null
  queueNumber: number | null
  buyer: string | null
  grandTotal: number
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
  totals: { count: number; value: number; paidCount: number; paidValue: number; ownerCodeCount: number }
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

export function describeCancellation(order: Payload, audits: Payload[]): CancellationRow {
  const cancelLog = audits.find((a) => a.action === 'order.cancel')
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

  return {
    orderId: String(order.id ?? ''),
    orderNumber: str(order.orderNumber),
    queueNumber: numOrNull(order.queueNumber),
    buyer: str(order.notes),
    grandTotal: num(order.grandTotal),
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
    g.value += r.grandTotal
    map.set(name, g)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.value - a.value)
}

/**
 * Pesanan kosong (Rp0, dibatalkan karena tak berisi item) tidak dihitung — bukan
 * pembatalan penjualan dan hanya menambah kebisingan.
 */
export function buildCancellationReport(days: number, orders: Payload[], audits: Payload[]): CancellationReport {
  const auditsByOrder = new Map<string, Payload[]>()
  for (const a of audits) {
    const id = String(a.entityId ?? '')
    const list = auditsByOrder.get(id) ?? []
    list.push(a)
    auditsByOrder.set(id, list)
  }
  const rows = orders
    .filter((o) => num(o.grandTotal) > 0)
    .map((o) => describeCancellation(o, auditsByOrder.get(String(o.id ?? '')) ?? []))
    .sort((a, b) => (b.voidedAt ?? 0) - (a.voidedAt ?? 0))

  const paid = rows.filter((r) => r.stage === 'paid')
  return {
    days,
    totals: {
      count: rows.length,
      value: rows.reduce((s, r) => s + r.grandTotal, 0),
      paidCount: paid.length,
      paidValue: paid.reduce((s, r) => s + r.grandTotal, 0),
      ownerCodeCount: rows.filter((r) => r.approval === 'owner_code').length,
    },
    byRequester: groupBy(rows, (r) => r.requestedBy),
    byApprover: groupBy(rows, (r) => r.approvedBy),
    byReason: groupBy(rows, (r) => r.reason),
    rows,
  }
}
