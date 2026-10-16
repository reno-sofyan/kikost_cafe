import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HAS_DB, resetDatabase, setupDatabase, teardownDatabase } from './helpers/db.js'

const DEVICE_KEY = 'test-paging-key-0123456789abcdef'
process.env.SYNC_DEVICE_KEYS = `cafe:${DEVICE_KEY}`
// Batas kecil supaya satu entitas terpotong sementara entitas lain tidak.
process.env.SYNC_PULL_LIMIT = '3'
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test'
process.env.LOG_LEVEL = 'silent'

const suite = HAS_DB ? describe : describe.skip

suite('sync pull berhalaman (integrasi)', () => {
  let app: FastifyInstance
  const auth = { authorization: `Bearer ${DEVICE_KEY}` }

  beforeAll(async () => {
    await setupDatabase()
    await resetDatabase()
    const { resetConfigCache } = await import('../src/config.js')
    resetConfigCache()
    const { buildServer } = await import('../src/server.js')
    app = await buildServer()
    await app.ready()
  })

  afterAll(async () => {
    await resetDatabase()
    await app.close()
    await teardownDatabase()
  })

  it('entitas yang terpotong batas tidak terlewat saat entitas lain punya seq lebih tinggi', async () => {
    const orderIds = Array.from({ length: 5 }, () => randomUUID())
    const items = [
      ...orderIds.map((id) => ({
        entity: 'orders', entityId: id, idempotencyKey: randomUUID(),
        payload: { id, orderNumber: 'X', status: 'open', grandTotal: 1, updatedAt: 1000 },
      })),
      { entity: 'products', entityId: 'p1', idempotencyKey: randomUUID(), payload: { id: 'p1', name: 'Latte', price: 1, updatedAt: 1000 } },
    ]
    const push = await app.inject({ method: 'POST', url: '/api/sync/push', headers: auth, payload: { deviceId: 'tab-a', items } })
    expect(push.statusCode).toBe(200)

    const seen = new Set<string>()
    let since = 0
    let pages = 0
    for (;;) {
      const res = await app.inject({ method: 'GET', url: `/api/sync/pull?since=${since}`, headers: auth })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      for (const o of body.entities.orders ?? []) seen.add(o.id)
      since = body.serverTime
      pages++
      if (!body.hasMore || pages > 10) break
    }
    expect([...seen].sort()).toEqual([...orderIds].sort())
    expect(pages).toBeGreaterThan(1)
  })
})
