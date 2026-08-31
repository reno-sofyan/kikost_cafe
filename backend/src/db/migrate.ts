import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PoolClient } from 'pg'
import { closePool, getPool, withTransaction } from './pool.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Cari folder `migrations` dengan menaiki direktori dari lokasi file ini. */
function resolveMigrationsDir(): string {
  const candidates = [
    join(__dirname, '..', '..', 'migrations'), // dev: src/db -> backend/migrations
    join(__dirname, '..', '..', '..', 'migrations'), // build: dist/src/db -> backend/migrations
    join(process.cwd(), 'migrations'),
  ]
  for (const dir of candidates) {
    if (existsSync(dir)) return dir
  }
  return candidates[0]
}

const MIGRATIONS_DIR = resolveMigrationsDir()

const DOWN_MARKER = '-- +migrate Down'
const UP_MARKER = '-- +migrate Up'

interface Migration {
  id: string
  up: string
  down: string
}

async function loadMigrations(): Promise<Migration[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
  const migrations: Migration[] = []
  for (const file of files) {
    const raw = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
    const downIdx = raw.indexOf(DOWN_MARKER)
    const upSection = downIdx >= 0 ? raw.slice(0, downIdx) : raw
    const downSection = downIdx >= 0 ? raw.slice(downIdx + DOWN_MARKER.length) : ''
    migrations.push({
      id: file.replace(/\.sql$/, ''),
      up: upSection.replace(UP_MARKER, '').trim(),
      down: downSection.trim(),
    })
  }
  return migrations
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
}

async function appliedIds(client: PoolClient): Promise<Set<string>> {
  const { rows } = await client.query<{ id: string }>('SELECT id FROM schema_migrations ORDER BY id')
  return new Set(rows.map((r) => r.id))
}

export async function migrateUp(): Promise<string[]> {
  const migrations = await loadMigrations()
  const applied: string[] = []
  await withTransaction(async (client) => {
    // Kunci tingkat sesi supaya dua deploy paralel tidak menjalankan migrasi bersamaan.
    await client.query('SELECT pg_advisory_xact_lock(4021741)')
    await ensureMigrationsTable(client)
    const done = await appliedIds(client)
    for (const migration of migrations) {
      if (done.has(migration.id)) continue
      if (!migration.up) throw new Error(`Migrasi ${migration.id} tidak memiliki bagian Up`)
      await client.query(migration.up)
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id])
      applied.push(migration.id)
    }
  })
  return applied
}

export async function migrateDown(steps = 1): Promise<string[]> {
  const migrations = await loadMigrations()
  const rolledBack: string[] = []
  await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(4021741)')
    await ensureMigrationsTable(client)
    const done = [...(await appliedIds(client))].sort().reverse()
    const target = done.slice(0, steps)
    for (const id of target) {
      const migration = migrations.find((m) => m.id === id)
      if (!migration) throw new Error(`File migrasi untuk ${id} tidak ditemukan; tidak bisa rollback`)
      if (!migration.down) throw new Error(`Migrasi ${id} tidak memiliki bagian Down; rollback dibatalkan`)
      await client.query(migration.down)
      await client.query('DELETE FROM schema_migrations WHERE id = $1', [id])
      rolledBack.push(id)
    }
  })
  return rolledBack
}

export async function migrationStatus(): Promise<{ id: string; applied: boolean }[]> {
  const migrations = await loadMigrations()
  const client = await getPool().connect()
  try {
    await ensureMigrationsTable(client)
    const done = await appliedIds(client)
    return migrations.map((m) => ({ id: m.id, applied: done.has(m.id) }))
  } finally {
    client.release()
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'up'
  try {
    if (cmd === 'up') {
      const applied = await migrateUp()
      console.log(applied.length ? `Migrasi diterapkan: ${applied.join(', ')}` : 'Tidak ada migrasi baru.')
    } else if (cmd === 'down') {
      const steps = Number.parseInt(process.argv[3] ?? '1', 10)
      const rolledBack = await migrateDown(steps)
      console.log(rolledBack.length ? `Rollback: ${rolledBack.join(', ')}` : 'Tidak ada migrasi untuk di-rollback.')
    } else if (cmd === 'status') {
      const status = await migrationStatus()
      for (const s of status) console.log(`${s.applied ? '[x]' : '[ ]'} ${s.id}`)
    } else {
      console.error(`Perintah tidak dikenal: ${cmd}. Gunakan: up | down [n] | status`)
      process.exitCode = 1
    }
  } catch (err) {
    console.error('Migrasi gagal:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  } finally {
    await closePool()
  }
}

// Jalankan hanya bila dieksekusi langsung (bukan saat di-import).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main()
}
