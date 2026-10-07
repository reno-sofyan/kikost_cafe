import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { z } from 'zod'
import { loadConfig } from '../config.js'
import { getPool } from '../db/pool.js'
import {
  cancelTransaction,
  createQrisCharge,
  encodeMidtransOrderId,
  getTransactionStatus,
  isMidtransPaidStatus,
  MidtransError,
} from '../lib/midtrans.js'
import { recordOnlinePayment } from '../lib/onlinePayments.js'

/**
 * QRIS dinamis Midtrans dari KASIR (tablet). Rute di bawah /api/sync/* sehingga
 * otomatis butuh kunci perangkat (hook auth di server.ts) dan ter-scope ke tenant
 * perangkat itu.
 *
 *  GET  /api/sync/midtrans/config          — aktif? sandbox/produksi?
 *  POST /api/sync/midtrans/charges         — buat QR untuk satu bill (nominal dari kasir)
 *  GET  /api/sync/midtrans/charges/:id     — status; bila lunas → catat onlinePayment
 *  POST /api/sync/midtrans/charges/:id/cancel — kasir ganti metode / tutup QR
 *
 * Nominal datang dari tablet kasir yang sudah terautentikasi (bukan pelanggan
 * anonim seperti /order/:token), jadi dipercaya; Midtrans yang menjamin uangnya.
 * Lunas dicatat lewat `recordOnlinePayment` — jalur yang sama dengan webhook —
 * sehingga tablet lain/riwayat menerimanya lewat sinkronisasi biasa.
 */

const chargeBodySchema = z.object({
  orderId: z.string().min(1).max(80).regex(/^[A-Za-z0-9-]+$/),
  billId: z.string().min(1).max(120),
  amount: z.number().int().positive().max(100_000_000),
})

const CHARGE_ID_RE = /^[A-Za-z0-9-]+_[a-f0-9]{8}$/

export type CashierChargeStatus = 'pending' | 'paid' | 'expired' | 'failed' | 'cancelled'

interface ChargeRow {
  midtrans_order_id: string
  tenant_id: string
  order_id: string
  bill_id: string
  gross_amount: number
  status: string
  transaction_id: string | null
}

/** Tandai charge lunas & catat onlinePayment (idempoten by reference). */
export async function settleCharge(pool: Pool, row: ChargeRow, transactionId: string, grossAmount?: number): Promise<void> {
  await recordOnlinePayment(pool, {
    tenantId: row.tenant_id,
    orderId: row.order_id,
    billId: row.bill_id,
    amount: grossAmount && grossAmount > 0 ? grossAmount : row.gross_amount,
    method: 'qris',
    reference: transactionId,
  })
  await pool.query(
    `UPDATE midtrans_charges SET status = 'paid', transaction_id = $2, updated_at = now() WHERE midtrans_order_id = $1`,
    [row.midtrans_order_id, transactionId],
  )
}

export async function findCharge(pool: Pool, midtransOrderId: string): Promise<ChargeRow | null> {
  const { rows } = await pool.query<ChargeRow>(
    `SELECT midtrans_order_id, tenant_id, order_id, bill_id, gross_amount, status, transaction_id
       FROM midtrans_charges WHERE midtrans_order_id = $1`,
    [midtransOrderId],
  )
  return rows[0] ?? null
}

function statusFromMidtrans(transactionStatus: string, fraudStatus: string | undefined): CashierChargeStatus {
  if (isMidtransPaidStatus(transactionStatus, fraudStatus)) return 'paid'
  if (transactionStatus === 'expire') return 'expired'
  if (transactionStatus === 'cancel') return 'cancelled'
  if (transactionStatus === 'deny' || transactionStatus === 'failure') return 'failed'
  return 'pending'
}

