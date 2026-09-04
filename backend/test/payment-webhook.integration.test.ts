import { createHmac } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { HAS_DB, resetDatabase, setupDatabase, teardownDatabase } from './helpers/db.js'
import { getPool } from '../src/db/pool.js'

const SECRET = 'webhook-secret-abc123'
process.env.SYNC_DEVICE_KEYS = 'env-device-key-0123456789abcdef'
process.env.PAYMENT_WEBHOOK_SECRET = SECRET
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test'
process.env.LOG_LEVEL = 'silent'

const suite = HAS_DB ? describe : describe.skip

function sign(orderId: string, billId: string, amount: number, reference: string): string {
  return createHmac('sha256', SECRET).update(`${orderId}.${billId}.${amount}.${reference}`).digest('hex')
}

suite('POST /api/payments/webhook (integrasi)', () => {
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

  const body = { orderId: 'o1', billId: 'bill_o1', amount: 40000, method: 'qris' as const, reference: 'gw-ref-1' }

  it('tanda tangan salah → 401, tak menulis apa pun', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/payments/webhook',
      headers: { 'x-signature': 'deadbeef', 'content-type': 'application/json' },
      payload: body,
    })
    expect(r.statusCode).toBe(401)
    const { rows } = await getPool().query("SELECT 1 FROM sync_entity_state WHERE entity='onlinePayments'")
    expect(rows).toHaveLength(0)
  })

  it('tanda tangan sah → menulis entitas onlinePayments; idempoten by reference', async () => {
    const sig = sign(body.orderId, body.billId, body.amount, body.reference)
    const r1 = await app.inject({
      method: 'POST', url: '/api/payments/webhook',
      headers: { 'x-signature': sig, 'content-type': 'application/json' },
      payload: body,
    })
    expect(r1.statusCode).toBe(201)

    const { rows } = await getPool().query("SELECT payload FROM sync_entity_state WHERE entity='onlinePayments'")
    expect(rows).toHaveLength(1)
    expect(rows[0].payload).toMatchObject({ billId: 'bill_o1', amount: 40000, method: 'qris', reference: 'gw-ref-1' })

    const r2 = await app.inject({
      method: 'POST', url: '/api/payments/webhook',
      headers: { 'x-signature': sig, 'content-type': 'application/json' },
      payload: body,
    })
    expect(r2.statusCode).toBe(200)
    expect(r2.json().duplicate).toBe(true)
  })

  it('entitas onlinePayments ikut ter-pull oleh perangkat', async () => {
    const sig = sign(body.orderId, body.billId, body.amount, body.reference)
    await app.inject({
      method: 'POST', url: '/api/payments/webhook',
      headers: { 'x-signature': sig, 'content-type': 'application/json' }, payload: body,
    })
    const pull = await app.inject({
      method: 'GET', url: '/api/sync/pull?since=0',
      headers: { authorization: 'Bearer env-device-key-0123456789abcdef' },
    })
    expect(pull.json().entities.onlinePayments).toHaveLength(1)
  })
})
