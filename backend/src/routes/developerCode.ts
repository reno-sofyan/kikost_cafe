import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getPool } from '../db/pool.js'
import { consumeDeveloperCode, DEVELOPER_CODE_LENGTH } from '../lib/developerAccessCodes.js'

/**
 * Tablet mencocokkan token Mode Developer yang dibuat dari konsol /ops. Di bawah
 * /api/sync → butuh kunci perangkat (hook auth di server.ts) dan ter-scope ke tenant
 * perangkat itu. Token yang cocok langsung hangus.
 *
 *  POST /api/sync/developer-code/consume  { code }  →  { ok: true } | { ok: false, reason, attemptsLeft? }
 */
const bodySchema = z.object({ code: z.string().regex(new RegExp(`^\\d{${DEVELOPER_CODE_LENGTH}}$`)) })

export async function registerDeveloperCodeRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/sync/developer-code/consume', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: `Token harus ${DEVELOPER_CODE_LENGTH} angka.` }
    }
    const result = await consumeDeveloperCode(getPool(), request.tenantId, parsed.data.code, request.deviceId ?? null)
    request.log.info({ tenantId: request.tenantId, deviceId: request.deviceId, ok: result.ok, reason: result.ok ? undefined : result.reason }, 'token developer dicocokkan')
    return result
  })
}
