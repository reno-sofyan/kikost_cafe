import type { Pool } from 'pg'
import { buildCancellationReport, buildReturnRows, type CancellationReport } from './opsCancellations.js'
import { buildSalesReport, type SalesReport } from './salesReport.js'
import { buildCancellationsPdf, buildTransactionsPdf, wibDay, type TransactionReport, type TransactionRow, type TransactionSettlement } from './opsPdf.js'

/**
 * Laporan per tenant yang dipakai bersama konsol operator (/ops, lintas-tenant)
 * dan konsol Pemilik (/owner, satu tenant dari token). Semua fungsi menerima
 * `tenantId` eksplisit — pemanggil yang menjamin tenant itu boleh diakses.
 */

/**
 * Cast aman dari payload JSONB: nilai yang bukan angka murni (string tanggal, kosong,
 * notasi aneh dari perangkat lama) menjadi NULL alih-alih menggagalkan SELURUH query
 * dengan "invalid input syntax" (500) — satu baris rusak tak boleh mematikan dashboard.
 */
export const numField = (field: string): string =>
  `(CASE WHEN jsonb_typeof(payload->'${field}') = 'number' THEN (payload->>'${field}')::numeric
         WHEN payload->>'${field}' ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (payload->>'${field}')::numeric END)`
/** Epoch ms → timestamptz, aman untuk nilai di luar jangkauan tanggal Postgres. */
export const tsOf = (msSql: string): string =>
  `(CASE WHEN ${msSql} BETWEEN 0 AND 32503680000000 THEN to_timestamp(${msSql} / 1000.0) END)`
/**
 * Pengakuan penjualan (akrual): penjualan dicatat pada TANGGAL PESANAN, bukan saat
 * dilunasi. Yang diakui: pesanan lunas, plus Tagihan Tertunda yang belum dibayar
 * (makanan sudah diserahkan — sisanya piutang). Pesanan terbuka biasa (meja masih
 * berjalan) belum diakui. Uang masuk per shift tetap mengikuti waktu bayar.
 */
export const SALE_AT_MS = numField('createdAt')
export const RECOGNIZED_SALE_SQL = `(payload->>'status' IN ('paid', 'completed')
  OR (payload->>'status' = 'open' AND jsonb_typeof(payload->'payLater') = 'object'))`
export const GRAND_TOTAL = `coalesce(${numField('grandTotal')}, 0)`

/**
 * Sisa tagihan yang belum dibayar satu pesanan (tabel ber-alias `o`): grandTotal
 * dikurangi pembayaran positif yang bukan pembalikan — pembayaran sebagian terhitung.
 */
export const UNPAID_SQL = `greatest(0, ${GRAND_TOTAL.replace(/payload/g, 'o.payload')} - (
    SELECT coalesce(sum(CASE WHEN jsonb_typeof(p.payload->'amount') = 'number'
                             THEN greatest((p.payload->>'amount')::numeric, 0) END), 0)
      FROM sync_entity_state p
     WHERE p.tenant_id = o.tenant_id AND p.entity = 'payments' AND p.deleted = FALSE
       AND p.payload->>'orderId' = o.entity_id
       AND coalesce(p.payload->>'reversalOfPaymentId', '') = ''))`

/** Waktu batal (epoch ms) sebuah order di payload; data lama tanpa `voidedAt` → `updatedAt`. */
export const VOIDED_AT_SQL = `coalesce(${numField('voidedAt')}, ${numField('updatedAt')})`
/**
 * Pesanan batal yang dihitung: SEMUA yang berstatus void — termasuk Rp0, karena
 * "kosongkan dulu lalu batalkan sebagai pesanan kosong" justru jalur yang harus terlihat.
 */
