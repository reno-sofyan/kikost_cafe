import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getPool } from '../db/pool.js'
import { OPS_DASHBOARD_HTML } from './opsDashboard.js'
import { buildCancellationReport } from '../lib/opsCancellations.js'

/**
 * Konsol operator lintas-tenant untuk pemilik backend (bukan untuk kasir/pemilik
 * usaha). Hanya MEMBACA data yang memang sudah disinkronkan tiap tenant ke server
 * ini — tidak mengumpulkan apa pun yang baru dari perangkat. Sengaja TIDAK ditautkan
 * dari app POS; ini perkakas operasional terpisah di `/ops`.
 *
 * Catatan kepatuhan: akses operator ke data tenant untuk dukungan & pemantauan
 * sebaiknya diungkap di syarat layanan / kebijakan privasi kepada pemilik usaha.
 *
 * Auth: satu token statik (`OPS_TOKEN`). Bila kosong, plugin ini tidak didaftarkan
 * sama sekali sehingga seluruh `/ops*` mengembalikan 404.
 */

const TENANT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

function extractBearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1] : null
}

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Cast aman dari payload JSONB: nilai yang bukan angka murni (string tanggal, kosong,
 * notasi aneh dari perangkat lama) menjadi NULL alih-alih menggagalkan SELURUH query
 * dengan "invalid input syntax" (500) — satu baris rusak tak boleh mematikan dashboard.
 */
const numField = (field: string): string =>
  `(CASE WHEN jsonb_typeof(payload->'${field}') = 'number' THEN (payload->>'${field}')::numeric
         WHEN payload->>'${field}' ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (payload->>'${field}')::numeric END)`
/** Epoch ms → timestamptz, aman untuk nilai di luar jangkauan tanggal Postgres. */
const tsOf = (msSql: string): string =>
  `(CASE WHEN ${msSql} BETWEEN 0 AND 32503680000000 THEN to_timestamp(${msSql} / 1000.0) END)`
const PAID_OR_CREATED_MS = `coalesce(${numField('paidAt')}, ${numField('createdAt')})`
const GRAND_TOTAL = `coalesce(${numField('grandTotal')}, 0)`

/** Waktu batal (epoch ms) sebuah order di payload; data lama tanpa `voidedAt` → `updatedAt`. */
const VOIDED_AT_SQL = `coalesce(${numField('voidedAt')}, ${numField('updatedAt')})`
/**
 * Pesanan batal yang dihitung: SEMUA yang berstatus void — termasuk Rp0, karena
 * "kosongkan dulu lalu batalkan sebagai pesanan kosong" justru jalur yang harus terlihat.
 */
