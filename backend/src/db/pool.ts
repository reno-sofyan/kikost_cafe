import pg from 'pg'
import { loadConfig } from '../config.js'

// `pg` adalah paket CommonJS. Interop ESM di sebagian bundler / test runner
// menempatkan `module.exports` di properti `default` alih-alih langsung —
// `const { Pool } = pg` lalu melempar "Cannot destructure ... undefined" saat
// modul di-load. Buka lapisan `.default` bila ada.
const pgLib = ((pg as unknown as { default?: typeof pg }).default ?? pg) as typeof pg
const { Pool } = pgLib

let pool: pg.Pool | null = null

export function getPool(): pg.Pool {
  if (pool) return pool
  const config = loadConfig()
  pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: config.PGPOOL_MAX,
    idleTimeoutMillis: config.PGPOOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: config.PGPOOL_CONNECTION_TIMEOUT_MS,
    application_name: 'cafe-pos-api',
  })
  pool.on('error', (err) => {
    // Koneksi idle yang error tidak boleh menjatuhkan proses.
    console.error({ err: err.message }, 'idle postgres client error')
  })
  return pool
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

/** Menjalankan fungsi di dalam satu transaksi; rollback otomatis bila melempar error. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* abaikan error rollback */
    }
    throw err
  } finally {
    client.release()
  }
}
