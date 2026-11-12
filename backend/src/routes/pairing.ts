import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getPool } from '../db/pool.js'
import { isAuthBlocked, recordAuthFailure, recordAuthSuccess } from '../lib/authThrottle.js'
import { normalizePairingCode, PAIRING_CODE_RE, redeemPairingCode } from '../lib/devicePairing.js'

/**
 * POST /api/pair  { code, label }  →  { ok: true, deviceKey, tenantId } | { ok: false, reason }
 *
 * PUBLIK (tablet belum punya kunci perangkat) — karena itu dibatasi per IP: salah
 * berulang → IP diblokir sementara (authThrottle, sama dengan konsol Pemilik).
 */
const bodySchema = z.object({ code: z.string().regex(PAIRING_CODE_RE), label: z.string().trim().min(1).max(80) })

export async function registerPairingRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/pair', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (isAuthBlocked(request.ip)) {
      reply.code(429)
      return { ok: false, reason: 'blocked', error: 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.' }
    }
    // Ketikan kasir bisa huruf kecil / berspasi / bertanda hubung: dinormalisasi dulu.
    const body = (request.body ?? {}) as { code?: unknown; label?: unknown }
    const parsed = bodySchema.safeParse({ code: normalizePairingCode(String(body.code ?? '')), label: body.label })
    if (!parsed.success) {
      recordAuthFailure(request.ip)
      reply.code(400)
      return { ok: false, reason: 'invalid', error: 'Kode pasang harus 8 huruf/angka, mis. K7QM-3XPA.' }
    }
    const result = await redeemPairingCode(getPool(), parsed.data.code, parsed.data.label)
    if (!result.ok) {
      recordAuthFailure(request.ip)
      return result
    }
    recordAuthSuccess(request.ip)
    request.log.info({ tenantId: result.tenantId, deviceId: result.deviceId }, 'tablet baru dipasangkan lewat kode pasang')
    reply.header('cache-control', 'no-store')
    return { ok: true, deviceKey: result.deviceKey, tenantId: result.tenantId }
  })
}
