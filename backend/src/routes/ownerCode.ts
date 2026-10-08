import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getPool } from '../db/pool.js'
import { consumeOwnerCode, OWNER_CODE_LENGTH } from '../lib/ownerCancelCodes.js'

/**
 * Tablet mencocokkan kode pembatalan Pemilik yang dibuat dari konsol /ops.
 * Di bawah /api/sync → butuh kunci perangkat (hook auth di server.ts) dan
 * ter-scope ke tenant perangkat itu. Kode yang cocok langsung hangus.
 *
 *  POST /api/sync/owner-code/consume  { code }  →  { ok: true, createdAt } | { ok: false, reason, retryInMs? }
 */

const bodySchema = z.object({ code: z.string().regex(new RegExp(`^\\d{${OWNER_CODE_LENGTH}}$`)) })

export async function registerOwnerCodeRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/sync/owner-code/consume', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'Kode tidak valid.' }
    }
    const result = await consumeOwnerCode(getPool(), request.tenantId, parsed.data.code, request.deviceId ?? null)
    if (result.ok) request.log.info({ tenantId: request.tenantId, deviceId: request.deviceId }, 'kode pemilik (ops) dipakai')
    return result
  })
}
