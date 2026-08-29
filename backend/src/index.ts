import { loadConfig } from './config.js'
import { closePool } from './db/pool.js'
import { migrateUp } from './db/migrate.js'
import { buildServer } from './server.js'

async function main(): Promise<void> {
  const config = loadConfig()

  // Migrasi otomatis yang aman: memakai advisory lock, hanya menambah, tidak destruktif.
  if (process.env.RUN_MIGRATIONS_ON_BOOT !== 'false') {
    const applied = await migrateUp()
    console.log(applied.length ? `Migrasi saat boot: ${applied.join(', ')}` : 'Skema database sudah mutakhir.')
  }

  const app = await buildServer()

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'mematikan server dengan rapi')
    try {
      await app.close()
      await closePool()
      process.exit(0)
    } catch (err) {
      app.log.error({ err }, 'gagal shutdown rapi')
      process.exit(1)
    }
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  await app.listen({ host: config.HOST, port: config.PORT })
}

main().catch((err) => {
  console.error('Server gagal start:', err instanceof Error ? err.stack : err)
  process.exit(1)
})