export const COUNTED_CANCEL_SQL = `entity = 'orders' AND deleted = FALSE AND payload->>'status' = 'void'`
/** Nilai item yang dihapus/di-void + pengurangan qty pada satu pesanan (subquery berkorelasi ke `c.id`). */
export const CORRECTED_VALUE_SQL = `(SELECT coalesce(sum(
      CASE WHEN i.payload->>'removed' = 'true' OR i.payload->>'voided' = 'true'
           THEN coalesce(CASE WHEN jsonb_typeof(i.payload->'lineTotal') = 'number' THEN (i.payload->>'lineTotal')::numeric END, 0)
           ELSE 0 END
      + coalesce(CASE WHEN jsonb_typeof(i.payload->'reducedValue') = 'number' THEN (i.payload->>'reducedValue')::numeric END, 0)), 0)
     FROM sync_entity_state i
    WHERE i.tenant_id = c.tenant_id AND i.entity = 'orderItems' AND i.deleted = FALSE
      AND i.payload->>'orderId' = c.id)`

export const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const WIB_OFFSET_MS = 7 * 3_600_000
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Rentang tanggal kalender WIB (inklusif) → epoch ms [since, until). Default: hari ini.
 * Maksimal 92 hari supaya PDF tetap wajar ukurannya.
 */
export function parseWibRange(
  from: string | undefined,
  to: string | undefined,
  now = Date.now(),
): { sinceMs: number; untilMs: number; label: string; fileLabel: string } | { error: string } {
  const today = new Date(now + WIB_OFFSET_MS).toISOString().slice(0, 10)
  const f = from || today
  const t = to || f
  const mf = DATE_RE.exec(f)
  const mt = DATE_RE.exec(t)
  // Date.UTC menggeser tanggal tak sah (mis. 2026-13-40) diam-diam — tolak bila tak kembali utuh.
  const real = (m: RegExpExecArray) => new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString().slice(0, 10) === m[0]
  if (!mf || !mt || !real(mf) || !real(mt)) return { error: 'Format tanggal harus YYYY-MM-DD yang valid' }
  const sinceMs = Date.UTC(+mf[1], +mf[2] - 1, +mf[3]) - WIB_OFFSET_MS
  const untilMs = Date.UTC(+mt[1], +mt[2] - 1, +mt[3] + 1) - WIB_OFFSET_MS
  if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs) || untilMs <= sinceMs) {
    return { error: 'Tanggal akhir harus sama atau setelah tanggal awal' }
  }
  if (untilMs - sinceMs > 92 * 86_400_000) return { error: 'Rentang maksimal 92 hari' }
  const fmt = (ms: number) =>
    new Date(ms).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric' })
  const label = f === t ? fmt(sinceMs) : `${fmt(sinceMs)} - ${fmt(untilMs - 1)}`
  return { sinceMs, untilMs, label, fileLabel: f === t ? f : `${f}_${t}` }
}

