import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { HAS_DB, resetDatabase, setupDatabase, teardownDatabase } from './helpers/db.js'
import { getPool } from '../src/db/pool.js'

const SERVER_KEY = 'SB-Mid-server-test-key-0123456789'
process.env.SYNC_DEVICE_KEYS = process.env.SYNC_DEVICE_KEYS ?? 'test-device-key-0123456789abcdef'
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test'
process.env.LOG_LEVEL = 'silent'
process.env.MIDTRANS_SERVER_KEY = SERVER_KEY
process.env.MIDTRANS_CLIENT_KEY = 'SB-Mid-client-test-key'
process.env.MIDTRANS_IS_PRODUCTION = 'false'

const suite = HAS_DB ? describe : describe.skip

const TOKEN = 'abcdef0123456789abcdef0123456789'

async function seedEntity(entity: string, id: string, payload: Record<string, unknown>): Promise<void> {
  await getPool().query(
    `INSERT INTO sync_entity_state (entity, entity_id, payload, entity_updated_at, server_seq)
     VALUES ($1, $2, $3::jsonb, $4, nextval('sync_server_seq'))`,
    [entity, id, JSON.stringify(payload), Number(payload.updatedAt ?? 1)],
  )
}

function seedTableAndOrder(lifecycleStatus: string, grandTotal = 57800): Promise<void> {
  return (async () => {
    await seedEntity('cafeTables', 't1', { id: 't1', name: 'Meja 1', qrToken: TOKEN, qrActive: true, status: 'occupied', updatedAt: 1 })
    await seedEntity('orders', 'o1', {
      id: 'o1',
      orderNumber: 'QR00001',
      source: 'qr_table',
      tableId: 't1',
      lifecycleStatus,
      status: 'open',
      grandTotal,
      updatedAt: 1,
    })
  })()
}

function midtransSignature(orderId: string, statusCode: string, grossAmount: string): string {
  return createHash('sha512').update(`${orderId}${statusCode}${grossAmount}${SERVER_KEY}`).digest('hex')
}

suite('Midtrans QRIS pay (integrasi)', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    await setupDatabase()
    const { resetConfigCache } = await import('../src/config.js')
    resetConfigCache()
    const { buildServer } = await import('../src/server.js')
    app = await buildServer()
    await app.ready()
  })
  afterEach(() => resetDatabase())
  afterAll(async () => {
    await app.close()
    await teardownDatabase()
  })

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('order belum dikonfirmasi kasir (PENDING_CONFIRMATION) → 409, tidak memanggil gateway', async () => {
    await seedTableAndOrder('PENDING_CONFIRMATION')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const r = await app.inject({ method: 'POST', url: `/api/t/${TOKEN}/orders/o1/pay` })
    expect(r.statusCode).toBe(409)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('order dikonfirmasi kasir → charge QRIS Midtrans, kembalikan qrString', async () => {
    await seedTableAndOrder('CONFIRMED')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status_code: '201',
          transaction_id: 'mt-txn-1',
          order_id: 'o1_abcd1234',
          gross_amount: '57800.00',
          transaction_status: 'pending',
          qr_string: '00020101021226...',
          expiry_time: '2026-01-01 10:15:00',
          actions: [{ name: 'generate-qr-code', method: 'GET', url: 'https://api.sandbox.midtrans.com/qr' }],
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
    )
    const r = await app.inject({ method: 'POST', url: `/api/t/${TOKEN}/orders/o1/pay` })
    expect(r.statusCode).toBe(201)
    const body = r.json()
    expect(body.qrString).toBe('00020101021226...')
    expect(body.grossAmount).toBe(57800)
  })

  it('order sudah lunas → 409, tidak memanggil gateway', async () => {
    await seedTableAndOrder('SERVED', 10000)
    await seedEntity('payments', 'pay1', { id: 'pay1', orderId: 'o1', amount: 10000, method: 'cash', updatedAt: 1 })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const r = await app.inject({ method: 'POST', url: `/api/t/${TOKEN}/orders/o1/pay` })
    expect(r.statusCode).toBe(409)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('notifikasi: tanda tangan salah → 401, tak menulis onlinePayments', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/payments/midtrans/notification',
      payload: {
        order_id: 'o1_abcd1234',
        status_code: '200',
        gross_amount: '57800.00',
        signature_key: 'deadbeef',
        transaction_status: 'settlement',
        transaction_id: 'mt-txn-1',
      },
    })
    expect(r.statusCode).toBe(401)
    const { rows } = await getPool().query("SELECT 1 FROM sync_entity_state WHERE entity='onlinePayments'")
    expect(rows).toHaveLength(0)
  })

  it('notifikasi settlement dgn tanda tangan sah → menulis onlinePayments dgn orderId asli (tanpa nonce)', async () => {
    const payload = {
      order_id: 'o1_abcd1234',
      status_code: '200',
      gross_amount: '57800.00',
      transaction_status: 'settlement',
      transaction_id: 'mt-txn-1',
    }
    const signature_key = midtransSignature(payload.order_id, payload.status_code, payload.gross_amount)
    const r = await app.inject({ method: 'POST', url: '/api/payments/midtrans/notification', payload: { ...payload, signature_key } })
    expect(r.statusCode).toBe(200)
    expect(r.json().applied).toBe(true)

    const { rows } = await getPool().query("SELECT payload FROM sync_entity_state WHERE entity='onlinePayments'")
    expect(rows).toHaveLength(1)
    expect(rows[0].payload).toMatchObject({ orderId: 'o1', billId: 'bill_o1', amount: 57800, method: 'qris', reference: 'mt-txn-1' })

    // idempoten: notifikasi retry Midtrans dgn reference yg sama → tak menulis ulang
    const r2 = await app.inject({ method: 'POST', url: '/api/payments/midtrans/notification', payload: { ...payload, signature_key } })
    expect(r2.json().applied).toBe(false)
    const { rows: rows2 } = await getPool().query("SELECT 1 FROM sync_entity_state WHERE entity='onlinePayments'")
    expect(rows2).toHaveLength(1)
  })

  it('notifikasi pending → 200 tapi tidak menulis onlinePayments', async () => {
    const payload = { order_id: 'o1_xyz', status_code: '201', gross_amount: '10000.00', transaction_status: 'pending', transaction_id: 'mt-txn-2' }
    const signature_key = midtransSignature(payload.order_id, payload.status_code, payload.gross_amount)
    const r = await app.inject({ method: 'POST', url: '/api/payments/midtrans/notification', payload: { ...payload, signature_key } })
    expect(r.statusCode).toBe(200)
    expect(r.json().applied).toBe(false)
    const { rows } = await getPool().query("SELECT 1 FROM sync_entity_state WHERE entity='onlinePayments'")
    expect(rows).toHaveLength(0)
  })
})