export async function registerMidtransCashierRoutes(app: FastifyInstance): Promise<void> {
  const config = loadConfig()
  const enabled = !!config.MIDTRANS_SERVER_KEY
  const mt = { serverKey: config.MIDTRANS_SERVER_KEY, isProduction: config.MIDTRANS_IS_PRODUCTION }

  app.get('/api/sync/midtrans/config', async () => ({ enabled, isProduction: enabled && config.MIDTRANS_IS_PRODUCTION }))

  app.post('/api/sync/midtrans/charges', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!enabled) {
      reply.code(503)
      return { error: 'Midtrans belum dikonfigurasi di server.' }
    }
    const parsed = chargeBodySchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'Data tagihan tidak valid.' }
    }
    const { orderId, billId, amount } = parsed.data
    const midtransOrderId = encodeMidtransOrderId(orderId)
    try {
      const charge = await createQrisCharge({ ...mt, midtransOrderId, grossAmount: amount })
      await getPool().query(
        `INSERT INTO midtrans_charges (midtrans_order_id, tenant_id, order_id, bill_id, gross_amount, device_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [midtransOrderId, request.tenantId, orderId, billId, amount, request.deviceId ?? null],
      )
      reply.code(201)
      return {
        chargeId: midtransOrderId,
        qrString: charge.qrString,
        grossAmount: charge.grossAmount,
        expiryTime: charge.expiryTime,
        isProduction: config.MIDTRANS_IS_PRODUCTION,
      }
    } catch (err) {
      if (err instanceof MidtransError) {
        request.log.error({ err: err.message }, 'midtrans charge kasir gagal')
        reply.code(502)
        return { error: `Midtrans menolak: ${err.message}` }
      }
      throw err
    }
  })

  app.get<{ Params: { id: string } }>('/api/sync/midtrans/charges/:id', async (request, reply) => {
    if (!enabled) {
      reply.code(503)
      return { error: 'Midtrans belum dikonfigurasi di server.' }
    }
    const id = request.params.id
    if (!CHARGE_ID_RE.test(id)) {
      reply.code(400)
      return { error: 'ID transaksi tidak valid.' }
    }
    const pool = getPool()
    const row = await findCharge(pool, id)
    if (!row || row.tenant_id !== request.tenantId) {
      reply.code(404)
      return { error: 'Transaksi tidak ditemukan.' }
    }
    if (row.status === 'paid' && row.transaction_id) {
      return { status: 'paid' satisfies CashierChargeStatus, reference: row.transaction_id, amount: row.gross_amount }
    }
    try {
      const st = await getTransactionStatus({ ...mt, midtransOrderId: id })
      if (!st) return { status: 'pending' satisfies CashierChargeStatus }
      const status = statusFromMidtrans(st.transactionStatus, st.fraudStatus)
      if (status === 'paid' && st.transactionId) {
        await settleCharge(pool, row, st.transactionId, st.grossAmount)
        return { status, reference: st.transactionId, amount: st.grossAmount || row.gross_amount }
      }
      if (status !== 'pending' && status !== row.status) {
        await pool.query(`UPDATE midtrans_charges SET status = $2, updated_at = now() WHERE midtrans_order_id = $1`, [id, status])
      }
      return { status }
    } catch (err) {
      if (err instanceof MidtransError) {
        reply.code(502)
        return { error: `Cek status Midtrans gagal: ${err.message}` }
      }
      throw err
    }
  })

  app.post<{ Params: { id: string } }>('/api/sync/midtrans/charges/:id/cancel', async (request, reply) => {
    if (!enabled) {
      reply.code(503)
      return { error: 'Midtrans belum dikonfigurasi di server.' }
    }
    const id = request.params.id
    const pool = getPool()
    const row = CHARGE_ID_RE.test(id) ? await findCharge(pool, id) : null
    if (!row || row.tenant_id !== request.tenantId) {
      reply.code(404)
      return { error: 'Transaksi tidak ditemukan.' }
    }
    if (row.status === 'paid') return { status: 'paid' satisfies CashierChargeStatus, reference: row.transaction_id }
    await cancelTransaction({ ...mt, midtransOrderId: id })
    // Pembeli bisa saja membayar tepat saat kasir membatalkan — QR yang sudah lunas
    // tak bisa dibatalkan di Midtrans. Cek sekali lagi supaya uangnya tak "hilang".
    const st = await getTransactionStatus({ ...mt, midtransOrderId: id }).catch(() => null)
    if (st && st.transactionId && statusFromMidtrans(st.transactionStatus, st.fraudStatus) === 'paid') {
      await settleCharge(pool, row, st.transactionId, st.grossAmount)
      return { status: 'paid' satisfies CashierChargeStatus, reference: st.transactionId, amount: st.grossAmount || row.gross_amount }
    }
    await pool.query(`UPDATE midtrans_charges SET status = 'cancelled', updated_at = now() WHERE midtrans_order_id = $1`, [id])
    return { status: 'cancelled' satisfies CashierChargeStatus }
  })
}