const COUNTED_CANCEL_SQL = `entity = 'orders' AND deleted = FALSE AND payload->>'status' = 'void'`
/** Nilai item yang dihapus/di-void + pengurangan qty pada satu pesanan (subquery berkorelasi ke `c.id`). */
const CORRECTED_VALUE_SQL = `(SELECT coalesce(sum(
      CASE WHEN i.payload->>'removed' = 'true' OR i.payload->>'voided' = 'true'
           THEN coalesce(CASE WHEN jsonb_typeof(i.payload->'lineTotal') = 'number' THEN (i.payload->>'lineTotal')::numeric END, 0)
           ELSE 0 END
      + coalesce(CASE WHEN jsonb_typeof(i.payload->'reducedValue') = 'number' THEN (i.payload->>'reducedValue')::numeric END, 0)), 0)
     FROM sync_entity_state i
    WHERE i.tenant_id = c.tenant_id AND i.entity = 'orderItems' AND i.deleted = FALSE
      AND i.payload->>'orderId' = c.id)`

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export async function registerOpsRoutes(app: FastifyInstance, opsToken: string): Promise<void> {
  // Gerbang auth ter-scope ke plugin ini. Halaman shell `/ops` boleh dimuat tanpa
  // token (tidak memuat data); seluruh `/ops/api/*` wajib Bearer token yang cocok.
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.url.startsWith('/ops/api')) return
    const key = extractBearer(request)
    if (!key || !tokenMatches(key, opsToken)) {
      request.log.warn({ ip: request.ip }, 'ops: token ditolak')
      reply.code(401)
      throw new Error('Token operator tidak sah')
    }
  })

  // ---- Shell dashboard (HTML statis, tanpa data) ----
  app.get('/', async (_request, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8')
    reply.header('cache-control', 'no-store')
    reply.header('x-robots-tag', 'noindex, nofollow')
    return OPS_DASHBOARD_HTML
  })

  // ---- Ringkasan lintas-tenant: omzet, kesehatan teknis, perangkat ----
  app.get('/api/summary', async () => {
    const pool = getPool()

    const [universe, settings, devices, today, week, pushHealth, activity, cancels] = await Promise.all([
      pool.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM sync_entity_state
         UNION SELECT tenant_id FROM sync_devices`,
      ),
      pool.query<{ tenant_id: string; business_name: string | null; business_type: string | null }>(
        `SELECT tenant_id,
                payload->>'businessName' AS business_name,
                payload->>'businessType' AS business_type
           FROM sync_entity_state
          WHERE entity = 'settings' AND deleted = FALSE`,
      ),
      pool.query<{ tenant_id: string; total: string; online: string; last_seen: string | null }>(
        `SELECT tenant_id,
                count(*)                                                         AS total,
                count(*) FILTER (WHERE last_seen_at > now() - interval '3 minutes') AS online,
                extract(epoch from max(last_seen_at)) * 1000                     AS last_seen
           FROM sync_devices
          WHERE revoked = FALSE
          GROUP BY tenant_id`,
      ),
      pool.query<{ tenant_id: string; revenue: string; txns: string }>(
        `SELECT tenant_id,
                coalesce(sum(${GRAND_TOTAL}), 0) AS revenue,
                count(*)                                            AS txns
           FROM sync_entity_state
          WHERE entity = 'orders' AND deleted = FALSE
            AND payload->>'status' IN ('paid', 'completed')
            AND (${tsOf(PAID_OR_CREATED_MS)}
                   AT TIME ZONE 'Asia/Jakarta')::date
                = (now() AT TIME ZONE 'Asia/Jakarta')::date
          GROUP BY tenant_id`,
      ),
      pool.query<{ tenant_id: string; d: string; revenue: string }>(
        `SELECT tenant_id,
                (${tsOf(PAID_OR_CREATED_MS)}
                   AT TIME ZONE 'Asia/Jakarta')::date::text AS d,
                sum(${GRAND_TOTAL}) AS revenue
           FROM sync_entity_state
          WHERE entity = 'orders' AND deleted = FALSE
            AND payload->>'status' IN ('paid', 'completed')
            AND ${tsOf(PAID_OR_CREATED_MS)}
                > now() - interval '8 days'
          GROUP BY tenant_id, d`,
      ),
      pool.query<{ tenant_id: string; rejected: string; items: string }>(
        `SELECT tenant_id,
                coalesce(sum(rejected), 0)   AS rejected,
                coalesce(sum(item_count), 0) AS items
           FROM sync_push_log
          WHERE created_at > now() - interval '24 hours'
          GROUP BY tenant_id`,
      ),
      pool.query<{ tenant_id: string; last_activity: string | null }>(
        `SELECT tenant_id, extract(epoch from max(updated_at)) * 1000 AS last_activity
           FROM sync_entity_state
          GROUP BY tenant_id`,
      ),
      pool.query<{ tenant_id: string; today_count: string; today_value: string; week_count: string; week_value: string }>(
        `SELECT tenant_id,
                count(*) FILTER (WHERE is_today)                AS today_count,
                coalesce(sum(value) FILTER (WHERE is_today), 0) AS today_value,
                count(*)                                        AS week_count,
                coalesce(sum(value), 0)                         AS week_value
           FROM (
             SELECT c.tenant_id, c.is_today,
                    CASE WHEN c.total > 0 THEN c.total ELSE ${CORRECTED_VALUE_SQL} END AS value
               FROM (
             SELECT tenant_id,
                    payload->>'id' AS id,
                    ${GRAND_TOTAL} AS total,
                    (${tsOf(VOIDED_AT_SQL)} AT TIME ZONE 'Asia/Jakarta')::date
                      = (now() AT TIME ZONE 'Asia/Jakarta')::date AS is_today
               FROM sync_entity_state
              WHERE ${COUNTED_CANCEL_SQL}
                AND ${tsOf(VOIDED_AT_SQL)} > now() - interval '7 days'
               ) c
           ) v
          GROUP BY tenant_id`,
      ),
    ])

    const byTenant = new Map<string, Record<string, unknown>>()
    const ensure = (id: string) => {
      let t = byTenant.get(id)
      if (!t) {
        t = {
          tenantId: id,
          businessName: null,
          businessType: null,
          devices: { total: 0, online: 0, lastSeenAt: null },
          today: { revenue: 0, txns: 0 },
          last7Days: [] as { date: string; revenue: number }[],
          health: { pushRejected24h: 0, pushItems24h: 0, lastActivityAt: null },
          cancellations: { todayCount: 0, todayValue: 0, last7DaysCount: 0, last7DaysValue: 0 },
        }
        byTenant.set(id, t)
      }
      return t
    }

    for (const r of universe.rows) ensure(r.tenant_id)
    for (const r of settings.rows) {
      const t = ensure(r.tenant_id)
      t.businessName = r.business_name
      t.businessType = r.business_type
    }
    for (const r of devices.rows) {
      const t = ensure(r.tenant_id)
      t.devices = {
        total: num(r.total),
        online: num(r.online),
        lastSeenAt: r.last_seen == null ? null : Math.round(num(r.last_seen)),
      }
    }
    for (const r of today.rows) {
      const t = ensure(r.tenant_id)
      t.today = { revenue: num(r.revenue), txns: num(r.txns) }
    }
    const weekByTenant = new Map<string, { date: string; revenue: number }[]>()
    for (const r of week.rows) {
      const list = weekByTenant.get(r.tenant_id) ?? []
      list.push({ date: r.d, revenue: num(r.revenue) })
      weekByTenant.set(r.tenant_id, list)
    }
    for (const [id, list] of weekByTenant) {
      // `d` di-cast ke text di SQL: tanpa itu `pg` mengembalikan objek Date dan
      // localeCompare melempar TypeError (500) begitu ada omzet di ≥2 hari.
      ensure(id).last7Days = list.sort((a, b) => String(a.date).localeCompare(String(b.date)))
    }
    for (const r of pushHealth.rows) {
      const t = ensure(r.tenant_id)
      const h = t.health as Record<string, unknown>
      h.pushRejected24h = num(r.rejected)
      h.pushItems24h = num(r.items)
    }
    for (const r of activity.rows) {
      const t = ensure(r.tenant_id)
      ;(t.health as Record<string, unknown>).lastActivityAt =
        r.last_activity == null ? null : Math.round(num(r.last_activity))
    }

    for (const r of cancels.rows) {
      ensure(r.tenant_id).cancellations = {
        todayCount: num(r.today_count),
        todayValue: num(r.today_value),
        last7DaysCount: num(r.week_count),
        last7DaysValue: num(r.week_value),
      }
    }

    const tenants = [...byTenant.values()].sort((a, b) =>
      String(a.tenantId).localeCompare(String(b.tenantId)),
    )
    return { generatedAt: Date.now(), tenantCount: tenants.length, tenants }
  })

  // ---- Detail satu tenant: log aktivitas + transaksi terbaru + total ----
  app.get<{ Params: { tenantId: string } }>('/api/tenant/:tenantId', async (request, reply) => {
    const tenantId = request.params.tenantId
    if (!TENANT_ID_RE.test(tenantId)) {
      reply.code(400)
      return { error: 'tenantId tidak valid' }
    }
    const pool = getPool()

    const [totals, orders, audit] = await Promise.all([
      pool.query<{ revenue: string; txns: string; month_revenue: string }>(
        `SELECT coalesce(sum(${GRAND_TOTAL}), 0) AS revenue,
                count(*)                                            AS txns,
                coalesce(sum(${GRAND_TOTAL}) FILTER (
                  WHERE ${tsOf(PAID_OR_CREATED_MS)}
                        > now() - interval '30 days'), 0)          AS month_revenue
           FROM sync_entity_state
          WHERE tenant_id = $1 AND entity = 'orders' AND deleted = FALSE
            AND payload->>'status' IN ('paid', 'completed')`,
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
  })

  // ---- Rekap pembatalan pesanan satu tenant (siapa minta, siapa setujui, alasan) ----
  app.get<{ Params: { tenantId: string }; Querystring: { days?: string } }>(
    '/api/tenant/:tenantId/cancellations',
    async (request, reply) => {
      const tenantId = request.params.tenantId
      if (!TENANT_ID_RE.test(tenantId)) {
        reply.code(400)
        return { error: 'tenantId tidak valid' }
      }
      const days = Math.min(90, Math.max(1, Math.trunc(num(request.query.days) || 30)))
      const since = Date.now() - days * 86_400_000
      const pool = getPool()

      const orders = await pool.query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM sync_entity_state
          WHERE tenant_id = $1 AND ${COUNTED_CANCEL_SQL}
            AND ${VOIDED_AT_SQL} > $2
          ORDER BY ${VOIDED_AT_SQL} DESC
          LIMIT 500`,
        [tenantId, since],
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

      return {
        tenantId,
        ...buildCancellationReport(
          days,
          orders.rows.map((r) => r.payload),
          audits.rows.map((r) => r.payload),
          items.rows.map((r) => r.payload),
        ),
      }
    },
  )
}
