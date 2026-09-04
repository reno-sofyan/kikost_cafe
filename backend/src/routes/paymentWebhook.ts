import { createHmac, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { loadConfig } from '../config.js'
import { getPool } from '../db/pool.js'
import { isAuthBlocked, recordAuthFailure, recordAuthSuccess } from '../lib/authThrottle.js'

/**
 * Webhook pembayaran online (QRIS / payment gateway). Bersifat generik:
 * adaptor gateway apa pun menerjemahkan notifikasinya ke bentuk ini +
 * tanda tangan HMAC-SHA256(hex) dari string `orderId.billId.amount.reference`
 * memakai `PAYMENT_WEBHOOK_SECRET`.
 *
 * Efek: menulis satu entitas `onlinePayments` (append-only, idempoten by
 * reference) ke `sync_entity_state`. TABLET yang menjalankan `payBill` lokal
 * saat menariknya — potong stok, selesaikan order — jadi kebenaran bisnis tetap
 * di klien & jalur kasir offline tak berubah.
 */

const bodySchema = z.object({
  orderId: z.string().min(1).max(80),
  billId: z.string().min(1).max(120),
  amount: z.number().int().positive(),
  method: z.enum(['qris', 'transfer', 'card']),
  reference: z.string().min(4).max(120),
})

export async function registerPaymentWebhook(app: FastifyInstance): Promise<void> {
  const secret = loadConfig().PAYMENT_WEBHOOK_SECRET

  app.post('/api/payments/webhook', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!secret) {
      reply.code(503)
      return { error: 'Webhook pembayaran online belum dikonfigurasi.' }
    }
    if (isAuthBlocked(request.ip)) {
      reply.code(429)
      return { error: 'Terlalu banyak percobaan gagal.' }
    }
    const parsed = bodySchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'Payload tidak valid', issues: parsed.error.issues }
    }
    const { orderId, billId, amount, method, reference } = parsed.data

    const provided = String(request.headers['x-signature'] ?? '')
    const expected = createHmac('sha256', secret).update(`${orderId}.${billId}.${amount}.${reference}`).digest('hex')
    const ok =
      provided.length === expected.length &&
      timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'))
    if (!ok) {
      recordAuthFailure(request.ip)
      request.log.warn({ ip: request.ip, reference }, 'webhook pembayaran: tanda tangan salah')
      reply.code(401)
      return { error: 'Tanda tangan tidak sah.' }
    }
    recordAuthSuccess(request.ip)

    const now = Date.now()
    const payload = { id: reference, orderId, billId, amount, method, reference, createdAt: now }

    // Idempoten: reference sudah ada → tidak menulis ulang.
    const res = await getPool().query(
      `INSERT INTO sync_entity_state (entity, entity_id, payload, entity_updated_at, server_seq, updated_at)
         VALUES ('onlinePayments', $1, $2::jsonb, $3, nextval('sync_server_seq'), now())
       ON CONFLICT (entity, entity_id) DO NOTHING`,
      [reference, JSON.stringify(payload), now],
    )

    reply.code(res.rowCount ? 201 : 200)
    return { ok: true, duplicate: res.rowCount === 0 }
  })
}
