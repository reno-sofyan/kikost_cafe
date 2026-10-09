import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { HAS_DB, resetDatabase, setupDatabase, teardownDatabase } from './helpers/db.js'
import { getPool } from '../src/db/pool.js'

const OPS_TOKEN = 'ops-token-test-0123456789abcdef0123456789abcdef'
const KANTIN_KEY = 'kantin-device-key-0123456789abcdef'
const ops = { authorization: `Bearer ${OPS_TOKEN}` }
const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

const suite = HAS_DB ? describe : describe.skip

suite('konsol Pemilik /owner (integrasi)', () => {
  let app: FastifyInstance
  const saved: Record<string, string | undefined> = {}

  beforeAll(async () => {
    for (const k of ['SYNC_DEVICE_KEYS', 'OPS_TOKEN', 'LOG_LEVEL']) saved[k] = process.env[k]
    process.env.SYNC_DEVICE_KEYS = `kantin:${KANTIN_KEY}`
    process.env.OPS_TOKEN = OPS_TOKEN
    process.env.LOG_LEVEL = 'silent'
    await setupDatabase()
    const { resetConfigCache } = await import('../src/config.js')
    resetConfigCache()
    const { buildServer } = await import('../src/server.js')
    app = await buildServer()
    await app.ready()
  })
  afterEach(async () => {
    const { _resetAuthThrottle } = await import('../src/lib/authThrottle.js')
    _resetAuthThrottle()
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

  const createAccess = async (tenant: string, label = 'HP Pemilik') => {
    const r = await app.inject({ method: 'POST', url: `/ops/api/tenant/${tenant}/owner-access`, headers: ops, payload: { label } })
    expect(r.statusCode).toBe(200)
    return r.json() as { id: string; token: string; label: string; createdAt: number }
  }

  const seed = async () => {
    const now = Date.now()
    const rows: [string, string, string, Record<string, unknown>][] = [
      ['kantin', 'settings', 'singleton', { id: 'singleton', businessName: 'Kantin Bu Sari', businessType: 'kantin', updatedAt: now }],
      ['kantin', 'orders', 'o1', { id: 'o1', orderNumber: 'TRX-1', status: 'paid', grandTotal: 25000, createdAt: now, paidAt: now }],
      ['kantin', 'orders', 'v1', { id: 'v1', orderNumber: 'TRX-2', status: 'void', grandTotal: 8000, createdAt: now, voidedAt: now, voidReason: 'Salah input', updatedAt: now }],
      ['kantin', 'auditLogs', 'a1', { id: 'a1', userName: 'Andi', action: 'auth.login', details: 'masuk', createdAt: now }],
      // Tenant lain — tidak boleh terlihat dari token kantin.
      ['cafe', 'settings', 'singleton', { id: 'singleton', businessName: 'Kopi Enak', businessType: 'cafe_resto', updatedAt: now }],
      ['cafe', 'orders', 'c1', { id: 'c1', orderNumber: 'CAFE-1', status: 'paid', grandTotal: 99000, createdAt: now, paidAt: now }],
    ]
    for (const [tenant, entity, id, payload] of rows) {
      await getPool().query(
        `INSERT INTO sync_entity_state (tenant_id, entity, entity_id, payload, entity_updated_at) VALUES ($1,$2,$3,$4,$5)`,
        [tenant, entity, id, JSON.stringify(payload), now],
      )
    }
  }

  it('menyajikan shell HTML tanpa token, tanpa data & tanpa referrer', async () => {
    const r = await app.inject({ method: 'GET', url: '/owner' })
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toContain('text/html')
    expect(r.headers['referrer-policy']).toBe('no-referrer')
    expect(r.body).toContain('Konsol Pemilik')
  })

  it('membuat tautan akses butuh token operator; token polos hanya di respons pembuatan', async () => {
    expect((await app.inject({ method: 'POST', url: '/ops/api/tenant/kantin/owner-access', payload: {} })).statusCode).toBe(401)
    const created = await createAccess('kantin', '  HP Bu Sari  ')
    expect(created.token).toMatch(/^kio_[A-Za-z0-9_-]{40,}$/)
    expect(created.label).toBe('HP Bu Sari')

    const list = (await app.inject({ method: 'GET', url: '/ops/api/tenant/kantin/owner-access', headers: ops })).json()
    expect(list.tokens).toHaveLength(1)
    expect(list.tokens[0]).toMatchObject({ id: created.id, label: 'HP Bu Sari', lastUsedAt: null })
    expect(JSON.stringify(list)).not.toContain(created.token)

    const { rows } = await getPool().query<{ token_hash: string }>('SELECT token_hash FROM owner_access_tokens')
    expect(rows[0].token_hash).not.toContain(created.token)
  })

  it('menolak /owner/api tanpa token, token salah, atau token operator', async () => {
    expect((await app.inject({ method: 'GET', url: '/owner/api/overview' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/owner/api/overview', headers: bearer('kio_salah') })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/owner/api/overview', headers: ops })).statusCode).toBe(401)
  })

  it('ringkasan & detail hanya berisi data tenant pemilik token', async () => {
    await seed()
    const { token } = await createAccess('kantin')

    const ov = await app.inject({ method: 'GET', url: '/owner/api/overview', headers: bearer(token) })
    expect(ov.statusCode).toBe(200)
    expect(ov.json()).toMatchObject({
      tenantId: 'kantin',
      businessName: 'Kantin Bu Sari',
      businessType: 'kantin',
      today: { revenue: 25000, txns: 1 },
      cancellations: { todayCount: 1, todayValue: 8000 },
    })

    const detail = (await app.inject({ method: 'GET', url: '/owner/api/detail', headers: bearer(token) })).json()
    expect(detail.totals.revenue).toBe(25000)
    expect(detail.orders.map((o: { orderNumber: string }) => o.orderNumber).sort()).toEqual(['TRX-1', 'TRX-2'])
    expect(detail.auditLogs[0]).toMatchObject({ userName: 'Andi' })

    const cancels = (await app.inject({ method: 'GET', url: '/owner/api/cancellations?days=7', headers: bearer(token) })).json()
    expect(cancels.totals.count).toBe(1)

    const { rows } = await getPool().query<{ last_used_at: Date | null }>('SELECT last_used_at FROM owner_access_tokens')
    expect(rows[0].last_used_at).not.toBeNull()
  })

  it('export PDF ter-scope ke tenant token', async () => {
    await seed()
    const { token } = await createAccess('kantin')
    const r = await app.inject({ method: 'GET', url: '/owner/api/export/transactions.pdf', headers: bearer(token) })
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toBe('application/pdf')
    expect(r.headers['content-disposition']).toContain('transaksi-kantin-')
    expect((await app.inject({ method: 'GET', url: '/owner/api/export/x.pdf', headers: bearer(token) })).statusCode).toBe(404)
    expect(
      (await app.inject({ method: 'GET', url: '/owner/api/export/transactions.pdf?from=2026-13-01', headers: bearer(token) })).statusCode,
    ).toBe(400)
  })

  it('Pemilik membuat kode pembatalan sendiri; tablet tenant itu bisa memakainya', async () => {
    const { token } = await createAccess('kantin')
    const gen = await app.inject({ method: 'POST', url: '/owner/api/owner-code', headers: bearer(token) })
    expect(gen.statusCode).toBe(200)
    const { code } = gen.json() as { code: string }
    expect(code).toMatch(/^\d{6}$/)

    // Status sama terlihat dari /ops (satu kode aktif per tenant).
    const opsStatus = (await app.inject({ method: 'GET', url: '/ops/api/tenant/kantin/owner-code', headers: ops })).json()
    expect(opsStatus.active).not.toBeNull()

    const consume = await app.inject({
      method: 'POST',
      url: '/api/sync/owner-code/consume',
      headers: bearer(KANTIN_KEY),
      payload: { code },
    })
    expect(consume.json()).toMatchObject({ ok: true })

    const st = (await app.inject({ method: 'GET', url: '/owner/api/owner-code', headers: bearer(token) })).json()
    expect(st.active).toBeNull()
    expect(st.lastUsed).not.toBeNull()
  })

  it('akses yang dicabut langsung ditolak; pencabutan ter-scope ke tenant', async () => {
    const kantin = await createAccess('kantin')
    const cafe = await createAccess('cafe')

    // Mencabut id milik tenant lain lewat tenant yang salah → 404, akses tetap hidup.
    const wrong = await app.inject({ method: 'DELETE', url: `/ops/api/tenant/kantin/owner-access/${cafe.id}`, headers: ops })
    expect(wrong.statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/owner/api/overview', headers: bearer(cafe.token) })).statusCode).toBe(200)

    const ok = await app.inject({ method: 'DELETE', url: `/ops/api/tenant/kantin/owner-access/${kantin.id}`, headers: ops })
    expect(ok.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/owner/api/overview', headers: bearer(kantin.token) })).statusCode).toBe(401)
    const list = (await app.inject({ method: 'GET', url: '/ops/api/tenant/kantin/owner-access', headers: ops })).json()
    expect(list.tokens).toHaveLength(0)

    expect((await app.inject({ method: 'DELETE', url: '/ops/api/tenant/kantin/owner-access/bukan-uuid', headers: ops })).statusCode).toBe(404)
  })

  it('percobaan token salah berulang memblokir IP sementara', async () => {
    const { token } = await createAccess('kantin')
    for (let i = 0; i < 10; i++) {
      await app.inject({ method: 'GET', url: '/owner/api/overview', headers: bearer(`kio_tebakan${i}`) })
    }
    expect((await app.inject({ method: 'GET', url: '/owner/api/overview', headers: bearer(token) })).statusCode).toBe(429)
  })
})
