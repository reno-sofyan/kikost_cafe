import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { HAS_DB, resetDatabase, setupDatabase, teardownDatabase } from './helpers/db.js'
import { getPool } from '../src/db/pool.js'

const SERVER_KEY = 'SB-Mid-server-cashier-test-0123456789'
const KANTIN_KEY = 'kantin-device-key-0123456789abcdef'
const OTHER_KEY = 'other-device-key-0123456789abcdef'
const kantin = { authorization: `Bearer ${KANTIN_KEY}` }
const other = { authorization: `Bearer ${OTHER_KEY}` }

const suite = HAS_DB ? describe : describe.skip

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
const chargeResponse = (orderId: string) =>
  json({
    status_code: '201',
    transaction_id: 'mt-charge-1',
    order_id: orderId,
    gross_amount: '25000.00',
    transaction_status: 'pending',
    qr_string: '00020101021226QRISDEMO',
    expiry_time: '2026-10-07 12:15:00',
  }, 201)

suite('Midtrans QRIS dari kasir (integrasi)', () => {
  let app: FastifyInstance
  const saved: Record<string, string | undefined> = {}

  beforeAll(async () => {
    for (const k of ['SYNC_DEVICE_KEYS', 'MIDTRANS_SERVER_KEY', 'MIDTRANS_IS_PRODUCTION', 'LOG_LEVEL']) saved[k] = process.env[k]
    process.env.SYNC_DEVICE_KEYS = `kantin:${KANTIN_KEY},other:${OTHER_KEY}`
    process.env.MIDTRANS_SERVER_KEY = SERVER_KEY
    process.env.MIDTRANS_IS_PRODUCTION = 'false'
    process.env.LOG_LEVEL = 'silent'
    await setupDatabase()
    const { resetConfigCache } = await import('../src/config.js')
    resetConfigCache()
    const { buildServer } = await import('../src/server.js')
    app = await buildServer()
    await app.ready()
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await resetDatabase()
  })
  afterAll(async () => {
    await app.close()
    await teardownDatabase()
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    const { resetConfigCache } = await import('../src/config.js')
    resetConfigCache()
  })

  async function createCharge(): Promise<string> {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as { transaction_details: { order_id: string } }
      return chargeResponse(body.transaction_details.order_id)
    })
    const r = await app.inject({
      method: 'POST',
      url: '/api/sync/midtrans/charges',
      headers: kantin,
      payload: { orderId: 'ord-kantin-1', billId: 'bill_ord-kantin-1', amount: 25000 },
    })
    expect(r.statusCode).toBe(201)
    const body = r.json()
    expect(body).toMatchObject({ qrString: '00020101021226QRISDEMO', grossAmount: 25000, isProduction: false })
    return body.chargeId as string
  }

  async function onlinePayments() {
    const { rows } = await getPool().query<{ tenant_id: string; payload: Record<string, unknown> }>(
      "SELECT tenant_id, payload FROM sync_entity_state WHERE entity = 'onlinePayments'",
    )
    return rows
  }

  it('butuh kunci perangkat; config melaporkan aktif & sandbox', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/sync/midtrans/config' })).statusCode).toBe(401)
    const r = await app.inject({ method: 'GET', url: '/api/sync/midtrans/config', headers: kantin })
    expect(r.json()).toEqual({ enabled: true, isProduction: false })
  })

  it('validasi body charge', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/sync/midtrans/charges', headers: kantin, payload: { orderId: 'x', billId: 'b', amount: -5 } })
    expect(r.statusCode).toBe(400)
  })

  it('cek status: pending lalu settlement → onlinePayment tercatat untuk tenant perangkat (pesanan belum tersinkron)', async () => {
    const id = await createCharge()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ status_code: '404', status_message: "Transaction doesn't exist." }, 404))
    expect((await app.inject({ method: 'GET', url: `/api/sync/midtrans/charges/${id}`, headers: kantin })).json()).toEqual({ status: 'pending' })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      json({ status_code: '200', transaction_status: 'settlement', transaction_id: 'mt-txn-777', gross_amount: '25000.00' }),
    )
    const paid = await app.inject({ method: 'GET', url: `/api/sync/midtrans/charges/${id}`, headers: kantin })
    expect(paid.json()).toEqual({ status: 'paid', reference: 'mt-txn-777', amount: 25000 })

    const ops = await onlinePayments()
    expect(ops).toHaveLength(1)
    expect(ops[0].tenant_id).toBe('kantin')
    expect(ops[0].payload).toMatchObject({ orderId: 'ord-kantin-1', billId: 'bill_ord-kantin-1', amount: 25000, method: 'qris', reference: 'mt-txn-777' })

    // Cek berikutnya dijawab dari catatan server tanpa memanggil Midtrans lagi.
    const spy = vi.spyOn(globalThis, 'fetch')
    expect((await app.inject({ method: 'GET', url: `/api/sync/midtrans/charges/${id}`, headers: kantin })).json()).toMatchObject({ status: 'paid' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('tenant lain tidak bisa melihat atau membatalkan charge', async () => {
    const id = await createCharge()
    expect((await app.inject({ method: 'GET', url: `/api/sync/midtrans/charges/${id}`, headers: other })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: `/api/sync/midtrans/charges/${id}/cancel`, headers: other })).statusCode).toBe(404)
  })

  it('webhook untuk charge kasir mencatat pembayaran memakai tenant charge', async () => {
    const id = await createCharge()
    const sig = createHash('sha512').update(`${id}20025000.00${SERVER_KEY}`).digest('hex')
    const r = await app.inject({
      method: 'POST',
      url: '/api/payments/midtrans/notification',
      payload: { order_id: id, status_code: '200', gross_amount: '25000.00', signature_key: sig, transaction_status: 'settlement', transaction_id: 'mt-txn-hook' },
    })
    expect(r.json()).toEqual({ ok: true, applied: true })
    const ops = await onlinePayments()
    expect(ops.map((o) => [o.tenant_id, o.payload.reference])).toEqual([['kantin', 'mt-txn-hook']])
  })

  it('batal: QR belum dibayar → cancelled; sudah terlanjur dibayar → paid (uang tak hilang)', async () => {
    const id = await createCharge()
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ status_code: '200', transaction_status: 'cancel' })) // cancel
      .mockResolvedValueOnce(json({ status_code: '200', transaction_status: 'cancel', transaction_id: 'x' })) // status
    expect((await app.inject({ method: 'POST', url: `/api/sync/midtrans/charges/${id}/cancel`, headers: kantin })).json()).toEqual({ status: 'cancelled' })

    const id2 = await createCharge()
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ status_code: '412', status_message: 'Transaction status cannot be updated.' }, 412))
      .mockResolvedValueOnce(json({ status_code: '200', transaction_status: 'settlement', transaction_id: 'mt-txn-race', gross_amount: '25000.00' }))
    const r = await app.inject({ method: 'POST', url: `/api/sync/midtrans/charges/${id2}/cancel`, headers: kantin })
    expect(r.json()).toEqual({ status: 'paid', reference: 'mt-txn-race', amount: 25000 })
    expect((await onlinePayments()).map((o) => o.payload.reference)).toEqual(['mt-txn-race'])
  })
})
