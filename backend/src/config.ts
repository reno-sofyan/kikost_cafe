import { z } from 'zod'

/**
 * Semua konfigurasi berasal dari environment variable (12-factor).
 * Tidak ada nilai secret yang di-hardcode. Lihat backend/.env.example.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(8080),

  // PostgreSQL
  DATABASE_URL: z.string().min(1, 'DATABASE_URL wajib diisi'),
  PGPOOL_MAX: z.coerce.number().int().positive().default(10),
  PGPOOL_IDLE_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(30_000),
  PGPOOL_CONNECTION_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(10_000),

  // Autentikasi perangkat untuk sinkronisasi.
  // Daftar kunci perangkat yang sah, dipisahkan koma. Minimal satu untuk produksi.
  SYNC_DEVICE_KEYS: z.string().default(''),

  // CORS: daftar origin yang diizinkan, dipisahkan koma. Kosong = tolak semua origin lintas situs.
  CORS_ORIGINS: z.string().default(''),

  // Rate limit global (permintaan per menit per IP).
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(240),

  // Ukuran batch push maksimum yang diterima server.
  SYNC_MAX_BATCH: z.coerce.number().int().positive().default(200),
  // Jumlah baris maksimum yang dikembalikan per entitas saat pull.
  SYNC_PULL_LIMIT: z.coerce.number().int().positive().default(500),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // Aktifkan endpoint backup snapshot (JSON penuh state server). Default nonaktif.
  ENABLE_BACKUP_ENDPOINT: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
})

export type AppConfig = z.infer<typeof schema> & {
  deviceKeys: string[]
  corsOrigins: string[]
}

let cached: AppConfig | null = null

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached
  const parsed = schema.parse(env)
  const deviceKeys = parsed.SYNC_DEVICE_KEYS.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const corsOrigins = parsed.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (parsed.NODE_ENV === 'production' && deviceKeys.length === 0) {
    throw new Error('SYNC_DEVICE_KEYS wajib diisi minimal satu kunci pada mode production.')
  }

  cached = { ...parsed, deviceKeys, corsOrigins }
  return cached
}

/** Hanya untuk pengujian: reset cache konfigurasi. */
export function resetConfigCache(): void {
  cached = null
}
