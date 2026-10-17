import type { Pool } from 'pg'
import { GRAND_TOTAL, PAID_OR_CREATED_MS, num, numField, tsOf } from './tenantReports.js'

/**
 * Konsol Pemilik dipisah per jenis usaha: kafe di `/owner/kafe`, kantin di
 * `/owner/kantin`, jenis lain (minimarket, "lainnya") tetap di `/owner`. Tautan
 * akses hanya diterima di alamat milik jenis usahanya (lihat routes/owner.ts).
 */
export type OwnerConsoleArea = 'kafe' | 'kantin' | 'umum'

export function ownerConsoleAreaFor(businessType: string | null | undefined): OwnerConsoleArea {
  if (businessType === 'cafe_resto') return 'kafe'
  if (businessType === 'kantin') return 'kantin'
  return 'umum'
}

export const ownerConsolePath = (area: OwnerConsoleArea): string => (area === 'umum' ? '/owner' : `/owner/${area}`)

export const OWNER_CONSOLE_TITLES: Record<OwnerConsoleArea, string> = {
  kafe: 'Konsol Pemilik Kafe',
  kantin: 'Konsol Pemilik Kantin',
  umum: 'Konsol Pemilik',
}

export async function loadTenantBusinessType(pool: Pool, tenantId: string): Promise<string | null> {
  const { rows } = await pool.query<{ business_type: string | null }>(
    `SELECT payload->>'businessType' AS business_type FROM sync_entity_state
      WHERE tenant_id = $1 AND entity = 'settings' AND entity_id = 'singleton' AND deleted = FALSE`,
    [tenantId],
  )
  return rows[0]?.business_type ?? null
}

const PAID_TODAY_SQL = `payload->>'status' IN ('paid', 'completed')
  AND (${tsOf(PAID_OR_CREATED_MS)} AT TIME ZONE 'Asia/Jakarta')::date = (now() AT TIME ZONE 'Asia/Jakarta')::date`

const OPEN_PAY_LATER_SQL = `entity = 'orders' AND deleted = FALSE
  AND payload->>'status' = 'open' AND jsonb_typeof(payload->'payLater') = 'object'`

/** `numField` untuk tabel ber-alias (mis. `o.payload`). */
const nf = (field: string, alias?: string): string =>
  alias ? numField(field).replace(/payload/g, `${alias}.payload`) : numField(field)

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

// ---------------------------------------------------------------- Kafe

