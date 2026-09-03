import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getPool } from '../db/pool.js'
import {
  buildMenu,
  getPublicOrderStatus,
  loadCatalog,
  logPublicRequest,
  PublicOrderError,
  resolveToken,
  submitPublicOrder,
  submitTableCall,
  type SubmitItemInput,
} from '../lib/publicOrders.js'

const TOKEN_RE = /^[a-f0-9]{16,64}$/i

const submitSchema = z.object({
  customerName: z.string().max(80).optional().default(''),
  items: z
    .array(
      z.object({
        productId: z.string().min(1).max(80),
        qty: z.number().int().min(1).max(99),
        modifierOptionIds: z.array(z.string().min(1).max(80)).max(20).optional().default([]),
        note: z.string().max(300).optional().default(''),
      }),
    )
    .min(1)
    .max(40),
})

const callSchema = z.object({ type: z.enum(['waiter', 'bill']) })

/**
 * Rute publik pemesanan mandiri via QR. TANPA device key — gerbangnya adalah
 * token QR + rate-limit ketat + validasi server. Disajikan same-origin dengan
 * halaman /order/:token (tidak perlu perubahan CORS).
 */
export async function registerPublicRoutes(app: FastifyInstance): Promise<void> {
  // Rate-limit per-IP khusus jalur publik, lebih ketat dari global.
  const publicLimit = {
    config: {
      rateLimit: { max: 40, timeWindow: '1 minute' },
    },
  }

  function clientIp(req: { ip: string }): string | null {
    return req.ip || null
  }

  function handleErr(reply: import('fastify').FastifyReply, err: unknown): { error: string } {
    if (err instanceof PublicOrderError) {
      reply.code(err.statusCode)
      return { error: err.message }
    }
    reply.code(500)
    return { error: 'Kesalahan server. Coba lagi.' }
  }

  // ---- Menu ----
  app.get('/api/t/:token', publicLimit, async (request, reply) => {
    const token = (request.params as { token: string }).token
    if (!TOKEN_RE.test(token)) {
      reply.code(404)
      return { error: 'Kode QR tidak dikenal.' }
    }
    const client = await getPool().connect()
    try {
      const resolved = await resolveToken(client, token)
      const catalog = await loadCatalog(client)
      await logPublicRequest(client, 'GET /api/t/:token', token, clientIp(request), 200, resolved.tableName)
      return buildMenu(catalog, resolved)
    } catch (err) {
      request.log.warn({ err: err instanceof Error ? err.message : err }, 'menu QR gagal')
      return handleErr(reply, err)
    } finally {
      client.release()
    }
  })

  // ---- Submit pesanan ----
  app.post('/api/t/:token/orders', publicLimit, async (request, reply) => {
    const token = (request.params as { token: string }).token
    if (!TOKEN_RE.test(token)) {
      reply.code(404)
      return { error: 'Kode QR tidak dikenal.' }
    }
    const idempotencyKey = String(request.headers['idempotency-key'] ?? '').trim()
    if (idempotencyKey.length < 8 || idempotencyKey.length > 100) {
      reply.code(400)
      return { error: 'Header Idempotency-Key wajib (8–100 karakter).' }
    }
    const parsed = submitSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'Data pesanan tidak valid.', issues: parsed.error.issues }
    }
    try {
      const result = await submitPublicOrder({
        token,
        idempotencyKey,
        customerName: parsed.data.customerName,
        items: parsed.data.items as SubmitItemInput[],
        ip: clientIp(request),
      })
      reply.code(201)
      return result
    } catch (err) {
      request.log.warn({ err: err instanceof Error ? err.message : err }, 'submit QR gagal')
      return handleErr(reply, err)
    }
  })

  // ---- Status pesanan (halaman pelanggan) ----
  app.get('/api/t/:token/orders/:id', publicLimit, async (request, reply) => {
    const { token, id } = request.params as { token: string; id: string }
    if (!TOKEN_RE.test(token)) {
      reply.code(404)
      return { error: 'Kode QR tidak dikenal.' }
    }
    const client = await getPool().connect()
    try {
      return await getPublicOrderStatus(client, token, id)
    } catch (err) {
      return handleErr(reply, err)
    } finally {
      client.release()
    }
  })

  // ---- Panggil waiter / minta tagihan ----
  app.post('/api/t/:token/calls', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (request, reply) => {
    const token = (request.params as { token: string }).token
    if (!TOKEN_RE.test(token)) {
      reply.code(404)
      return { error: 'Kode QR tidak dikenal.' }
    }
    const parsed = callSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'Permintaan tidak valid.' }
    }
    try {
      await submitTableCall({ token, type: parsed.data.type, ip: clientIp(request) })
      reply.code(201)
      return { ok: true }
    } catch (err) {
      return handleErr(reply, err)
    }
  })
}