export async function loadCancellationReport(
  pool: Pool,
  tenantId: string,
  sinceMs: number,
  untilMs: number,
  days: number,
): Promise<CancellationReport> {
  const orders = await pool.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM sync_entity_state
      WHERE tenant_id = $1 AND ${COUNTED_CANCEL_SQL}
        AND ${VOIDED_AT_SQL} >= $2 AND ${VOIDED_AT_SQL} < $3
      ORDER BY ${VOIDED_AT_SQL} DESC
      LIMIT 2000`,
    [tenantId, sinceMs, untilMs],
  )
  const orderIds = orders.rows.map((r) => String(r.payload.id ?? ''))
  const [audits, items] = orderIds.length
    ? await Promise.all([
        pool.query<{ payload: Record<string, unknown> }>(
          `SELECT payload FROM sync_entity_state
            WHERE tenant_id = $1 AND entity = 'auditLogs' AND deleted = FALSE
              AND payload->>'action' IN ('order.cancel', 'order.cancelEmpty', 'order.void')
              AND payload->>'entityId' = ANY($2::text[])`,
          [tenantId, orderIds],
        ),
        pool.query<{ payload: Record<string, unknown> }>(
          `SELECT payload FROM sync_entity_state
            WHERE tenant_id = $1 AND entity = 'orderItems' AND deleted = FALSE
              AND payload->>'orderId' = ANY($2::text[])`,
          [tenantId, orderIds],
        ),
      ])
    : [{ rows: [] }, { rows: [] }]
  // Retur (pengembalian uang sebagian) pada periode yang sama.
  const refunds = await pool.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM sync_entity_state
      WHERE tenant_id = $1 AND entity = 'refunds' AND deleted = FALSE AND payload->>'reason' = 'return'
        AND ${numField('createdAt')} >= $2 AND ${numField('createdAt')} < $3
      ORDER BY ${numField('createdAt')} DESC
      LIMIT 1000`,
    [tenantId, sinceMs, untilMs],
  )
  const refundOrderIds = [...new Set(refunds.rows.map((r) => String(r.payload.orderId ?? '')))]
  const [refundOrders, refundItems, refundAudits] = refundOrderIds.length
    ? await Promise.all([
        pool.query<{ payload: Record<string, unknown> }>(
          `SELECT payload FROM sync_entity_state WHERE tenant_id = $1 AND entity = 'orders' AND deleted = FALSE AND entity_id = ANY($2::text[])`,
          [tenantId, refundOrderIds],
        ),
        pool.query<{ payload: Record<string, unknown> }>(
          `SELECT payload FROM sync_entity_state WHERE tenant_id = $1 AND entity = 'orderItems' AND deleted = FALSE AND payload->>'orderId' = ANY($2::text[])`,
          [tenantId, refundOrderIds],
        ),
        pool.query<{ payload: Record<string, unknown> }>(
          `SELECT payload FROM sync_entity_state WHERE tenant_id = $1 AND entity = 'auditLogs' AND deleted = FALSE
              AND payload->>'action' = 'order.return' AND payload->>'entityId' = ANY($2::text[])`,
          [tenantId, refundOrderIds],
        ),
      ])
    : [{ rows: [] }, { rows: [] }, { rows: [] }]
  const returns = buildReturnRows(
    refunds.rows.map((r) => r.payload),
    refundOrders.rows.map((r) => r.payload),
    refundItems.rows.map((r) => r.payload),
    refundAudits.rows.map((r) => r.payload),
  )

  return buildCancellationReport(
    days,
    orders.rows.map((r) => r.payload),
    audits.rows.map((r) => r.payload),
    items.rows.map((r) => r.payload),
    returns,
  )
}

/**
 * Pelunasan piutang dalam [sinceMs, untilMs): pembayaran untuk penjualan yang diakui
 * yang dibayar di HARI LAIN (WIB) dari tanggal pesanannya — mis. dibuka tgl 29, lunas
 * tgl 30. Uang masuk, bukan omzet periode ini (omzetnya di tanggal pesanan).
 */
export async function loadSettlements(pool: Pool, tenantId: string, sinceMs: number, untilMs: number): Promise<TransactionSettlement[]> {
  const pAt = numField('createdAt').replace(/payload/g, 'p.payload')
  const { rows } = await pool.query<{ p: Record<string, unknown>; o: Record<string, unknown> }>(
    `SELECT p.payload AS p, o.payload AS o
       FROM sync_entity_state p
       JOIN sync_entity_state o
         ON o.tenant_id = p.tenant_id AND o.entity = 'orders' AND o.deleted = FALSE
        AND o.entity_id = p.payload->>'orderId'
      WHERE p.tenant_id = $1 AND p.entity = 'payments' AND p.deleted = FALSE
        AND ${pAt} >= $2 AND ${pAt} < $3
        AND ${RECOGNIZED_SALE_SQL.replace(/payload/g, 'o.payload')}
      LIMIT 5000`,
    [tenantId, sinceMs, untilMs],
  )
  return rows
    .flatMap(({ p, o }) => {
      const amount = num(p.amount)
      const paidAt = num(p.createdAt)
      const orderedAt = num(o.createdAt)
      if (amount <= 0 || p.reversalOfPaymentId || !paidAt || (orderedAt && wibDay(orderedAt) === wibDay(paidAt))) return []
      return [{ orderNumber: typeof o.orderNumber === 'string' ? o.orderNumber : null, orderedAt: orderedAt || null, paidAt, method: String(p.method ?? 'lainnya'), amount }]
    })
    .sort((a, b) => a.paidAt - b.paidAt)
}

