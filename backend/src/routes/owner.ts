import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getPool } from '../db/pool.js'
import { isAuthBlocked, recordAuthFailure, recordAuthSuccess } from '../lib/authThrottle.js'
import { authenticateOwnerToken } from '../lib/ownerAccess.js'
import { generateOwnerCode, getOwnerCodeStatus, revokeOwnerCode } from '../lib/ownerCancelCodes.js'
import { buildTenantExport, loadCancellationReport, loadTenantDetail, loadTenantOverview, num } from '../lib/tenantReports.js'
import { OWNER_DASHBOARD_HTML } from './ownerDashboard.js'

/**
 * Konsol Pemilik usaha di `/owner` — padanan /ops untuk SATU tenant. Pemilik masuk
 * lewat tautan bertoken yang dibuat developer di /ops (`/owner#k=<token>`); token
 * menentukan tenant, jadi tak ada parameter tenant di URL yang bisa diganti-ganti.
 *
 * Isi: omzet & transaksi, log aktivitas, rekap pembatalan, export PDF, dan membuat
 * kode pembatalan Pemilik sendiri (tanpa menghubungi developer).
 */

declare module 'fastify' {
  interface FastifyRequest {
    ownerTenantId: string
  }
}

function extractBearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1].trim() : null
}

export async function registerOwnerRoutes(app: FastifyInstance): Promise<void> {
  app.decorateRequest('ownerTenantId', '')

  // Shell `/owner` boleh dimuat tanpa token (tidak memuat data); `/owner/api/*` wajib token.
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.url.startsWith('/owner/api')) return
    if (isAuthBlocked(request.ip)) {
      reply.code(429)
      throw new Error('Terlalu banyak percobaan gagal. Coba lagi nanti.')
    }
    const token = extractBearer(request)
    const access = token ? await authenticateOwnerToken(getPool(), token) : null
    if (!access) {
      recordAuthFailure(request.ip)
      request.log.warn({ ip: request.ip }, 'owner: token ditolak')
      reply.code(401)
      throw new Error('Tautan akses tidak sah atau sudah dicabut')
    }
    recordAuthSuccess(request.ip)
    request.ownerTenantId = access.tenantId
  })

  app.get('/', async (_request, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8')
    reply.header('cache-control', 'no-store')
    reply.header('x-robots-tag', 'noindex, nofollow')
    // Token ada di fragmen URL; jangan sampai bocor lewat Referer ke tautan keluar.
    reply.header('referrer-policy', 'no-referrer')
    return OWNER_DASHBOARD_HTML
  })

  app.get('/api/overview', async (request) => loadTenantOverview(getPool(), request.ownerTenantId))

  app.get('/api/detail', async (request) => loadTenantDetail(getPool(), request.ownerTenantId))

  app.get<{ Querystring: { days?: string } }>('/api/cancellations', async (request) => {
    const tenantId = request.ownerTenantId
    const days = Math.min(90, Math.max(1, Math.trunc(num(request.query.days) || 30)))
    const now = Date.now()
    const report = await loadCancellationReport(getPool(), tenantId, now - days * 86_400_000, now + 86_400_000, days)
    return { tenantId, ...report }
  })

  app.get<{ Params: { kind: string }; Querystring: { from?: string; to?: string } }>(
    '/api/export/:kind',
    async (request, reply) => {
      const result = await buildTenantExport(
        getPool(),
        request.ownerTenantId,
        request.params.kind,
        request.query.from,
        request.query.to,
      )
      if (!result.ok) {
        reply.code(result.status)
        return { error: result.error }
      }
      reply.header('content-type', 'application/pdf')
      reply.header('content-disposition', `attachment; filename="${result.filename}"`)
      reply.header('cache-control', 'no-store')
      return reply.send(result.pdf)
    },
  )

  // ---- Kode pembatalan Pemilik (sama dengan yang dibuat di /ops; satu kode aktif per tenant) ----
  app.get('/api/owner-code', async (request) => getOwnerCodeStatus(getPool(), request.ownerTenantId))

  app.post('/api/owner-code', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const result = await generateOwnerCode(getPool(), request.ownerTenantId)
    request.log.info({ tenantId: request.ownerTenantId }, 'owner: kode pembatalan pemilik dibuat')
    reply.header('cache-control', 'no-store')
    return result
  })

  app.delete('/api/owner-code', async (request) => {
    await revokeOwnerCode(getPool(), request.ownerTenantId)
    request.log.info({ tenantId: request.ownerTenantId }, 'owner: kode pembatalan pemilik dihapus')
    return { ok: true }
  })
}
