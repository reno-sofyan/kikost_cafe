import { createHash, randomBytes, randomInt } from 'node:crypto'
import type { Pool } from 'pg'
import { hashDeviceKey } from './deviceAuth.js'

/**
 * Kode pasang tablet baru. Dipakai tablet yang BELUM punya kunci perangkat, jadi rute
 * penukarannya publik (tanpa tenant) — kodenya dibuat panjang (8 karakter dari 31 huruf
 * & angka yang tak mudah tertukar ≈ 8,5×10¹¹ kemungkinan), berlaku singkat, sekali pakai,
 * dan rutenya dibatasi per IP (authThrottle). Penukaran yang berhasil membuat kunci
 * perangkat BARU (acak 32 byte) yang terdaftar di sync_devices untuk tenant itu.
 */
export const PAIRING_TTL_MS = 30 * 60_000
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
/** Kode yang sudah dinormalisasi (`normalizePairingCode`): 8 karakter dari ALPHABET. */
export const PAIRING_CODE_RE = /^[A-HJ-KM-NP-Z2-9]{8}$/

/** Normalisasi masukan pengguna: huruf besar, tanpa spasi/tanda hubung. */
export const normalizePairingCode = (raw: string): string => raw.toUpperCase().replace(/[\s-]/g, '')
const hashCode = (normalized: string): string => createHash('sha256').update(`pair:${normalized}`, 'utf8').digest('hex')

export interface PairingStatus {
  active: { createdAt: number; expiresAt: number } | null
  last: { createdAt: number; reason: string; usedAt: number | null } | null
}

export async function getPairingStatus(pool: Pool, tenantId: string): Promise<PairingStatus> {
  const { rows } = await pool.query<{ created_at: Date; expires_at: Date; used_at: Date | null; closed_reason: string | null }>(
    'SELECT created_at, expires_at, used_at, closed_reason FROM device_pairing_codes WHERE tenant_id = $1',
    [tenantId],
  )
  const r = rows[0]
  if (!r) return { active: null, last: null }
  const expired = r.expires_at.getTime() <= Date.now()
  if (!r.closed_reason && !expired) return { active: { createdAt: r.created_at.getTime(), expiresAt: r.expires_at.getTime() }, last: null }
  return { active: null, last: { createdAt: r.created_at.getTime(), reason: r.closed_reason ?? 'expired', usedAt: r.used_at?.getTime() ?? null } }
}

/** Kode baru (menggantikan yang lama). Dikembalikan berformat "XXXX-XXXX" — tampilkan sekali saja. */
export async function generatePairingCode(pool: Pool, tenantId: string): Promise<{ code: string; createdAt: number; expiresAt: number }> {
  const raw = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
  const { rows } = await pool.query<{ created_at: Date; expires_at: Date }>(
    `INSERT INTO device_pairing_codes (tenant_id, code_hash, created_at, expires_at, used_at, used_device_id, closed_reason)
     VALUES ($1, $2, now(), now() + ($3 || ' milliseconds')::interval, NULL, NULL, NULL)
     ON CONFLICT (tenant_id) DO UPDATE
       SET code_hash = EXCLUDED.code_hash, created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at,
           used_at = NULL, used_device_id = NULL, closed_reason = NULL
     RETURNING created_at, expires_at`,
    [tenantId, hashCode(raw), String(PAIRING_TTL_MS)],
  )
  return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, createdAt: rows[0].created_at.getTime(), expiresAt: rows[0].expires_at.getTime() }
}

export async function revokePairingCode(pool: Pool, tenantId: string): Promise<void> {
  await pool.query(`UPDATE device_pairing_codes SET closed_reason = 'revoked' WHERE tenant_id = $1 AND closed_reason IS NULL`, [tenantId])
}

export type RedeemPairingResult = { ok: true; tenantId: string; deviceKey: string; deviceId: string } | { ok: false; reason: 'invalid' | 'expired' }

/** Menukar kode → kunci perangkat baru untuk tenant pemilik kode (atomik, sekali pakai). */
export async function redeemPairingCode(pool: Pool, rawCode: string, label: string): Promise<RedeemPairingResult> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{ tenant_id: string; expires_at: Date }>(
      'SELECT tenant_id, expires_at FROM device_pairing_codes WHERE code_hash = $1 AND closed_reason IS NULL FOR UPDATE',
      [hashCode(normalizePairingCode(rawCode))],
    )
    const row = rows[0]
    if (!row) {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'invalid' }
    }
    if (row.expires_at.getTime() <= Date.now()) {
      await client.query(`UPDATE device_pairing_codes SET closed_reason = 'expired' WHERE tenant_id = $1`, [row.tenant_id])
      await client.query('COMMIT')
      return { ok: false, reason: 'expired' }
    }
    const deviceKey = randomBytes(32).toString('hex')
    const device = await client.query<{ id: string }>('INSERT INTO sync_devices (label, device_key_hash, tenant_id) VALUES ($1, $2, $3) RETURNING id', [
      label,
      hashDeviceKey(deviceKey),
      row.tenant_id,
    ])
    await client.query(`UPDATE device_pairing_codes SET used_at = now(), used_device_id = $2, closed_reason = 'used' WHERE tenant_id = $1`, [
      row.tenant_id,
      device.rows[0].id,
    ])
    await client.query('COMMIT')
    return { ok: true, tenantId: row.tenant_id, deviceKey, deviceId: device.rows[0].id }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}