/** Tambahan ringkasan kafe: tamu & tip hari ini, meja terisi sekarang. */
export async function loadCafeHighlights(pool: Pool, tenantId: string) {
  const [today, tips, tables] = await Promise.all([
    pool.query<{ guests: string }>(
      `SELECT coalesce(sum(coalesce(${nf('guestCount')}, 0)), 0) AS guests
         FROM sync_entity_state
        WHERE tenant_id = $1 AND entity = 'orders' AND deleted = FALSE AND ${PAID_TODAY_SQL}`,
      [tenantId],
    ),
    pool.query<{ tips: string }>(
      `SELECT coalesce(sum(coalesce(${nf('tipAmount', 'p')}, 0)), 0) AS tips
         FROM sync_entity_state p
         JOIN sync_entity_state o
           ON o.tenant_id = p.tenant_id AND o.entity = 'orders' AND o.entity_id = p.payload->>'orderId'
        WHERE p.tenant_id = $1 AND p.entity = 'payments' AND p.deleted = FALSE
          AND o.deleted = FALSE AND ${PAID_TODAY_SQL.replace(/payload/g, 'o.payload')}`,
      [tenantId],
    ),
    pool.query<{ total: string; occupied: string }>(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE coalesce(payload->>'status', 'available') <> 'available') AS occupied
         FROM sync_entity_state
        WHERE tenant_id = $1 AND entity = 'cafeTables' AND deleted = FALSE`,
      [tenantId],
    ),
  ])
  return {
    guestsToday: num(today.rows[0]?.guests),
    tipsToday: num(tips.rows[0]?.tips),
    tables: { total: num(tables.rows[0]?.total), occupied: num(tables.rows[0]?.occupied) },
  }
}

/** Status meja saat ini + pesanan yang sedang berjalan di meja itu. */
export async function loadCafeTables(pool: Pool, tenantId: string) {
  const { rows } = await pool.query<{ t: Record<string, unknown>; o: Record<string, unknown> | null }>(
    `SELECT t.payload AS t, o.payload AS o
       FROM sync_entity_state t
       LEFT JOIN sync_entity_state o
         ON o.tenant_id = t.tenant_id AND o.entity = 'orders' AND o.deleted = FALSE
        AND o.entity_id = t.payload->>'currentOrderId'
      WHERE t.tenant_id = $1 AND t.entity = 'cafeTables' AND t.deleted = FALSE
      LIMIT 500`,
    [tenantId],
  )
  const tables = rows.map(({ t, o }) => ({
    name: str(t.name) ?? '-',
    area: str(t.area),
    capacity: num(t.capacity),
    status: str(t.status) ?? 'available',
    guestCount: t.guestCount == null ? null : num(t.guestCount),
    occupiedSince: t.occupiedSince == null ? null : num(t.occupiedSince),
    order: o
      ? {
          orderNumber: str(o.orderNumber),
          grandTotal: num(o.grandTotal),
          waiterName: str(o.waiterName),
          status: str(o.status),
        }
      : null,
  }))
  tables.sort((a, b) => (a.area ?? '').localeCompare(b.area ?? '') || a.name.localeCompare(b.name, 'id', { numeric: true }))
  return { tables }
}

// ---------------------------------------------------------------- Kantin

/** Tambahan ringkasan kantin: tagihan tertunda terbuka & bukti bayar hari ini. */
export async function loadKantinHighlights(pool: Pool, tenantId: string) {
  const [payLater, proofs] = await Promise.all([
    pool.query<{ count: string; value: string }>(
      `SELECT count(*) AS count, coalesce(sum(${GRAND_TOTAL}), 0) AS value
         FROM sync_entity_state WHERE tenant_id = $1 AND ${OPEN_PAY_LATER_SQL}`,
      [tenantId],
    ),
    pool.query<{ count: string; no_photo: string }>(
      `SELECT count(*) AS count,
              count(*) FILTER (WHERE coalesce(payload->>'photoDataUrl', '') = '') AS no_photo
         FROM sync_entity_state
        WHERE tenant_id = $1 AND entity = 'paymentProofs' AND deleted = FALSE
          AND (${tsOf(nf('createdAt'))} AT TIME ZONE 'Asia/Jakarta')::date
              = (now() AT TIME ZONE 'Asia/Jakarta')::date`,
      [tenantId],
    ),
  ])
  return {
    payLater: { count: num(payLater.rows[0]?.count), value: num(payLater.rows[0]?.value) },
    proofsToday: { count: num(proofs.rows[0]?.count), withoutPhoto: num(proofs.rows[0]?.no_photo) },
  }
}

const payLaterRow = (o: Record<string, unknown>) => {
  const pl = (o.payLater ?? {}) as Record<string, unknown>
  return {
    name: str(pl.name) ?? '-',
    note: str(pl.note),
    markedByName: str(pl.markedByName),
    markedAt: pl.markedAt == null ? null : num(pl.markedAt),
    orderNumber: str(o.orderNumber),
    value: num(o.grandTotal),
    paidAt: o.paidAt == null ? null : num(o.paidAt),
  }
}

/** Tagihan Tertunda: yang masih terbuka (semua) + yang dilunasi 30 hari terakhir. */
export async function loadKantinPayLater(pool: Pool, tenantId: string) {
  const [open, settled] = await Promise.all([
    pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM sync_entity_state WHERE tenant_id = $1 AND ${OPEN_PAY_LATER_SQL}
        ORDER BY ${nf('createdAt')} ASC NULLS LAST LIMIT 500`,
      [tenantId],
    ),
    pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM sync_entity_state
        WHERE tenant_id = $1 AND entity = 'orders' AND deleted = FALSE
          AND payload->>'status' IN ('paid', 'completed') AND jsonb_typeof(payload->'payLater') = 'object'
          AND ${nf('paidAt')} > (extract(epoch from now() - interval '30 days') * 1000)
        ORDER BY ${nf('paidAt')} DESC LIMIT 200`,
      [tenantId],
    ),
  ])
  const openRows = open.rows.map((r) => payLaterRow(r.payload))
  return {
    open: openRows,
    openValue: openRows.reduce((s, r) => s + r.value, 0),
    settled: settled.rows.map((r) => payLaterRow(r.payload)),
  }
}

/** Bukti bayar QRIS/transfer untuk rentang [sinceMs, untilMs) — tanpa foto (diambil per id). */
export async function loadKantinProofs(pool: Pool, tenantId: string, sinceMs: number, untilMs: number) {
  const { rows } = await pool.query<{ id: string; p: Record<string, unknown>; has_photo: boolean; o: Record<string, unknown> | null; method: string | null; amount: string | null }>(
    `SELECT pr.entity_id AS id,
            pr.payload - 'photoDataUrl' AS p,
            coalesce(pr.payload->>'photoDataUrl', '') <> '' AS has_photo,
            o.payload AS o,
            pay.method, pay.amount
       FROM sync_entity_state pr
       LEFT JOIN sync_entity_state o
         ON o.tenant_id = pr.tenant_id AND o.entity = 'orders' AND o.entity_id = pr.payload->>'orderId'
       LEFT JOIN LATERAL (
         SELECT payload->>'method' AS method, payload->>'amount' AS amount FROM sync_entity_state
          WHERE tenant_id = pr.tenant_id AND entity = 'payments' AND deleted = FALSE
            AND payload->>'orderId' = pr.payload->>'orderId' AND payload->>'method' IN ('qris', 'transfer')
          LIMIT 1
       ) pay ON TRUE
      WHERE pr.tenant_id = $1 AND pr.entity = 'paymentProofs' AND pr.deleted = FALSE
        AND ${nf('createdAt', 'pr')} >= $2 AND ${nf('createdAt', 'pr')} < $3
      ORDER BY ${nf('createdAt', 'pr')} DESC
      LIMIT 300`,
    [tenantId, sinceMs, untilMs],
  )
  return {
    proofs: rows.map((r) => ({
      id: r.id,
      orderNumber: str(r.o?.orderNumber),
      method: r.method,
      amount: r.amount == null ? num(r.o?.grandTotal) : num(r.amount),
      takenByName: str(r.p.takenByName),
      createdAt: r.p.createdAt == null ? null : num(r.p.createdAt),
      hasPhoto: r.has_photo,
      noPhotoReason: str(r.p.noPhotoReason),
    })),
  }
}

/** Foto bukti bayar (data URL JPEG/PNG yang disimpan tablet) → biner. null bila tak ada. */
export async function loadKantinProofPhoto(
  pool: Pool,
  tenantId: string,
  proofId: string,
): Promise<{ contentType: string; body: Buffer } | null> {
  const { rows } = await pool.query<{ photo: string | null }>(
    `SELECT payload->>'photoDataUrl' AS photo FROM sync_entity_state
      WHERE tenant_id = $1 AND entity = 'paymentProofs' AND entity_id = $2 AND deleted = FALSE`,
    [tenantId, proofId],
  )
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(rows[0]?.photo ?? '')
  return match ? { contentType: match[1], body: Buffer.from(match[2], 'base64') } : null
}
