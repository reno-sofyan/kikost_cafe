import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { HAS_DB, resetDatabase, setupDatabase, teardownDatabase } from './helpers/db.js'
import { getPool } from '../src/db/pool.js'

const OPS_TOKEN = 'ops-token-test-0123456789abcdef0123456789abcdef'
process.env.OPS_TOKEN = OPS_TOKEN
process.env.SYNC_DEVICE_KEYS = process.env.SYNC_DEVICE_KEYS ?? 'cafe:env-cafe-key-0123456789abcdef'
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test'
process.env.LOG_LEVEL = 'silent'

const opsAuth = { authorization: `Bearer ${OPS_TOKEN}` }
const suite = HAS_DB ? describe : describe.skip

suite('konsol operator /ops (integrasi)', () => {
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

  it('menyajikan shell HTML tanpa token (tidak memuat data)', async () => {
    const r = await app.inject({ method: 'GET', url: '/ops' })
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toContain('text/html')
    expect(r.body).toContain('Konsol Operator')
  })

  it('menolak /ops/api/* tanpa token', async () => {
    const r = await app.inject({ method: 'GET', url: '/ops/api/summary' })
    expect(r.statusCode).toBe(401)
  })

  it('menolak token operator yang salah', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/ops/api/summary',
      headers: { authorization: 'Bearer token-salah' },
    })
    expect(r.statusCode).toBe(401)
  })

  it('summary: mengelompokkan omzet & perangkat per tenant', async () => {
    const now = Date.now()
    const pool = getPool()
    // Dua tenant dengan settings (nama + jenis usaha) berbeda.
    await pool.query(
      `INSERT INTO sync_entity_state (tenant_id, entity, entity_id, payload, entity_updated_at)
       VALUES
         ('cafe','settings','singleton',$1,$2),
         ('minimart','settings','singleton',$3,$2)`,
      [
        JSON.stringify({ id: 'singleton', businessName: 'Kopi Enak', businessType: 'cafe_resto', updatedAt: now }),
        now,
        JSON.stringify({ id: 'singleton', businessName: 'Toko Hemat', businessType: 'minimarket', updatedAt: now }),
      ],
    )
    // Order paid hari ini di tenant cafe.
    await pool.query(
      `INSERT INTO sync_entity_state (tenant_id, entity, entity_id, payload, entity_updated_at)
       VALUES ('cafe','orders','o1',$1,$2)`,
      [
        JSON.stringify({ id: 'o1', orderNumber: 'TRX-1', status: 'paid', grandTotal: 25000, createdAt: now, paidAt: now }),
        now,
      ],
    )

    const r = await app.inject({ method: 'GET', url: '/ops/api/summary', headers: opsAuth })
    expect(r.statusCode).toBe(200)
    const body = r.json()
    expect(body.tenantCount).toBe(2)
    const cafe = body.tenants.find((t: { tenantId: string }) => t.tenantId === 'cafe')
    expect(cafe.businessName).toBe('Kopi Enak')
    expect(cafe.businessType).toBe('cafe_resto')
    expect(cafe.today.revenue).toBe(25000)
    expect(cafe.today.txns).toBe(1)
  })

  it('detail tenant: total omzet, transaksi, dan log aktivitas', async () => {
    const now = Date.now()
    const pool = getPool()
    await pool.query(
      `INSERT INTO sync_entity_state (tenant_id, entity, entity_id, payload, entity_updated_at)
       VALUES
         ('cafe','orders','o1',$1,$2),
         ('cafe','auditLogs','a1',$3,$2)`,
      [
        JSON.stringify({ id: 'o1', orderNumber: 'TRX-1', status: 'paid', grandTotal: 40000, createdAt: now, paidAt: now }),
        now,
        JSON.stringify({ id: 'a1', userName: 'Budi', action: 'auth.login', entityType: 'user', details: 'masuk', createdAt: now }),
      ],
    )

    const r = await app.inject({ method: 'GET', url: '/ops/api/tenant/cafe', headers: opsAuth })
    expect(r.statusCode).toBe(200)
    const body = r.json()
    expect(body.totals.revenue).toBe(40000)
    expect(body.totals.txns).toBe(1)
    expect(body.orders).toHaveLength(1)
    expect(body.auditLogs[0]).toMatchObject({ userName: 'Budi', action: 'auth.login' })
  })

  it('menolak tenantId tidak valid', async () => {
    const r = await app.inject({ method: 'GET', url: '/ops/api/tenant/..%2Fetc', headers: opsAuth })
    expect(r.statusCode).toBe(400)
  })
})

suite('konsol operator nonaktif tanpa OPS_TOKEN', () => {
  it('seluruh /ops mengembalikan 404 bila OPS_TOKEN kosong', async () => {
    const prev = process.env.OPS_TOKEN
    delete process.env.OPS_TOKEN
    const { resetConfigCache } = await import('../src/config.js')
    resetConfigCache()
    const { buildServer } = await import('../src/server.js')
    const app = await buildServer()
    await app.ready()
    try {
      const html = await app.inject({ method: 'GET', url: '/ops' })
      expect(html.statusCode).toBe(404)
      const api = await app.inject({ method: 'GET', url: '/ops/api/summary' })
      expect(api.statusCode).toBe(404)
    } finally {
      await app.close()
      if (prev !== undefined) process.env.OPS_TOKEN = prev
      resetConfigCache()
    }
  })
})
