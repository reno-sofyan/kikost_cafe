import { randomInt, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Pool } from 'pg'

/**
 * Kode pembatalan Pemilik yang dibuat dari konsol /ops — padanan server untuk
 * kode lokal di tablet (src/db/repositories/cancelCodes.ts). Satu kode aktif per
 * tenant; membuat kode baru menggantikan yang lama. Kode sekali pakai: pencocokan
 * yang berhasil menghanguskannya secara atomik (dua tablet tak bisa memakainya
 * bersamaan). Kode `permanent` ("selamanya") tetap berlaku setelah dipakai sampai
 * dihapus atau diganti; pemakaiannya dihitung.
 */

export const OWNER_CODE_LENGTH = 6
const MAX_FAILURES = 5
const LOCK_MS = 30_000

function hashCode(code: string, salt: string): string {
  return scryptSync(code, salt, 32).toString('hex')
}

export interface OwnerCodeStatus {
  active: {
    createdAt: number
    permanent: boolean
    /** Kode selamanya: berapa kali sudah dipakai & kapan terakhir. */
    useCount: number
    lastUsedAt: number | null
    deviceLabel: string | null
  } | null
  lastUsed: { createdAt: number; usedAt: number; deviceLabel: string | null } | null
}

export async function getOwnerCodeStatus(pool: Pool, tenantId: string): Promise<OwnerCodeStatus> {
  const { rows } = await pool.query<{
    created_at: Date
    used_at: Date | null
    permanent: boolean
    use_count: number
    last_used_at: Date | null
    label: string | null
  }>(
    `SELECT c.created_at, c.used_at, c.permanent, c.use_count, c.last_used_at, d.label
       FROM owner_cancel_codes c
       LEFT JOIN sync_devices d ON d.id::text = c.used_by_device
      WHERE c.tenant_id = $1`,
    [tenantId],
  )
  const row = rows[0]
  if (!row) return { active: null, lastUsed: null }
  if (!row.used_at) {
    return {
      active: {
        createdAt: row.created_at.getTime(),
        permanent: row.permanent,
        useCount: row.use_count,
        lastUsedAt: row.last_used_at?.getTime() ?? null,
        deviceLabel: row.last_used_at ? row.label : null,
      },
      lastUsed: null,
    }
  }
  return {
    active: null,
    lastUsed: { createdAt: row.created_at.getTime(), usedAt: row.used_at.getTime(), deviceLabel: row.label },
  }
}

/**
 * Membuat kode baru (menggantikan yang lama). Mengembalikan kode polos — tampilkan sekali saja.
 * `permanent` = berlaku selamanya (dipakai berulang) sampai dihapus atau diganti.
 */
export async function generateOwnerCode(
  pool: Pool,
  tenantId: string,
  opts: { permanent?: boolean } = {},
): Promise<{ code: string; createdAt: number; permanent: boolean }> {
  const code = randomInt(0, 10 ** OWNER_CODE_LENGTH).toString().padStart(OWNER_CODE_LENGTH, '0')
  const salt = randomBytes(16).toString('hex')
  const permanent = opts.permanent === true
  const { rows } = await pool.query<{ created_at: Date }>(
    `INSERT INTO owner_cancel_codes (tenant_id, code_hash, salt, created_at, used_at, used_by_device, permanent, use_count, last_used_at)
     VALUES ($1, $2, $3, now(), NULL, NULL, $4, 0, NULL)
     ON CONFLICT (tenant_id) DO UPDATE
       SET code_hash = EXCLUDED.code_hash, salt = EXCLUDED.salt, created_at = now(), used_at = NULL, used_by_device = NULL,
           permanent = EXCLUDED.permanent, use_count = 0, last_used_at = NULL
     RETURNING created_at`,
    [tenantId, hashCode(code, salt), salt, permanent],
  )
  failures.delete(tenantId)
  return { code, createdAt: rows[0].created_at.getTime(), permanent }
}

export async function revokeOwnerCode(pool: Pool, tenantId: string): Promise<void> {
  await pool.query('DELETE FROM owner_cancel_codes WHERE tenant_id = $1 AND used_at IS NULL', [tenantId])
}

export type ConsumeOwnerCodeResult =
  | { ok: true; createdAt: number; permanent: boolean }
  | { ok: false; reason: 'no_code' | 'invalid' }
  | { ok: false; reason: 'locked'; retryInMs: number }

/** Percobaan salah per tenant (in-memory, satu instance): 5× salah → kunci 30 detik. */
const failures = new Map<string, { count: number; lockedUntil: number }>()

/** Hanya untuk pengujian. */
export function _resetOwnerCodeThrottle(): void {
  failures.clear()
}

/** Mencocokkan & (bila cocok) menghanguskan kode aktif tenant ini dalam satu transaksi. */
export async function consumeOwnerCode(
  pool: Pool,
  tenantId: string,
  code: string,
  deviceId: string | null,
): Promise<ConsumeOwnerCodeResult> {
  const now = Date.now()
  const entry = failures.get(tenantId)
  if (entry && entry.lockedUntil > now) return { ok: false, reason: 'locked', retryInMs: entry.lockedUntil - now }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{ code_hash: string; salt: string; created_at: Date; permanent: boolean }>(
      `SELECT code_hash, salt, created_at, permanent FROM owner_cancel_codes
        WHERE tenant_id = $1 AND used_at IS NULL FOR UPDATE`,
      [tenantId],
    )
    const row = rows[0]
    if (!row) {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'no_code' }
    }
    const expected = Buffer.from(row.code_hash, 'hex')
    const actual = Buffer.from(hashCode(code, row.salt), 'hex')
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      await client.query('ROLLBACK')
      const e = failures.get(tenantId) ?? { count: 0, lockedUntil: 0 }
      e.count += 1
      if (e.count >= MAX_FAILURES) {
        e.count = 0
        e.lockedUntil = now + LOCK_MS
      }
      failures.set(tenantId, e)
      return { ok: false, reason: 'invalid' }
    }
    // Sekali pakai → hangus; selamanya → tetap aktif, pemakaiannya dicatat.
    await client.query(
      row.permanent
        ? 'UPDATE owner_cancel_codes SET use_count = use_count + 1, last_used_at = now(), used_by_device = $2 WHERE tenant_id = $1'
        : 'UPDATE owner_cancel_codes SET used_at = now(), last_used_at = now(), use_count = use_count + 1, used_by_device = $2 WHERE tenant_id = $1',
      [tenantId, deviceId],
    )
    await client.query('COMMIT')
    failures.delete(tenantId)
    return { ok: true, createdAt: row.created_at.getTime(), permanent: row.permanent }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
