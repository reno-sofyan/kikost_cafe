import { createHash, randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { loadBusinessIdentity, PublicOrderError, type BusinessIdentity } from './publicOrders.js'

/**
 * Ulasan tamu dari QR di struk (`/ulasan/<orderId>`). Id order (UUID v4 acak dari
 * tablet) adalah kodenya — tak bisa ditebak, dan satu struk hanya bisa mengulas
 * sekali. Ulasan ditulis sebagai entri Log Aktivitas `feedback.rating` dengan
 * format yang sama dengan penilaian di layar "Pembayaran Berhasil", sehingga
 * tablet menariknya lewat sinkronisasi biasa dan langsung muncul di Laporan.
 */

const ACTION = 'feedback.rating'
/** Rantai hash Log Aktivitas di-scope per perangkat; server memakai "perangkat" sendiri. */
export const REVIEW_DEVICE_ID = 'server-ulasan'
export const ORDER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ReviewPage {
  business: BusinessIdentity
  orderNumber: string
  paidAt: number | null
  review: { rating: number; comment: string } | null
  /** Tautan "tulis ulasan" Google Maps dari Pengaturan; null = tak ditawarkan. */
  googleReviewUrl: string | null
}

interface ReviewOrder {
  tenantId: string
  orderId: string
  orderNumber: string
  paidAt: number | null
}

async function resolveReviewOrder(client: PoolClient, orderId: string): Promise<ReviewOrder> {
  if (!ORDER_ID_RE.test(orderId)) throw new PublicOrderError(404, 'Struk tidak dikenal.')
  const { rows } = await client.query<{ tenant_id: string; payload: Record<string, unknown> }>(
    "SELECT tenant_id, payload FROM sync_entity_state WHERE entity = 'orders' AND entity_id = $1 AND deleted = FALSE",
    [orderId],
  )
  // Belum tersinkron dari tablet (atau kode salah). Lebih dari satu = data ganda antar-tenant → tolak.
  if (rows.length !== 1) {
    throw new PublicOrderError(404, 'Struk belum tercatat di server. Coba lagi beberapa menit lagi.')
  }
  const order = rows[0].payload
  if (order.status === 'void' || order.lifecycleStatus === 'CANCELLED') {
    throw new PublicOrderError(410, 'Transaksi ini sudah dibatalkan.')
  }
  if (order.status !== 'paid' && order.lifecycleStatus !== 'COMPLETED') {
    throw new PublicOrderError(409, 'Ulasan bisa diberikan setelah pesanan dibayar.')
  }
  return {
    tenantId: rows[0].tenant_id,
    orderId,
    orderNumber: String(order.orderNumber ?? ''),
    paidAt: typeof order.paidAt === 'number' ? order.paidAt : null,
  }
}

const DETAILS = /^Penilaian tamu ★(\d)\/5 untuk \S+\.(?: Komentar: ([\s\S]*))?$/

async function existingReview(client: PoolClient, tenantId: string, orderId: string): Promise<{ rating: number; comment: string } | null> {
  const { rows } = await client.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM sync_entity_state
      WHERE tenant_id = $1 AND entity = 'auditLogs' AND deleted = FALSE
        AND payload->>'entityType' = 'feedback' AND payload->>'action' = $2 AND payload->>'entityId' = $3
      LIMIT 1`,
    [tenantId, ACTION, orderId],
  )
  if (!rows[0]) return null
  const m = DETAILS.exec(String(rows[0].payload.details ?? ''))
  return m ? { rating: Number(m[1]), comment: m[2] ?? '' } : { rating: 0, comment: '' }
}

async function googleReviewUrl(client: PoolClient, tenantId: string): Promise<string | null> {
  const { rows } = await client.query<{ url: string | null }>(
    "SELECT payload->>'googleReviewUrl' AS url FROM sync_entity_state WHERE tenant_id = $1 AND entity = 'settings' AND deleted = FALSE LIMIT 1",
    [tenantId],
  )
  const url = rows[0]?.url?.trim()
  return url && /^https:\/\//i.test(url) ? url : null
}

export async function getReviewPage(client: PoolClient, orderId: string): Promise<ReviewPage> {
  const order = await resolveReviewOrder(client, orderId)
  return {
    business: await loadBusinessIdentity(client, order.tenantId),
    orderNumber: order.orderNumber,
    paidAt: order.paidAt,
    review: await existingReview(client, order.tenantId, orderId),
    googleReviewUrl: await googleReviewUrl(client, order.tenantId),
  }
}

/** Sama persis dengan `canonicalEntryText` di aplikasi (src/lib/auditLogIntegrity.ts). */
export function auditEntryHash(entry: {
  id: string
  userId: string
  userName: string
  action: string
  entityType: string
  entityId: string
  details: string
  createdAt: number
  deviceId: string | null
  deviceSeq: number | null
  prevHash: string | null
}): string {
  const canonical = JSON.stringify({
    id: entry.id,
    userId: entry.userId,
    userName: entry.userName,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    details: entry.details,
    createdAt: entry.createdAt,
    deviceId: entry.deviceId,
    deviceSeq: entry.deviceSeq,
    prevHash: entry.prevHash,
  })
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

/** Jalankan di dalam transaksi (`withTransaction`). */
export async function submitReview(
  client: PoolClient,
  orderId: string,
  input: { rating: number; comment: string },
): Promise<ReviewPage> {
  const order = await resolveReviewOrder(client, orderId)
  // Kunci per tenant: menjaga satu ulasan per struk & urutan rantai hash server-ulasan.
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1 || ':ulasan'))", [order.tenantId])
  if (await existingReview(client, order.tenantId, orderId)) {
    throw new PublicOrderError(409, 'Struk ini sudah diulas. Terima kasih!')
  }

  const rating = Math.round(input.rating)
  const comment = input.comment.trim().replace(/\s+/g, ' ').slice(0, 300)
  const { rows: head } = await client.query<{ seq: string | null; hash: string | null }>(
    `SELECT payload->>'deviceSeq' AS seq, payload->>'hash' AS hash FROM sync_entity_state
      WHERE tenant_id = $1 AND entity = 'auditLogs' AND payload->>'deviceId' = $2
      ORDER BY (payload->>'deviceSeq')::bigint DESC LIMIT 1`,
    [order.tenantId, REVIEW_DEVICE_ID],
  )
  const now = Date.now()
  const base = {
    id: randomUUID(),
    userId: REVIEW_DEVICE_ID,
    userName: 'Tamu (QR struk)',
    action: ACTION,
    entityType: 'feedback',
    entityId: orderId,
    details: `Penilaian tamu ★${rating}/5 untuk ${order.orderNumber}.${comment ? ` Komentar: ${comment}` : ''}`,
    createdAt: now,
    deviceId: REVIEW_DEVICE_ID,
    deviceSeq: head[0]?.seq ? Number(head[0].seq) + 1 : 1,
    prevHash: head[0]?.hash ?? null,
  }
  const entry = { ...base, hash: auditEntryHash(base) }
  await client.query(
    `INSERT INTO sync_entity_state (tenant_id, entity, entity_id, payload, entity_updated_at, server_seq, updated_at)
     VALUES ($1, 'auditLogs', $2, $3::jsonb, $4, nextval('sync_server_seq'), now())`,
    [order.tenantId, entry.id, JSON.stringify(entry), now],
  )

  return {
    business: await loadBusinessIdentity(client, order.tenantId),
    orderNumber: order.orderNumber,
    paidAt: order.paidAt,
    review: { rating, comment },
    googleReviewUrl: await googleReviewUrl(client, order.tenantId),
  }
}
