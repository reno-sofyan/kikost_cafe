import { closePool, getPool } from '../../src/db/pool.js'
import { migrateUp } from '../../src/db/migrate.js'

export const HAS_DB = Boolean(process.env.DATABASE_URL)

/** Jalankan migrasi sekali di awal suite integrasi. */
export async function setupDatabase(): Promise<void> {
  if (!HAS_DB) throw new Error('DATABASE_URL tidak diset untuk test integrasi')
  await migrateUp()
}

/** Kosongkan seluruh tabel sinkronisasi + reset sequence antar test. */
export async function resetDatabase(): Promise<void> {
  const pool = getPool()
  await pool.query(
    'TRUNCATE sync_entity_state, sync_idempotency, sync_push_log, sync_devices RESTART IDENTITY CASCADE',
  )
  await pool.query("SELECT setval('sync_server_seq', 1, false)")
}

export async function teardownDatabase(): Promise<void> {
  await closePool()
}

export async function insertDevice(label: string, keyHash: string): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    'INSERT INTO sync_devices (label, device_key_hash) VALUES ($1, $2) RETURNING id',
    [label, keyHash],
  )
  return rows[0].id
}
