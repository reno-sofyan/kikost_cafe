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

  // Secret HMAC-SHA256 untuk memverifikasi webhook pembayaran online generik (QRIS/gateway).
  // Kosong = endpoint webhook nonaktif (503).
  PAYMENT_WEBHOOK_SECRET: z.string().default(''),

  // Midtrans (pembayaran QRIS online dari halaman pesan-mandiri /order/:token).
  // Kosong = endpoint /pay & notifikasi Midtrans nonaktif (503).
  MIDTRANS_SERVER_KEY: z.string().default(''),
  MIDTRANS_CLIENT_KEY: z.string().default(''),
  MIDTRANS_MERCHANT_ID: z.string().default(''),
  MIDTRANS_IS_PRODUCTION: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  // Aktifkan endpoint backup snapshot (JSON penuh state server). Default nonaktif.
  ENABLE_BACKUP_ENDPOINT: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  // Token konsol operator (dashboard /ops lintas-tenant untuk pemilik backend).
  // Kosong = seluruh rute /ops dimatikan & mengembalikan 404. Wajib panjang & acak:
  //   openssl rand -hex 32
  OPS_TOKEN: z.string().default(''),
})

export type AppConfig = z.infer<typeof schema> & {
  deviceKeys: DeviceKeyConfig[]
  corsOrigins: string[]
}

export interface DeviceKeyConfig {
  key: string
  tenantId: string
}

const TENANT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

function parseDeviceKeys(raw: string): DeviceKeyConfig[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(':')
      if (separator === -1) return { key: entry, tenantId: 'default' }

      const tenantId = entry.slice(0, separator).trim().toLowerCase()
      const key = entry.slice(separator + 1).trim()
      if (!TENANT_ID_RE.test(tenantId) || !key) {
        throw new Error('SYNC_DEVICE_KEYS harus berbentuk tenant:kunci, dengan tenant huruf kecil, angka, _ atau -.')
      }
      return { key, tenantId }
    })
}

let cached: AppConfig | null = null

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached
  const parsed = schema.parse(env)
  const deviceKeys = parseDeviceKeys(parsed.SYNC_DEVICE_KEYS)
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