/**
 * Transaksi satu periode (akrual): penjualan yang DIAKUI di periode itu menurut
 * tanggal pesanan — lunas maupun tagihan tertunda yang belum dibayar — dan batal
 * (waktu batal), plus SEMUA tagihan tertunda yang masih belum lunas (saldo piutang).
 */
export async function loadTransactionReport(pool: Pool, tenantId: string, sinceMs: number, untilMs: number): Promise<TransactionReport> {
  const orders = await pool.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM sync_entity_state
      WHERE tenant_id = $1 AND entity = 'orders' AND deleted = FALSE AND (
            (${RECOGNIZED_SALE_SQL} AND ${SALE_AT_MS} >= $2 AND ${SALE_AT_MS} < $3)
         OR (payload->>'status' = 'void' AND ${VOIDED_AT_SQL} >= $2 AND ${VOIDED_AT_SQL} < $3)
         OR (payload->>'status' = 'open' AND payload->'payLater' IS NOT NULL AND jsonb_typeof(payload->'payLater') = 'object'))
      LIMIT 5000`,
    [tenantId, sinceMs, untilMs],
  )
  const ids = orders.rows.map((r) => String(r.payload.id ?? ''))
  const [payments, settlements] = await Promise.all([
    ids.length
      ? pool.query<{ payload: Record<string, unknown> }>(
          `SELECT payload FROM sync_entity_state
            WHERE tenant_id = $1 AND entity = 'payments' AND deleted = FALSE
              AND payload->>'orderId' = ANY($2::text[])`,
          [tenantId, ids],
        )
      : { rows: [] as { payload: Record<string, unknown> }[] },
    loadSettlements(pool, tenantId, sinceMs, untilMs),
  ])

  const inPeriodById = new Map(
    orders.rows.map(({ payload: o }) => {
      const at = num(o.createdAt)
      return [String(o.id ?? ''), o.status !== 'void' && at >= sinceMs && at < untilMs] as const
    }),
  )
  const methodsByOrder = new Map<string, Set<string>>()
  const paidByOrder = new Map<string, number>()
  const byMethod = new Map<string, { method: string; amount: number; count: number }>()
  for (const { payload: p } of payments.rows) {
    const amount = num(p.amount)
    if (amount <= 0 || p.reversalOfPaymentId) continue
    const orderId = String(p.orderId ?? '')
    const method = String(p.method ?? 'lainnya')
    const set = methodsByOrder.get(orderId) ?? new Set<string>()
    set.add(method)
    methodsByOrder.set(orderId, set)
    paidByOrder.set(orderId, (paidByOrder.get(orderId) ?? 0) + amount)
    if (inPeriodById.get(orderId)) {
      const m = byMethod.get(method) ?? { method, amount: 0, count: 0 }
      m.amount += amount
      m.count += 1
      byMethod.set(method, m)
    }
  }

  const rows: TransactionRow[] = orders.rows.map(({ payload: o }) => {
    const id = String(o.id ?? '')
    const st = String(o.status ?? '')
    const status: TransactionRow['status'] = st === 'paid' || st === 'completed' ? 'paid' : st === 'void' ? 'void' : 'open'
    const payLater = (o.payLater ?? null) as Record<string, unknown> | null
    const grandTotal = num(o.grandTotal)
    const at = status === 'void' ? num(o.voidedAt) || num(o.updatedAt) : num(o.createdAt)
    return {
      orderNumber: typeof o.orderNumber === 'string' ? o.orderNumber : null,
      queueNumber: o.queueNumber == null ? null : num(o.queueNumber) || null,
      buyer: typeof o.notes === 'string' && o.notes.trim() ? o.notes.trim() : typeof payLater?.name === 'string' ? payLater.name : null,
      cashierName: typeof o.cashierName === 'string' ? o.cashierName : null,
      methods: [...(methodsByOrder.get(id) ?? [])],
      status,
      payLater: !!payLater,
      inPeriod: inPeriodById.get(id) ?? false,
      grandTotal,
      outstanding: status === 'open' ? Math.max(0, grandTotal - (paidByOrder.get(id) ?? 0)) : 0,
      discountAmount: num(o.discountAmount),
      discountReason: typeof o.discountReason === 'string' ? o.discountReason : null,
      discountByName: typeof o.discountByName === 'string' ? o.discountByName : null,
      discountApproval: o.discountApproval === 'owner_code' ? 'owner_code' : o.discountApproval === 'self' ? 'self' : null,
      at: at || null,
      paidAt: status === 'paid' ? num(o.paidAt) || null : null,
    }
  })
  rows.sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
  const sales = rows.filter((r) => r.inPeriod)
  const paid = sales.filter((r) => r.status === 'paid')
  const openPayLater = rows.filter((r) => r.status === 'open')
  return {
    rows,
    byMethod: [...byMethod.values()].sort((a, b) => b.amount - a.amount),
    salesCount: sales.length,
    salesValue: sales.reduce((s, r) => s + r.grandTotal, 0),
    paidCount: paid.length,
    paidValue: paid.reduce((s, r) => s + r.grandTotal, 0),
    receivableValue: sales.reduce((s, r) => s + r.outstanding, 0),
    voidCount: rows.filter((r) => r.status === 'void').length,
    openPayLaterCount: openPayLater.length,
    openPayLaterValue: openPayLater.reduce((s, r) => s + r.outstanding, 0),
    discountCount: sales.filter((r) => r.discountAmount > 0).length,
    discountValue: sales.reduce((s, r) => s + r.discountAmount, 0),
    settlements,
    settlementValue: settlements.reduce((s, x) => s + x.amount, 0),
  }
}

/** Rekap penjualan (akrual, menurut tanggal pesanan) untuk rentang [sinceMs, untilMs) — isinya mengikuti jenis usaha tenant. */
export async function loadSalesReport(pool: Pool, tenantId: string, sinceMs: number, untilMs: number): Promise<SalesReport> {
  const [settings, orders, payLater, settlements] = await Promise.all([
    pool.query<{ business_type: string | null }>(
      `SELECT payload->>'businessType' AS business_type FROM sync_entity_state
        WHERE tenant_id = $1 AND entity = 'settings' AND entity_id = 'singleton' AND deleted = FALSE`,
      [tenantId],
    ),
    pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM sync_entity_state
        WHERE tenant_id = $1 AND entity = 'orders' AND deleted = FALSE
          AND ${RECOGNIZED_SALE_SQL}
          AND ${SALE_AT_MS} >= $2 AND ${SALE_AT_MS} < $3
        LIMIT 5000`,
      [tenantId, sinceMs, untilMs],
    ),
    pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM sync_entity_state
        WHERE tenant_id = $1 AND entity = 'orders' AND deleted = FALSE
          AND payload->>'status' = 'open' AND jsonb_typeof(payload->'payLater') = 'object'
        LIMIT 500`,
      [tenantId],
    ),
    loadSettlements(pool, tenantId, sinceMs, untilMs),
  ])
  const ids = orders.rows.map((r) => String(r.payload.id ?? ''))
  // Pembayaran juga untuk tagihan tertunda di luar periode — sisa tagihannya dihitung dari situ.
  const paymentIds = [...new Set([...ids, ...payLater.rows.map((r) => String(r.payload.id ?? ''))])]
  const byOrderIds = (entity: 'orderItems' | 'payments', orderIds: string[]) =>
    orderIds.length
      ? pool.query<{ payload: Record<string, unknown> }>(
          `SELECT payload FROM sync_entity_state
            WHERE tenant_id = $1 AND entity = $2 AND deleted = FALSE
              AND payload->>'orderId' = ANY($3::text[])`,
          [tenantId, entity, orderIds],
        )
      : Promise.resolve({ rows: [] as { payload: Record<string, unknown> }[] })
  const [items, payments] = await Promise.all([byOrderIds('orderItems', ids), byOrderIds('payments', paymentIds)])
  return buildSalesReport({
    businessType: settings.rows[0]?.business_type ?? null,
    orders: orders.rows.map((r) => r.payload),
    items: items.rows.map((r) => r.payload),
    payments: payments.rows.map((r) => r.payload),
    openPayLater: payLater.rows.map((r) => r.payload),
    settlements,
  })
}

/** Detail satu tenant: total omzet, 60 transaksi terbaru, 120 log aktivitas terbaru. */
export async function loadTenantDetail(pool: Pool, tenantId: string) {
  const [totals, orders, audit] = await Promise.all([
    pool.query<{ revenue: string; txns: string; month_revenue: string }>(
      `SELECT coalesce(sum(${GRAND_TOTAL}), 0) AS revenue,
              count(*)                                            AS txns,
              coalesce(sum(${GRAND_TOTAL}) FILTER (
                WHERE ${tsOf(SALE_AT_MS)}
                      > now() - interval '30 days'), 0)          AS month_revenue
         FROM sync_entity_state
        WHERE tenant_id = $1 AND entity = 'orders' AND deleted = FALSE
          AND ${RECOGNIZED_SALE_SQL}`,
      [tenantId],
    ),
    pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM sync_entity_state
        WHERE tenant_id = $1 AND entity = 'orders' AND deleted = FALSE
        ORDER BY ${numField('createdAt')} DESC NULLS LAST
        LIMIT 60`,
      [tenantId],
    ),
    pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM sync_entity_state
        WHERE tenant_id = $1 AND entity = 'auditLogs' AND deleted = FALSE
        ORDER BY ${numField('createdAt')} DESC NULLS LAST
        LIMIT 120`,
      [tenantId],
    ),
  ])

  const t = totals.rows[0]
  return {
    tenantId,
    totals: {
      revenue: num(t?.revenue),
      txns: num(t?.txns),
      revenue30Days: num(t?.month_revenue),
    },
    orders: orders.rows.map((r) => {
      const p = r.payload
      return {
        orderNumber: p.orderNumber ?? null,
        status: p.status ?? null,
        type: p.type ?? null,
        grandTotal: num(p.grandTotal),
        cashierName: p.cashierName ?? null,
        discountAmount: num(p.discountAmount),
        source: p.source ?? null,
        createdAt: p.createdAt ?? null,
        paidAt: p.paidAt ?? null,
      }
    }),
    auditLogs: audit.rows.map((r) => {
      const p = r.payload
      return {
        userName: p.userName ?? null,
        action: p.action ?? null,
        entityType: p.entityType ?? null,
        details: p.details ?? null,
        createdAt: p.createdAt ?? null,
      }
    }),
  }
}

/**
 * Ringkasan satu tenant untuk konsol Pemilik: identitas usaha, omzet hari ini &
 * 7 hari (WIB), pembatalan hari ini & 7 hari, dan perangkat kasir.
 */
export async function loadTenantOverview(pool: Pool, tenantId: string) {
  const [settings, today, week, cancels, devices] = await Promise.all([
    pool.query<{ business_name: string | null; business_type: string | null }>(
      `SELECT payload->>'businessName' AS business_name, payload->>'businessType' AS business_type
         FROM sync_entity_state
        WHERE tenant_id = $1 AND entity = 'settings' AND entity_id = 'singleton' AND deleted = FALSE`,
      [tenantId],
    ),
    pool.query<{ revenue: string; txns: string }>(
      `SELECT coalesce(sum(${GRAND_TOTAL}), 0) AS revenue, count(*) AS txns
         FROM sync_entity_state
        WHERE tenant_id = $1 AND entity = 'orders' AND deleted = FALSE
          AND ${RECOGNIZED_SALE_SQL}
          AND (${tsOf(SALE_AT_MS)} AT TIME ZONE 'Asia/Jakarta')::date
              = (now() AT TIME ZONE 'Asia/Jakarta')::date`,
      [tenantId],
    ),
    pool.query<{ d: string; revenue: string }>(
      `SELECT (${tsOf(SALE_AT_MS)} AT TIME ZONE 'Asia/Jakarta')::date::text AS d,
              sum(${GRAND_TOTAL}) AS revenue
         FROM sync_entity_state
        WHERE tenant_id = $1 AND entity = 'orders' AND deleted = FALSE
          AND ${RECOGNIZED_SALE_SQL}
          AND ${tsOf(SALE_AT_MS)} > now() - interval '8 days'
        GROUP BY d
        ORDER BY d`,
      [tenantId],
    ),
    pool.query<{ today_count: string; today_value: string; week_count: string; week_value: string }>(
      `SELECT count(*) FILTER (WHERE is_today)                AS today_count,
              coalesce(sum(value) FILTER (WHERE is_today), 0) AS today_value,
              count(*)                                        AS week_count,
              coalesce(sum(value), 0)                         AS week_value
         FROM (
           SELECT c.is_today,
                  CASE WHEN c.total > 0 THEN c.total ELSE ${CORRECTED_VALUE_SQL} END AS value
             FROM (
               SELECT tenant_id,
                      payload->>'id' AS id,
                      ${GRAND_TOTAL} AS total,
                      (${tsOf(VOIDED_AT_SQL)} AT TIME ZONE 'Asia/Jakarta')::date
                        = (now() AT TIME ZONE 'Asia/Jakarta')::date AS is_today
                 FROM sync_entity_state
                WHERE tenant_id = $1 AND ${COUNTED_CANCEL_SQL}
                  AND ${tsOf(VOIDED_AT_SQL)} > now() - interval '7 days'
             ) c
         ) v`,
      [tenantId],
    ),
    pool.query<{ total: string; online: string; last_seen: string | null }>(
      `SELECT count(*)                                                            AS total,
              count(*) FILTER (WHERE last_seen_at > now() - interval '3 minutes') AS online,
              extract(epoch from max(last_seen_at)) * 1000                        AS last_seen
         FROM sync_devices
        WHERE tenant_id = $1 AND revoked = FALSE`,
      [tenantId],
    ),
  ])

  const s = settings.rows[0]
  const t = today.rows[0]
  const c = cancels.rows[0]
  const d = devices.rows[0]
  return {
    tenantId,
    businessName: s?.business_name ?? null,
    businessType: s?.business_type ?? null,
    today: { revenue: num(t?.revenue), txns: num(t?.txns) },
    last7Days: week.rows.map((r) => ({ date: r.d, revenue: num(r.revenue) })),
    cancellations: {
      todayCount: num(c?.today_count),
      todayValue: num(c?.today_value),
      last7DaysCount: num(c?.week_count),
      last7DaysValue: num(c?.week_value),
    },
    devices: {
      total: num(d?.total),
      online: num(d?.online),
      lastSeenAt: d?.last_seen == null ? null : Math.round(num(d.last_seen)),
    },
  }
}

export type TenantExport =
  | { ok: true; pdf: Buffer; filename: string }
  | { ok: false; status: 400 | 404; error: string }

/** Export PDF transaksi / pembatalan satu tenant untuk rentang tanggal WIB. */
export async function buildTenantExport(
  pool: Pool,
  tenantId: string,
  kind: string,
  from: string | undefined,
  to: string | undefined,
): Promise<TenantExport> {
  if (kind !== 'transactions.pdf' && kind !== 'cancellations.pdf') {
    return { ok: false, status: 404, error: 'Jenis export tidak dikenal' }
  }
  const range = parseWibRange(from, to)
  if ('error' in range) return { ok: false, status: 400, error: range.error }
  const settings = await pool.query<{ name: string | null }>(
    `SELECT payload->>'businessName' AS name FROM sync_entity_state
      WHERE tenant_id = $1 AND entity = 'settings' AND entity_id = 'singleton' AND deleted = FALSE`,
    [tenantId],
  )
  const meta = {
    businessName: settings.rows[0]?.name?.trim() || tenantId,
    tenantId,
    periodLabel: range.label,
    generatedAt: Date.now(),
  }
  const days = Math.round((range.untilMs - range.sinceMs) / 86_400_000)
  const pdf =
    kind === 'transactions.pdf'
      ? buildTransactionsPdf(meta, await loadTransactionReport(pool, tenantId, range.sinceMs, range.untilMs))
      : buildCancellationsPdf(meta, await loadCancellationReport(pool, tenantId, range.sinceMs, range.untilMs, days))
  const filename = `${kind === 'transactions.pdf' ? 'transaksi' : 'pembatalan'}-${tenantId}-${range.fileLabel}.pdf`
  return { ok: true, pdf, filename }
}
