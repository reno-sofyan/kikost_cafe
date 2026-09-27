import { createHash, timingSafeEqual } from 'node:crypto'
import type { PoolClient } from 'pg'
import { getPool } from '../db/pool.js'
import { loadConfig } from '../config.js'

export function hashDeviceKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex')
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

export interface AuthenticatedDevice {
  deviceId: string | null
  source: 'env' | 'db'
  tenantId: string
}

/**
 * Memvalidasi kunci perangkat dari header Authorization.
 * Menerima kunci yang tercantum di env `SYNC_DEVICE_KEYS` (untuk bootstrap outlet tunggal)
 * atau yang terdaftar di tabel `sync_devices` dan belum dicabut.
 * Mengembalikan null bila kunci tidak sah.
 */
export async function authenticateDeviceKey(rawKey: string): Promise<AuthenticatedDevice | null> {
  const key = rawKey.trim()
  if (!key) return null
  const config = loadConfig()
  const incomingHash = hashDeviceKey(key)

  for (const envKey of config.deviceKeys) {
    if (safeEqualHex(hashDeviceKey(envKey.key), incomingHash)) {
      return { deviceId: null, source: 'env', tenantId: envKey.tenantId }
    }
  }

  const { rows } = await getPool().query<{ id: string; tenant_id: string }>(
    'SELECT id, tenant_id FROM sync_devices WHERE device_key_hash = $1 AND revoked = FALSE LIMIT 1',
    [incomingHash],
  )
  if (rows.length === 0) return null
  return { deviceId: rows[0].id, source: 'db', tenantId: rows[0].tenant_id }
}

export async function touchDeviceLastSeen(client: PoolClient, deviceId: string | null): Promise<void> {
  if (!deviceId) return
  await client.query('UPDATE sync_devices SET last_seen_at = now() WHERE id = $1', [deviceId])
}
