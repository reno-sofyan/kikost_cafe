import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { z } from 'zod'
import { loadConfig } from './config.js'
import { getPool } from './db/pool.js'
import { authenticateDeviceKey } from './lib/deviceAuth.js'
import { processPull, processPush, type PushItem } from './lib/syncService.js'
import { registerPublicRoutes } from './routes/public.js'

declare module 'fastify' {
  interface FastifyRequest {
    deviceId: string | null
  }
}

const pushBodySchema = z.object({
  deviceId: z.string().min(1).max(200),
  items: z
    .array(
      z.object({
        entity: z.string().min(1).max(64),
        entityId: z.string().min(1).max(200),
        idempotencyKey: z.string().min(1).max(64),
        payload: z.unknown(),
      }),
    )
    .max(1000),
})

const pullQuerySchema = z.object({
  since: z.coerce.number().int().nonnegative().default(0),
})

function extractBearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1] : null
}

export async function buildServer(): Promise<FastifyInstance> {
  const config = loadConfig()

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // Jangan pernah menulis header Authorization / payload sensitif ke log.
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie'],
        remove: true,
      },
      transport:
        config.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
          : undefined,
    },
    trustProxy: true,
    bodyLimit: 8 * 1024 * 1024, // 8 MiB — cukup untuk batch besar termasuk foto produk data-url.
    disableRequestLogging: false,
    requestIdHeader: 'x-request-id',
  })

  app.decorateRequest('deviceId', null)

  await app.register(helmet, {
    contentSecurityPolicy: false, // API JSON murni; CSP diterapkan di reverse proxy untuk web.
    crossOriginResourcePolicy: { policy: 'same-site' },
  })

  await app.register(cors, {
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    maxAge: 86_400,
  })

  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    allowList: (req) => req.url === '/api/health',
  })

  // ---- Health (tanpa auth) ----
  app.get('/api/health', async (request, reply) => {
    try {
      const started = Date.now()
      await getPool().query('SELECT 1')
      return { status: 'ok', db: 'ok', latencyMs: Date.now() - started, time: new Date().toISOString() }
    } catch (err) {
      // Endpoint publik tanpa auth: jangan bocorkan detail internal (versi PG, host, dsb).
      request.log.error({ err: err instanceof Error ? err.message : err }, 'health: koneksi DB gagal')
      reply.code(503)
      return { status: 'degraded', db: 'error' }
    }
  })

  app.get('/api/health/live', async () => ({ status: 'ok' }))

  // ---- Rute publik pemesanan mandiri via QR (tanpa device key) ----
  await registerPublicRoutes(app)

  // ---- Auth hook untuk seluruh rute /api/sync ----
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/sync')) return
    const key = extractBearer(request)
    if (!key) {
      reply.code(401)
      throw new Error('Header Authorization Bearer wajib diisi')
    }
    const device = await authenticateDeviceKey(key)
    if (!device) {
      request.log.warn({ ip: request.ip }, 'device key ditolak')
      reply.code(401)
      throw new Error('Kunci perangkat tidak sah')
    }
    request.deviceId = device.deviceId
  })

  // ---- Sync push ----
  app.post('/api/sync/push', async (request, reply) => {
    const parsed = pushBodySchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'Body tidak valid', issues: parsed.error.issues }
    }
    const items: PushItem[] = parsed.data.items
    try {
      const result = await processPush({ deviceId: request.deviceId, items })
      return result
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode ?? 500
      reply.code(statusCode)
      request.log.error({ err: err instanceof Error ? err.message : err }, 'push gagal')
      return { error: err instanceof Error ? err.message : 'Kesalahan server' }
    }
  })

  // ---- Sync pull ----
  app.get('/api/sync/pull', async (request, reply) => {
    const parsed = pullQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'Query tidak valid', issues: parsed.error.issues }
    }
    try {
      return await processPull(parsed.data.since)
    } catch (err) {
      reply.code(500)
      request.log.error({ err: err instanceof Error ? err.message : err }, 'pull gagal')
      return { error: err instanceof Error ? err.message : 'Kesalahan server' }
    }
  })

  return app
}
