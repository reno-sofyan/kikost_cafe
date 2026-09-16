import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { loadConfig } from '../config.js'
import { getPool } from '../db/pool.js'
import { isAuthBlocked, recordAuthFailure, recordAuthSuccess } from '../lib/authThrottle.js'
import {
  createQrisCharge,
  decodeMidtransOrderId,
  encodeMidtransOrderId,
  isMidtransPaidStatus,
  MidtransError,
  verifyMidtransSignature,
} from '../lib/midtrans.js'
import { recordOnlinePayment } from '../lib/onlinePayments.js'
import { logPublicRequest, PublicOrderError, resolveToken } from '../lib/publicOrders.js'

const TOKEN_RE = /^[a-f0-9]{16,64}$/i

/** Hanya order yang sudah dikonfirmasi kasir/waiter boleh dibayar online —
 * cermin dari guard yang sama di `applyOnlinePayments` (src/sync/applyRemote.ts). */
const PAYABLE_STATUSES = new Set(['CONFIRMED', 'PREPARING', 'READY', 'SERVED'])

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

const notificationSchema = z.object({
  order_id: z.string().min(1).max(80),
  status_code: z.string().min(1).max(10),
  gross_amount: z.string().min(1).max(30),
  signature_key: z.string().min(1).max(200),
  transaction_status: z.string().min(1).max(30),
  fraud_status: z.string().max(30).optional(),
  transaction_id: z.string().min(1).max(120),
})

/**
 * Pembayaran QRIS online (Midtrans) dari halaman pesan-mandiri /order/:token.
 * Dua rute:
 *  - POST /api/t/:token/orders/:id/pay — mulai transaksi QRIS untuk sebuah
 *    order QR yang sudah dikonfirmasi kasir; server yang menghitung nominal.
 *  - POST /api/payments/midtrans/notification — penerima notifikasi
 *    server-to-server Midtrans (perlu diset di Dashboard Midtrans → Settings
 *    → Configuration → Payment Notification URL).
 * Keduanya nonaktif (503) bila MIDTRANS_SERVER_KEY kosong.
 */
export async function registerMidtransRoutes(app: FastifyInstance): Promise<void> {
  const config = loadConfig()
  const enabled = !!config.MIDTRANS_SERVER_KEY

  app.post('/api/t/:token/orders/:id/pay', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!enabled) {
      reply.code(503)
      return { error: 'Pembayaran online belum dikonfigurasi.' }
    }
    const { token, id: orderId } = request.params as { token: string; id: string }
    if (!TOKEN_RE.test(token)) {
      reply.code(404)
      return { error: 'Kode QR tidak dikenal.' }
    }
    const client = await getPool().connect()
    try {
      const resolved = await resolveToken(client, token)
      const { rows } = await client.query<{ payload: Record<string, unknown> }>(
        "SELECT payload FROM sync_entity_state WHERE entity = 'orders' AND entity_id = $1",
        [orderId],
      )
      const order = rows[0]?.payload
      if (!order || order.source !== 'qr_table' || String(order.tableId) !== resolved.tableId) {
        reply.code(404)
        return { error: 'Pesanan tidak ditemukan.' }
      }
      const lifecycle = String(order.lifecycleStatus ?? '')
      if (!PAYABLE_STATUSES.has(lifecycle)) {
        reply.code(409)
        return { error: 'Pesanan belum dikonfirmasi kasir. Tunggu konfirmasi sebelum membayar online.' }
      }

      const paysRes = await client.query<{ payload: Record<string, unknown> }>(
        "SELECT payload FROM sync_entity_state WHERE entity = 'payments' AND payload->>'orderId' = $1",
        [orderId],
      )
      const paidSoFar = paysRes.rows
        .map((r) => r.payload)
        .filter((p) => num(p.amount) > 0)
        .reduce((s, p) => s + num(p.amount), 0)
      const remaining = Math.round(num(order.grandTotal) - paidSoFar)
      if (remaining <= 0) {
        reply.code(409)
        return { error: 'Pesanan ini sudah lunas.' }
      }

      const midtransOrderId = encodeMidtransOrderId(orderId)
      const charge = await createQrisCharge({
        serverKey: config.MIDTRANS_SERVER_KEY,
        isProduction: config.MIDTRANS_IS_PRODUCTION,
        midtransOrderId,
        grossAmount: remaining,
      })
      await logPublicRequest(client, 'POST /api/t/:token/orders/:id/pay', token, request.ip || null, 201, orderId)
      reply.code(201)
      return { qrString: charge.qrString, grossAmount: charge.grossAmount, expiryTime: charge.expiryTime }
    } catch (err) {
      if (err instanceof PublicOrderError) {
        reply.code(err.statusCode)
        return { error: err.message }
      }
      if (err instanceof MidtransError) {
        request.log.error({ err: err.message }, 'midtrans charge gagal')
        reply.code(502)
        return { error: 'Gateway pembayaran sedang bermasalah. Coba lagi atau bayar di kasir.' }
      }
      request.log.error({ err: err instanceof Error ? err.message : err }, 'midtrans pay gagal')
      reply.code(500)
      return { error: 'Kesalahan server.' }
    } finally {
      client.release()
    }
  })

  app.post('/api/payments/midtrans/notification', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!enabled) {
      reply.code(503)
      return { error: 'Pembayaran online belum dikonfigurasi.' }
    }
    if (isAuthBlocked(request.ip)) {
      reply.code(429)
      return { error: 'Terlalu banyak percobaan gagal.' }
    }
    const parsed = notificationSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'Payload tidak valid.' }
    }
    const { order_id, status_code, gross_amount, signature_key, transaction_status, fraud_status, transaction_id } = parsed.data

    const ok = verifyMidtransSignature({
      orderId: order_id,
      statusCode: status_code,
      grossAmount: gross_amount,
      signatureKey: signature_key,
      serverKey: config.MIDTRANS_SERVER_KEY,
    })
    if (!ok) {
      recordAuthFailure(request.ip)
      request.log.warn({ ip: request.ip, order_id }, 'notifikasi midtrans: tanda tangan salah')
      reply.code(401)
      return { error: 'Tanda tangan tidak sah.' }
    }
    recordAuthSuccess(request.ip)

    if (!isMidtransPaidStatus(transaction_status, fraud_status)) {
      // pending/deny/expire/cancel: tak ada efek bisnis, cukup ack supaya Midtrans berhenti retry.
      return { ok: true, applied: false }
    }

    const orderId = decodeMidtransOrderId(order_id)
    const { inserted } = await recordOnlinePayment(getPool(), {
      orderId,
      billId: `bill_${orderId}`,
      amount: Math.round(Number(gross_amount)),
      method: 'qris',
      reference: transaction_id,
    })
    return { ok: true, applied: inserted }
  })
}
