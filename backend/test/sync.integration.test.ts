import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { HAS_DB, resetDatabase, setupDatabase, teardownDatabase } from './helpers/db.js'

const DEVICE_KEY = 'test-device-key-0123456789abcdef'
const MINIMARKET_KEY = 'test-minimarket-key-0123456789abcdef'
process.env.SYNC_DEVICE_KEYS = `cafe:${DEVICE_KEY},minimarket:${MINIMARKET_KEY}`
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
  const minimarketAuth = { authorization: `Bearer ${MINIMARKET_KEY}` }

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

  it('tenant berbeda tidak dapat membaca atau menimpa data usaha lain', async () => {
    const id = '12121212-1212-1212-1212-121212121212'
    const cafeOrder = order(id, { notes: 'Kafe', updatedAt: 1000 })
    const minimarketOrder = order(id, { notes: 'Minimarket', updatedAt: 1000 })

    const cafePush = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: auth,
      payload: { deviceId: 'cafe-tablet', items: [cafeOrder] },
    })
    const minimarketPush = await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: minimarketAuth,
      payload: { deviceId: 'minimarket-tablet', items: [minimarketOrder] },
    })
    expect(cafePush.json().results[0].status).toBe('accepted')
    expect(minimarketPush.json().results[0].status).toBe('accepted')

    const cafePull = await app.inject({ method: 'GET', url: '/api/sync/pull?since=0', headers: auth })
    const minimarketPull = await app.inject({ method: 'GET', url: '/api/sync/pull?since=0', headers: minimarketAuth })
    expect(cafePull.json().entities.orders).toEqual([expect.objectContaining({ id, notes: 'Kafe' })])
    expect(minimarketPull.json().entities.orders).toEqual([expect.objectContaining({ id, notes: 'Minimarket' })])
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

  describe('penghapusan (tombstone)', () => {
    const ING_ID = '88888888-8888-8888-8888-888888888888'
    const ingredient = (updatedAt: number) => ({
      entity: 'ingredients',
      entityId: ING_ID,
      idempotencyKey: randomUUID(),
      payload: { id: ING_ID, name: 'Gula', stockQty: 10, updatedAt },
    })
    const deletion = (entity: string, entityId: string, deletedAt: number) => ({
      entity,
      entityId,
      idempotencyKey: randomUUID(),
      payload: { deletedAt },
      deleted: true,
    })
    const push = (items: unknown[], headers = auth) =>
      app.inject({ method: 'POST', url: '/api/sync/push', headers, payload: { deviceId: 'd', items } })

    it('menghapus bahan baku: hilang dari entities, muncul di deletions, payload dikosongkan', async () => {
      await push([ingredient(1000)])
      const first = await app.inject({ method: 'GET', url: '/api/sync/pull?since=0', headers: auth })
      const cursor = first.json().serverTime

      const res = await push([deletion('ingredients', ING_ID, 2000)])
      expect(res.json().results[0].status).toBe('accepted')

      const pull = await app.inject({ method: 'GET', url: `/api/sync/pull?since=${cursor}`, headers: auth })
      expect(pull.json().entities.ingredients).toBeUndefined()
      expect(pull.json().deletions.ingredients).toEqual([ING_ID])

      const { getPool } = await import('../src/db/pool.js')
      const { rows } = await getPool().query("SELECT payload, deleted FROM sync_entity_state WHERE entity_id = $1", [ING_ID])
      expect(rows[0]).toEqual({ payload: {}, deleted: true })
    })

    it('upsert basi (lebih lama dari penghapusan) tidak menghidupkan kembali; editan lebih baru boleh', async () => {
      await push([ingredient(1000), deletion('ingredients', ING_ID, 2000)])

      expect((await push([ingredient(1500)])).json().results[0].status).toBe('duplicate')
      let pull = await app.inject({ method: 'GET', url: '/api/sync/pull?since=0', headers: auth })
      expect(pull.json().entities.ingredients).toBeUndefined()

      expect((await push([ingredient(3000)])).json().results[0].status).toBe('accepted')
      pull = await app.inject({ method: 'GET', url: '/api/sync/pull?since=0', headers: auth })
      expect(pull.json().entities.ingredients[0].name).toBe('Gula')
      expect(pull.json().deletions.ingredients).toBeUndefined()
    })

    it('menolak penghapusan entitas di luar daftar putih (mis. shifts, auditLogs)', async () => {
      const id = '99999999-9999-9999-9999-999999999999'
      await push([{ entity: 'shifts', entityId: id, idempotencyKey: randomUUID(), payload: { id, updatedAt: 1000 } }])
      const res = await push([deletion('shifts', id, 5000), deletion('auditLogs', id, 5000)])
      expect(res.json().results.map((r: { status: string }) => r.status)).toEqual(['rejected', 'rejected'])
      const pull = await app.inject({ method: 'GET', url: '/api/sync/pull?since=0', headers: auth })
      expect(pull.json().entities.shifts).toHaveLength(1)
    })

    it('hapus transaksi: order & pembayaran hilang dari pull, pembayaran tak bisa dihidupkan lagi', async () => {
      const orderId = '12121212-1212-1212-1212-121212121212'
      const payId = '34343434-3434-3434-3434-343434343434'
      const payment = () => ({
        entity: 'payments',
        entityId: payId,
        idempotencyKey: randomUUID(),
        payload: { id: payId, orderId, amount: 25000, createdAt: 1000 },
      })
      await push([order(orderId, { status: 'paid', updatedAt: 1000 }), payment()])

      const res = await push([deletion('orders', orderId, 2000), deletion('payments', payId, 2000)])
      expect(res.json().results.map((r: { status: string }) => r.status)).toEqual(['accepted', 'accepted'])

      // Perangkat lain yang belum tahu mengirim ulang pembayaran lama → tetap terhapus.
      await push([payment()])
      const pull = await app.inject({ method: 'GET', url: '/api/sync/pull?since=0', headers: auth })
      expect(pull.json().entities.orders).toBeUndefined()
      expect(pull.json().entities.payments).toBeUndefined()
      expect(pull.json().deletions.orders).toEqual([orderId])
      expect(pull.json().deletions.payments).toEqual([payId])
    })

    it('penghapusan ter-scope per tenant', async () => {
      await push([ingredient(1000)])
      await push([ingredient(1000)], minimarketAuth)
      await push([deletion('ingredients', ING_ID, 2000)])
      const mm = await app.inject({ method: 'GET', url: '/api/sync/pull?since=0', headers: minimarketAuth })
      expect(mm.json().entities.ingredients).toHaveLength(1)
      expect(mm.json().deletions.ingredients).toBeUndefined()
    })
  })
})
