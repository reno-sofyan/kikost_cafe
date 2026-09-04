import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { HAS_DB, resetDatabase, setupDatabase, teardownDatabase } from './helpers/db.js'

const DEVICE_KEY = 'test-device-key-0123456789abcdef'
process.env.SYNC_DEVICE_KEYS = DEVICE_KEY
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test'
process.env.LOG_LEVEL = 'silent'

const suite = HAS_DB ? describe : describe.skip

suite('sync API (integrasi)', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    await setupDatabase()
    const { resetConfigCache } = await import('../src/config.js')
    resetConfigCache()
    const { buildServer } = await import('../src/server.js')
    app = await buildServer()
    await app.ready()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  afterAll(async () => {
    await app.close()
    await teardownDatabase()
  })

  const auth = { authorization: `Bearer ${DEVICE_KEY}` }

  function order(id: string, overrides: Record<string, unknown> = {}) {
    return {
      entity: 'orders',
      entityId: id,
      idempotencyKey: randomUUID(),
      payload: { id, orderNumber: 'KKP-00001', status: 'open', grandTotal: 25000, updatedAt: 1000, ...overrides },
    }
  }

  it('health tanpa auth mengembalikan ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'ok', db: 'ok' })
  })

  it('menolak push tanpa Authorization', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/sync/push', payload: { deviceId: 'd1', items: [] } })
    expect(res.statusCode).toBe(401)
  })

  it('menolak kunci perangkat yang salah', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { authorization: 'Bearer salah' },
      payload: { deviceId: 'd1', items: [] },
    })
    expect(res.statusCode).toBe(401)
  })

  it('menerima push lalu bisa di-pull perangkat lain', async () => {
    const o = order('11111111-1111-1111-1111-111111111111')
    const push = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: auth,
      payload: { deviceId: 'device-a', items: [o] },
    })
    expect(push.statusCode).toBe(200)
    expect(push.json().results[0]).toMatchObject({ idempotencyKey: o.idempotencyKey, status: 'accepted' })

    const pull = await app.inject({ method: 'GET', url: '/api/sync/pull?since=0', headers: auth })
    expect(pull.statusCode).toBe(200)
    const body = pull.json()
    expect(body.entities.orders).toHaveLength(1)
    expect(body.entities.orders[0]).toMatchObject({ id: o.entityId, status: 'open' })
    expect(body.serverTime).toBeGreaterThan(0)
  })

  it('idempotency: mengirim ulang key yang sama tidak menduplikasi', async () => {
    const o = order('22222222-2222-2222-2222-222222222222')
    const first = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: auth,
      payload: { deviceId: 'device-a', items: [o] },
    })
    expect(first.json().results[0].status).toBe('accepted')

    const retry = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: auth,
      payload: { deviceId: 'device-a', items: [o] },
    })
    expect(retry.json().results[0].status).toBe('duplicate')

    const pull = await app.inject({ method: 'GET', url: '/api/sync/pull?since=0', headers: auth })
    expect(pull.json().entities.orders).toHaveLength(1)
  })

  it('pull inkremental hanya mengembalikan perubahan setelah cursor', async () => {
    const a = order('33333333-3333-3333-3333-333333333333')
    await app.inject({ method: 'POST', url: '/api/sync/push', headers: auth, payload: { deviceId: 'd', items: [a] } })
    const firstPull = await app.inject({ method: 'GET', url: '/api/sync/pull?since=0', headers: auth })
    const cursor = firstPull.json().serverTime

    const b = order('44444444-4444-4444-4444-444444444444')
    await app.inject({ method: 'POST', url: '/api/sync/push', headers: auth, payload: { deviceId: 'd', items: [b] } })

    const secondPull = await app.inject({ method: 'GET', url: `/api/sync/pull?since=${cursor}`, headers: auth })
    const body = secondPull.json()
    expect(body.entities.orders).toHaveLength(1)
    expect(body.entities.orders[0].id).toBe(b.entityId)
  })

  it('LWW: payload lebih lama tidak menimpa state yang lebih baru', async () => {
    const id = '55555555-5555-5555-5555-555555555555'
    await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: auth,
      payload: { deviceId: 'd', items: [order(id, { updatedAt: 5000, notes: 'baru' })] },
    })
    await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: auth,
      payload: { deviceId: 'd', items: [order(id, { updatedAt: 1000, notes: 'lama' })] },
    })
    const pull = await app.inject({ method: 'GET', url: '/api/sync/pull?since=0', headers: auth })
    expect(pull.json().entities.orders[0].notes).toBe('baru')
  })

  it('pesanan yang sudah paid tidak bisa dikembalikan ke open lewat sinkronisasi', async () => {
    const id = '66666666-6666-6666-6666-666666666666'
    await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: auth,
      payload: { deviceId: 'd', items: [order(id, { status: 'paid', updatedAt: 2000 })] },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: auth,
      payload: { deviceId: 'd', items: [order(id, { status: 'open', updatedAt: 9999 })] },
    })
    // Ditandai duplicate (tidak perlu retry) tetapi state server tetap paid.
    expect(res.json().results[0].status).toBe('duplicate')
    const pull = await app.inject({ method: 'GET', url: '/api/sync/pull?since=0', headers: auth })
    expect(pull.json().entities.orders[0].status).toBe('paid')
  })

  it('menolak entitas asing tanpa merusak batch', async () => {
    const good = order('77777777-7777-7777-7777-777777777777')
    const bad = { entity: 'users', entityId: 'x', idempotencyKey: randomUUID(), payload: { id: 'x' } }
    const res = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: auth,
      payload: { deviceId: 'd', items: [good, bad] },
    })
    const results = res.json().results
    expect(results.find((r: { idempotencyKey: string }) => r.idempotencyKey === good.idempotencyKey).status).toBe('accepted')
    expect(results.find((r: { idempotencyKey: string }) => r.idempotencyKey === bad.idempotencyKey).status).toBe('rejected')
  })
})
