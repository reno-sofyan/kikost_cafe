import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { HAS_DB, resetDatabase, setupDatabase, teardownDatabase } from './helpers/db.js'
import { getPool } from '../src/db/pool.js'

process.env.SYNC_DEVICE_KEYS = process.env.SYNC_DEVICE_KEYS ?? 'test-device-key-0123456789abcdef'
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test'
process.env.LOG_LEVEL = 'silent'

const suite = HAS_DB ? describe : describe.skip

const ORDER_ID = '3f2b8c1e-9a4d-4e2f-8b1a-0c9d8e7f6a5b'

async function seedEntity(entity: string, id: string, payload: Record<string, unknown>): Promise<void> {
  await getPool().query(
    `INSERT INTO sync_entity_state (entity, entity_id, payload, entity_updated_at, server_seq)
     VALUES ($1, $2, $3::jsonb, $4, nextval('sync_server_seq'))`,
    [entity, id, JSON.stringify(payload), Number(payload.updatedAt ?? 1)],
  )
}

async function seed(order: Record<string, unknown> = {}): Promise<void> {
  await seedEntity('settings', 'singleton', { id: 'singleton', businessName: 'Kinara Cafe', googleReviewUrl: 'https://g.page/r/kinara/review', updatedAt: 1 })
  await seedEntity('orders', ORDER_ID, { id: ORDER_ID, orderNumber: 'TRX-00128', status: 'paid', lifecycleStatus: 'COMPLETED', paidAt: 1761200000000, updatedAt: 1, ...order })
}

suite('ulasan tamu dari QR struk (integrasi)', () => {
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

  it('GET → nama usaha, nomor struk, tautan Google; belum ada ulasan', async () => {
    await seed()
    const res = await app.inject({ method: 'GET', url: `/api/ulasan/${ORDER_ID}` })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ business: { name: 'Kinara Cafe' }, orderNumber: 'TRX-00128', review: null, googleReviewUrl: 'https://g.page/r/kinara/review' })
  })

  it('POST → entri Log Aktivitas feedback.rating berantai; ulasan kedua ditolak', async () => {
    await seed()
    const res = await app.inject({ method: 'POST', url: `/api/ulasan/${ORDER_ID}`, payload: { rating: 5, comment: '  Kopinya   enak ' } })
    expect(res.statusCode).toBe(201)
    expect(res.json().review).toEqual({ rating: 5, comment: 'Kopinya enak' })

    const { rows } = await getPool().query<{ payload: Record<string, unknown> }>("SELECT payload FROM sync_entity_state WHERE entity = 'auditLogs'")
    expect(rows).toHaveLength(1)
    expect(rows[0].payload).toMatchObject({
      action: 'feedback.rating', entityType: 'feedback', entityId: ORDER_ID, deviceId: 'server-ulasan', deviceSeq: 1, prevHash: null,
      details: 'Penilaian tamu ★5/5 untuk TRX-00128. Komentar: Kopinya enak',
    })

    const again = await app.inject({ method: 'POST', url: `/api/ulasan/${ORDER_ID}`, payload: { rating: 1 } })
    expect(again.statusCode).toBe(409)
    const page = await app.inject({ method: 'GET', url: `/api/ulasan/${ORDER_ID}` })
    expect(page.json().review).toEqual({ rating: 5, comment: 'Kopinya enak' })
  })

  it('order belum lunas / dibatalkan / tak dikenal ditolak; bintang di luar 1–5 ditolak', async () => {
    await seed({ status: 'open', lifecycleStatus: 'OPEN' })
    expect((await app.inject({ method: 'POST', url: `/api/ulasan/${ORDER_ID}`, payload: { rating: 4 } })).statusCode).toBe(409)
    await resetDatabase()
    await seed({ status: 'void', lifecycleStatus: 'CANCELLED' })
    expect((await app.inject({ method: 'GET', url: `/api/ulasan/${ORDER_ID}` })).statusCode).toBe(410)
    expect((await app.inject({ method: 'GET', url: '/api/ulasan/00000000-0000-4000-8000-000000000000' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/ulasan/TRX-00128' })).statusCode).toBe(404)
    await resetDatabase()
    await seed()
    expect((await app.inject({ method: 'POST', url: `/api/ulasan/${ORDER_ID}`, payload: { rating: 6 } })).statusCode).toBe(400)
  })
})
