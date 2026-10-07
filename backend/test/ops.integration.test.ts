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

  it('pembatalan: ringkasan hari ini & rekap per tenant dengan peminta/penyetuju', async () => {
    const now = Date.now()
    const pool = getPool()
    const rows: [string, string, Record<string, unknown>][] = [
      ['orders', 'v1', { id: 'v1', orderNumber: 'TRX-7', status: 'void', lifecycleStatus: 'VOIDED', grandTotal: 30000, createdAt: now, paidAt: now, voidedAt: now, voidReason: 'Komplain', cashierName: 'Andi', voidRequestedByName: 'Andi', voidedByName: 'Bu Sari', voidApproval: 'owner_code', updatedAt: now }],
      ['orders', 'v2', { id: 'v2', orderNumber: 'TRX-8', status: 'void', lifecycleStatus: 'CANCELLED', grandTotal: 12000, createdAt: now, voidedAt: now, voidReason: 'Salah input', cashierName: 'Andi', updatedAt: now }],
      ['orders', 'v3', { id: 'v3', orderNumber: 'TRX-9', status: 'void', lifecycleStatus: 'CANCELLED', grandTotal: 0, createdAt: now, voidedAt: now, updatedAt: now }],
      ['orders', 'old', { id: 'old', orderNumber: 'TRX-1', status: 'void', grandTotal: 9000, createdAt: now - 40 * 86_400_000, voidedAt: now - 40 * 86_400_000, updatedAt: now - 40 * 86_400_000 }],
      ['auditLogs', 'a2', { id: 'a2', userName: 'Andi', action: 'order.cancel', entityType: 'order', entityId: 'v2', details: 'Pesanan TRX-8 dibatalkan. Alasan: Salah input', createdAt: now }],
      // v4: dikosongkan dulu (item dihapus) lalu dibatalkan sebagai pesanan Rp0.
      ['orders', 'v4', { id: 'v4', orderNumber: 'TRX-10', status: 'void', lifecycleStatus: 'CANCELLED', grandTotal: 0, createdAt: now, voidedAt: now, voidReason: 'Pesanan kosong dibatalkan', cashierName: 'Andi', updatedAt: now }],
      ['orderItems', 'i4a', { id: 'i4a', orderId: 'v4', productName: 'Ayam Geprek', qty: 2, lineTotal: 36000, removed: true, voided: false, updatedAt: now }],
      ['orderItems', 'i4b', { id: 'i4b', orderId: 'v4', productName: 'Es Jeruk', qty: 1, lineTotal: 6000, removed: true, voided: false, updatedAt: now }],
      ['auditLogs', 'a4', { id: 'a4', userName: 'Andi', action: 'order.cancelEmpty', entityType: 'order', entityId: 'v4', details: 'Pesanan kosong TRX-10 dibatalkan (tidak ada item).', createdAt: now }],
    ]
    for (const [entity, id, payload] of rows) {
      await pool.query(
        `INSERT INTO sync_entity_state (tenant_id, entity, entity_id, payload, entity_updated_at) VALUES ('cafe',$1,$2,$3,$4)`,
        [entity, id, JSON.stringify(payload), now],
      )
    }

    const summary = (await app.inject({ method: 'GET', url: '/ops/api/summary', headers: opsAuth })).json()
    const cafe = summary.tenants.find((t: { tenantId: string }) => t.tenantId === 'cafe')
    // Semua void dihitung: v1 30rb + v2 12rb + v3 Rp0 tanpa item + v4 dikosongkan (42rb item dihapus).
    expect(cafe.cancellations).toEqual({ todayCount: 4, todayValue: 84000, last7DaysCount: 4, last7DaysValue: 84000 })

    const r = await app.inject({ method: 'GET', url: '/ops/api/tenant/cafe/cancellations?days=30', headers: opsAuth })
    expect(r.statusCode).toBe(200)
    const body = r.json()
    expect(body.totals).toMatchObject({
      count: 4,
      value: 84000,
      paidCount: 1,
      paidValue: 30000,
      ownerCodeCount: 1,
      emptiedFirstCount: 1,
      emptiedFirstValue: 42000,
      neverHadItemsCount: 1,
    })
    const v4 = body.rows.find((x: { orderId: string }) => x.orderId === 'v4')
    expect(v4).toMatchObject({ emptiedFirst: true, value: 42000, requestedBy: 'Andi' })
    expect(v4.corrections).toHaveLength(2)
    const v1 = body.rows.find((x: { orderId: string }) => x.orderId === 'v1')
    expect(v1).toMatchObject({ stage: 'paid', requestedBy: 'Andi', approvedBy: 'Bu Sari', approval: 'owner_code' })
    const v2 = body.rows.find((x: { orderId: string }) => x.orderId === 'v2')
    expect(v2).toMatchObject({ stage: 'unprocessed', requestedBy: 'Andi', approval: 'self' })

    const wide = (await app.inject({ method: 'GET', url: '/ops/api/tenant/cafe/cancellations?days=90', headers: opsAuth })).json()
    expect(wide.totals.count).toBe(5)

    const noAuth = await app.inject({ method: 'GET', url: '/ops/api/tenant/cafe/cancellations' })
    expect(noAuth.statusCode).toBe(401)
  })

  it('summary: omzet di beberapa hari (sparkline 7 hari) tidak 500 & tanggal berupa YYYY-MM-DD', async () => {
    const now = Date.now()
    const pool = getPool()
    for (const [i, ago] of [0, 1, 2].entries()) {
      const at = now - ago * 86_400_000
      await pool.query(
        `INSERT INTO sync_entity_state (tenant_id, entity, entity_id, payload, entity_updated_at) VALUES ('kantin','orders',$1,$2,$3)`,
        [`d${i}`, JSON.stringify({ id: `d${i}`, status: 'paid', grandTotal: 1000 * (i + 1), createdAt: at, paidAt: at }), now],
      )
    }
    const r = await app.inject({ method: 'GET', url: '/ops/api/summary', headers: opsAuth })
    expect(r.statusCode).toBe(200)
    const kantin = r.json().tenants.find((t: { tenantId: string }) => t.tenantId === 'kantin')
    expect(kantin.last7Days).toHaveLength(3)
    for (const d of kantin.last7Days) expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const dates = kantin.last7Days.map((d: { date: string }) => d.date)
    expect([...dates].sort()).toEqual(dates)
  })

  it('data payload rusak tidak membuat dashboard 500 (baris rusak dilewati)', async () => {
    const now = Date.now()
    const pool = getPool()
    const rows: [string, Record<string, unknown>][] = [
      ['ok', { id: 'ok', orderNumber: 'TRX-1', status: 'paid', grandTotal: 10000, createdAt: now, paidAt: now }],
      ['iso', { id: 'iso', orderNumber: 'TRX-2', status: 'paid', grandTotal: 5000, createdAt: new Date(now).toISOString(), paidAt: '' }],
      ['frac', { id: 'frac', orderNumber: 'TRX-3', status: 'paid', grandTotal: 2500.5, createdAt: now + 0.75, paidAt: now + 0.75 }],
      ['junk', { id: 'junk', orderNumber: 'TRX-4', status: 'void', grandTotal: 'abc', createdAt: 'kemarin', voidedAt: 'x', updatedAt: now }],
      ['huge', { id: 'huge', orderNumber: 'TRX-5', status: 'paid', grandTotal: 1000, createdAt: 9e20, paidAt: 9e20 }],
    ]
    for (const [id, payload] of rows) {
      await pool.query(
        `INSERT INTO sync_entity_state (tenant_id, entity, entity_id, payload, entity_updated_at) VALUES ('cafe','orders',$1,$2,$3)`,
        [id, JSON.stringify(payload), now],
      )
    }
    const summary = await app.inject({ method: 'GET', url: '/ops/api/summary', headers: opsAuth })
    expect(summary.statusCode).toBe(200)
    const cafe = summary.json().tenants.find((t: { tenantId: string }) => t.tenantId === 'cafe')
    expect(cafe.today.revenue).toBe(12500.5)

    const detail = await app.inject({ method: 'GET', url: '/ops/api/tenant/cafe', headers: opsAuth })
    expect(detail.statusCode).toBe(200)
    const cancels = await app.inject({ method: 'GET', url: '/ops/api/tenant/cafe/cancellations', headers: opsAuth })
    expect(cancels.statusCode).toBe(200)
  })

  it('export PDF transaksi & pembatalan: butuh token, validasi tanggal, hasil application/pdf', async () => {
    const now = Date.now()
    const pool = getPool()
    for (const [entity, id, payload] of [
      ['settings', 'singleton', { id: 'singleton', businessName: 'Kantin Sehat', businessType: 'kantin' }],
      ['orders', 'p1', { id: 'p1', orderNumber: 'TRX-1', status: 'paid', grandTotal: 25000, createdAt: now, paidAt: now, cashierName: 'Rina' }],
      ['payments', 'pay1', { id: 'pay1', orderId: 'p1', method: 'qris', amount: 25000, createdAt: now }],
      ['orders', 'v1', { id: 'v1', orderNumber: 'TRX-2', status: 'void', grandTotal: 12000, createdAt: now, voidedAt: now, voidReason: 'Salah input' }],
      ['orders', 'g1', { id: 'g1', orderNumber: 'TRX-3', status: 'open', grandTotal: 9000, createdAt: now, payLater: { name: 'Pak Budi', markedAt: now } }],
    ] as [string, string, Record<string, unknown>][]) {
      await pool.query(
        `INSERT INTO sync_entity_state (tenant_id, entity, entity_id, payload, entity_updated_at) VALUES ('kantin',$1,$2,$3,$4)`,
        [entity, id, JSON.stringify(payload), now],
      )
    }
    const today = new Date(now + 7 * 3_600_000).toISOString().slice(0, 10)
    for (const kind of ['transactions.pdf', 'cancellations.pdf']) {
      const r = await app.inject({ method: 'GET', url: `/ops/api/tenant/kantin/export/${kind}?from=${today}&to=${today}`, headers: opsAuth })
      expect(r.statusCode).toBe(200)
      expect(r.headers['content-type']).toBe('application/pdf')
      expect(String(r.headers['content-disposition'])).toContain(`-kantin-${today}.pdf`)
      expect(r.rawPayload.subarray(0, 5).toString()).toBe('%PDF-')
    }
    const noAuth = await app.inject({ method: 'GET', url: '/ops/api/tenant/kantin/export/transactions.pdf' })
    expect(noAuth.statusCode).toBe(401)
    const bad = await app.inject({ method: 'GET', url: '/ops/api/tenant/kantin/export/transactions.pdf?from=2026-13-40', headers: opsAuth })
    expect(bad.statusCode).toBe(400)
    const unknown = await app.inject({ method: 'GET', url: '/ops/api/tenant/kantin/export/x.pdf', headers: opsAuth })
    expect(unknown.statusCode).toBe(404)
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
