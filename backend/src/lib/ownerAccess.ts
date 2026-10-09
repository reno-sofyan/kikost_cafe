import { createHash, randomBytes } from 'node:crypto'
import type { Pool } from 'pg'

/**
 * Token akses konsol Pemilik (/owner). Dibuat developer di /ops untuk satu tenant,
 * diberikan ke pemilik usaha sebagai tautan `…/owner#k=<token>`. Token polos hanya
 * ada di respons pembuatan; server menyimpan hash SHA-256-nya saja.
 */

const TOKEN_PREFIX = 'kio_'
const LABEL_MAX = 60
/** `last_used_at` cukup diperbarui sesekali — jangan menulis ke DB tiap request. */
const TOUCH_INTERVAL_MS = 5 * 60_000

const hashToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex')

export interface OwnerAccessRow {
  id: string
  label: string
  createdAt: number
  lastUsedAt: number | null
}

export async function createOwnerAccess(
  pool: Pool,
  tenantId: string,
  label: string,
): Promise<OwnerAccessRow & { token: string }> {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url')
  const clean = label.trim().slice(0, LABEL_MAX) || 'Pemilik'
  const { rows } = await pool.query<{ id: string; created_at: Date }>(
    `INSERT INTO owner_access_tokens (tenant_id, token_hash, label) VALUES ($1, $2, $3)
     RETURNING id, created_at`,
    [tenantId, hashToken(token), clean],
  )
  return { id: rows[0].id, label: clean, createdAt: rows[0].created_at.getTime(), lastUsedAt: null, token }
}

/** Token yang masih aktif (belum dicabut) untuk satu tenant, terbaru dulu. */
export async function listOwnerAccess(pool: Pool, tenantId: string): Promise<OwnerAccessRow[]> {
  const { rows } = await pool.query<{ id: string; label: string; created_at: Date; last_used_at: Date | null }>(
    `SELECT id, label, created_at, last_used_at FROM owner_access_tokens
      WHERE tenant_id = $1 AND revoked_at IS NULL
      ORDER BY created_at DESC`,
    [tenantId],
  )
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    createdAt: r.created_at.getTime(),
    lastUsedAt: r.last_used_at ? r.last_used_at.getTime() : null,
  }))
}

/** Mencabut satu token milik tenant ini. `false` bila tidak ada / sudah dicabut. */
export async function revokeOwnerAccess(pool: Pool, tenantId: string, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE owner_access_tokens SET revoked_at = now()
      WHERE tenant_id = $1 AND id::text = $2 AND revoked_at IS NULL`,
    [tenantId, id],
  )
  return (rowCount ?? 0) > 0
}

/** Token → tenant. `null` bila tak dikenal atau sudah dicabut. */
export async function authenticateOwnerToken(
  pool: Pool,
  token: string,
): Promise<{ id: string; tenantId: string; label: string } | null> {
  if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) return null
  const { rows } = await pool.query<{ id: string; tenant_id: string; label: string; last_used_at: Date | null }>(
    `SELECT id, tenant_id, label, last_used_at FROM owner_access_tokens
      WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(token)],
  )
  const row = rows[0]
  if (!row) return null
  if (!row.last_used_at || Date.now() - row.last_used_at.getTime() > TOUCH_INTERVAL_MS) {
    await pool.query('UPDATE owner_access_tokens SET last_used_at = now() WHERE id = $1', [row.id])
  }
  return { id: row.id, tenantId: row.tenant_id, label: row.label }
}
