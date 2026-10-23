import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getPool } from '../db/pool.js'
import { isAuthBlocked, recordAuthFailure, recordAuthSuccess } from '../lib/authThrottle.js'
import { authenticateOwnerToken } from '../lib/ownerAccess.js'
import {
  OWNER_CONSOLE_TITLES,
  loadCafeHighlights,
  loadCafeTables,
  loadKantinHighlights,
  loadKantinPayLater,
  loadKantinProofPhoto,
  loadKantinProofs,
  loadTenantBusinessType,
  ownerConsoleAreaFor,
  ownerConsolePath,
  type OwnerConsoleArea,
} from '../lib/ownerConsole.js'
import { generateOwnerCode, getOwnerCodeStatus, revokeOwnerCode } from '../lib/ownerCancelCodes.js'
import { buildTenantExport, loadCancellationReport, loadSalesReport, loadTenantDetail, loadTenantOverview, num, parseWibRange } from '../lib/tenantReports.js'
import { OWNER_DASHBOARD_HTML } from './ownerDashboard.js'

/**
 * Konsol Pemilik usaha — padanan /ops untuk SATU tenant. Pemilik masuk lewat tautan
 * bertoken yang dibuat developer di /ops (`/owner/kafe#k=<token>`); token menentukan
 * tenant, jadi tak ada parameter tenant di URL yang bisa diganti-ganti.
 *
 * Akses dipisah per jenis usaha — plugin ini didaftarkan sekali per area:
 *  - `/owner/kafe`   → hanya token usaha Kafe & Resto (+ status meja)
 *  - `/owner/kantin` → hanya token usaha Kantin (+ Tagihan Tertunda, bukti bayar)
 *  - `/owner`        → jenis lain (minimarket, "lainnya"); tautan lama kafe/kantin
 *                      dijawab 403 + `consolePath` agar halaman pindah ke alamatnya.
 *
 * Isi bersama: omzet & transaksi, log aktivitas, rekap pembatalan, export PDF, dan
 * membuat kode pembatalan Pemilik sendiri (tanpa menghubungi developer).
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

export async function registerOwnerRoutes(app: FastifyInstance, opts: { area: OwnerConsoleArea }): Promise<void> {
  const { area } = opts
  const apiPrefix = `${ownerConsolePath(area)}/api`
  const html = OWNER_DASHBOARD_HTML.replace('__OWNER_AREA__', area).replaceAll('__OWNER_TITLE__', OWNER_CONSOLE_TITLES[area])
  if (!app.hasRequestDecorator('ownerTenantId')) app.decorateRequest('ownerTenantId', '')

  // Shell boleh dimuat tanpa token (tidak memuat data); `<area>/api/*` wajib token
  // milik usaha yang jenisnya sesuai area ini.
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.url.startsWith(apiPrefix)) return
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
    const tenantArea = ownerConsoleAreaFor(await loadTenantBusinessType(getPool(), access.tenantId))
    if (tenantArea !== area) {
      return reply.code(403).send({
        error: `Tautan ini untuk ${OWNER_CONSOLE_TITLES[tenantArea]}, bukan ${OWNER_CONSOLE_TITLES[area]}`,
        consolePath: ownerConsolePath(tenantArea),
      })
    }
    request.ownerTenantId = access.tenantId
  })

  app.get('/', async (_request, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8')
    reply.header('cache-control', 'no-store')
    reply.header('x-robots-tag', 'noindex, nofollow')
    // Token ada di fragmen URL; jangan sampai bocor lewat Referer ke tautan keluar.
    reply.header('referrer-policy', 'no-referrer')
    return html
  })

  app.get('/api/overview', async (request) => {
    const pool = getPool()
    const [base, highlights] = await Promise.all([
      loadTenantOverview(pool, request.ownerTenantId),
      area === 'kafe'
        ? loadCafeHighlights(pool, request.ownerTenantId)
        : area === 'kantin'
          ? loadKantinHighlights(pool, request.ownerTenantId)
          : null,
    ])
    return { ...base, area, highlights }
  })

  app.get('/api/detail', async (request) => loadTenantDetail(getPool(), request.ownerTenantId))

  // Rekap penjualan per periode (tanggal WIB) — isi dibedakan per jenis usaha (kafe / kantin).
  app.get<{ Querystring: { from?: string; to?: string } }>('/api/sales', async (request, reply) => {
    const range = parseWibRange(request.query.from, request.query.to)
    if ('error' in range) {
      reply.code(400)
      return { error: range.error }
    }
    const report = await loadSalesReport(getPool(), request.ownerTenantId, range.sinceMs, range.untilMs)
    return { label: range.label, ...report }
  })

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

  // ---- Khusus kafe: status meja saat ini ----
  if (area === 'kafe') {
    app.get('/api/tables', async (request) => loadCafeTables(getPool(), request.ownerTenantId))
  }

  // ---- Khusus kantin: Tagihan Tertunda & foto bukti bayar QRIS/transfer ----
  if (area === 'kantin') {
    app.get('/api/pay-later', async (request) => loadKantinPayLater(getPool(), request.ownerTenantId))

    app.get<{ Querystring: { from?: string; to?: string } }>('/api/proofs', async (request, reply) => {
      const range = parseWibRange(request.query.from, request.query.to)
      if ('error' in range) {
        reply.code(400)
        return { error: range.error }
      }
      const result = await loadKantinProofs(getPool(), request.ownerTenantId, range.sinceMs, range.untilMs)
      return { label: range.label, ...result }
    })

    app.get<{ Params: { id: string } }>('/api/proofs/:id/photo', async (request, reply) => {
      const photo = await loadKantinProofPhoto(getPool(), request.ownerTenantId, request.params.id)
      if (!photo) {
        reply.code(404)
        return { error: 'Foto tidak ditemukan' }
      }
      reply.header('content-type', photo.contentType)
      reply.header('cache-control', 'private, max-age=3600')
      return reply.send(photo.body)
    })
  }

  // ---- Kode pembatalan Pemilik (sama dengan yang dibuat di /ops; satu kode aktif per tenant) ----
  app.get('/api/owner-code', async (request) => getOwnerCodeStatus(getPool(), request.ownerTenantId))

  app.post('/api/owner-code', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const permanent = (request.body as { permanent?: unknown } | null)?.permanent === true
    const result = await generateOwnerCode(getPool(), request.ownerTenantId, { permanent })
    request.log.info({ tenantId: request.ownerTenantId, permanent }, 'owner: kode pembatalan pemilik dibuat')
    reply.header('cache-control', 'no-store')
    return result
  })

  app.delete('/api/owner-code', async (request) => {
    await revokeOwnerCode(getPool(), request.ownerTenantId)
    request.log.info({ tenantId: request.ownerTenantId }, 'owner: kode pembatalan pemilik dihapus')
    return { ok: true }
  })
}
