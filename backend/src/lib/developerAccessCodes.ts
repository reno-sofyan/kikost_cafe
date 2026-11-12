import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Pool } from 'pg'

/**
 * Token Mode Developer (4 angka, sekali pakai) yang dibuat dari konsol /ops dan
 * dicocokkan tablet lewat /api/sync/developer-code/consume. Karena hanya 4 angka
 * (10.000 kemungkinan), token: berlaku singkat (`DEVELOPER_CODE_TTL_MS`), hangus begitu
 * dipakai, dan HANGUS juga setelah `MAX_FAILURES` kali salah — tebakan beruntun tak
 * bisa menghabiskan ruang kode. Membuat token baru menggantikan yang lama.
 */

export const DEVELOPER_CODE_LENGTH = 4
export const DEVELOPER_CODE_TTL_MS = 10 * 60_000
export const DEVELOPER_CODE_MAX_FAILURES = 5

const hashCode = (code: string, salt: string): string => scryptSync(code, salt, 32).toString('hex')

export interface DeveloperCodeStatus {
  active: { createdAt: number; expiresAt: number; failedCount: number } | null
  last: { createdAt: number; closedAt: number | null; reason: string; deviceLabel: string | null } | null
}

export async function getDeveloperCodeStatus(pool: Pool, tenantId: string): Promise<DeveloperCodeStatus> {
  const { rows } = await pool.query<{
    created_at: Date
    expires_at: Date
    failed_count: number
    used_at: Date | null
    closed_reason: string | null
    label: string | null
  }>(
    `SELECT c.created_at, c.expires_at, c.failed_count, c.used_at, c.closed_reason, d.label
       FROM developer_access_codes c
       LEFT JOIN sync_devices d ON d.id::text = c.used_by_device
      WHERE c.tenant_id = $1`,
    [tenantId],
  )
  const row = rows[0]
  if (!row) return { active: null, last: null }
  const expired = row.expires_at.getTime() <= Date.now()
  if (!row.closed_reason && !expired) {
    return { active: { createdAt: row.created_at.getTime(), expiresAt: row.expires_at.getTime(), failedCount: row.failed_count }, last: null }
  }
  return {
    active: null,
    last: {
      createdAt: row.created_at.getTime(),
      closedAt: row.used_at?.getTime() ?? (expired && !row.closed_reason ? row.expires_at.getTime() : null),
      reason: row.closed_reason ?? 'expired',
      deviceLabel: row.label,
    },
  }
}

/** Token baru (menggantikan yang lama). Mengembalikan token polos — tampilkan sekali saja. */
export async function generateDeveloperCode(pool: Pool, tenantId: string): Promise<{ code: string; createdAt: number; expiresAt: number }> {
  const code = randomInt(0, 10 ** DEVELOPER_CODE_LENGTH).toString().padStart(DEVELOPER_CODE_LENGTH, '0')
  const salt = randomBytes(16).toString('hex')
  const { rows } = await pool.query<{ created_at: Date; expires_at: Date }>(
    `INSERT INTO developer_access_codes (tenant_id, code_hash, salt, created_at, expires_at, failed_count, used_at, used_by_device, closed_reason)
     VALUES ($1, $2, $3, now(), now() + ($4 || ' milliseconds')::interval, 0, NULL, NULL, NULL)
     ON CONFLICT (tenant_id) DO UPDATE
       SET code_hash = EXCLUDED.code_hash, salt = EXCLUDED.salt, created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at,
           failed_count = 0, used_at = NULL, used_by_device = NULL, closed_reason = NULL
     RETURNING created_at, expires_at`,
    [tenantId, hashCode(code, salt), salt, String(DEVELOPER_CODE_TTL_MS)],
  )
  return { code, createdAt: rows[0].created_at.getTime(), expiresAt: rows[0].expires_at.getTime() }
}

export async function revokeDeveloperCode(pool: Pool, tenantId: string): Promise<void> {
  await pool.query(`UPDATE developer_access_codes SET closed_reason = 'revoked' WHERE tenant_id = $1 AND closed_reason IS NULL`, [tenantId])
}

export type ConsumeDeveloperCodeResult =
  | { ok: true; createdAt: number }
  | { ok: false; reason: 'no_code' | 'expired' | 'burned' }
  | { ok: false; reason: 'invalid'; attemptsLeft: number }

/** Mencocokkan & (bila cocok) menghanguskan token aktif tenant ini dalam satu transaksi. */
export async function consumeDeveloperCode(pool: Pool, tenantId: string, code: string, deviceId: string | null): Promise<ConsumeDeveloperCodeResult> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{ code_hash: string; salt: string; created_at: Date; expires_at: Date; failed_count: number }>(
      `SELECT code_hash, salt, created_at, expires_at, failed_count FROM developer_access_codes
        WHERE tenant_id = $1 AND closed_reason IS NULL FOR UPDATE`,
      [tenantId],
    )
    const row = rows[0]
    if (!row) {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'no_code' }
    }
    if (row.expires_at.getTime() <= Date.now()) {
      await client.query(`UPDATE developer_access_codes SET closed_reason = 'expired' WHERE tenant_id = $1`, [tenantId])
      await client.query('COMMIT')
      return { ok: false, reason: 'expired' }
    }
    const expected = Buffer.from(row.code_hash, 'hex')
    const actual = Buffer.from(hashCode(code, row.salt), 'hex')
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      const failed = row.failed_count + 1
      const burned = failed >= DEVELOPER_CODE_MAX_FAILURES
      await client.query(`UPDATE developer_access_codes SET failed_count = $2, closed_reason = $3 WHERE tenant_id = $1`, [
        tenantId,
        failed,
        burned ? 'burned' : null,
      ])
      await client.query('COMMIT')
      return burned ? { ok: false, reason: 'burned' } : { ok: false, reason: 'invalid', attemptsLeft: DEVELOPER_CODE_MAX_FAILURES - failed }
    }
    await client.query(`UPDATE developer_access_codes SET used_at = now(), used_by_device = $2, closed_reason = 'used' WHERE tenant_id = $1`, [tenantId, deviceId])
    await client.query('COMMIT')
    return { ok: true, createdAt: row.created_at.getTime() }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
