import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, expect, it, describe } from 'vitest'
import { HAS_DB, resetDatabase, setupDatabase, teardownDatabase } from './helpers/db.js'

const OPS_TOKEN = 'ops-token-test-0123456789abcdef0123456789abcdef'
const KANTIN_KEY = 'kantin-device-key-0123456789abcdef'
const OTHER_KEY = 'other-device-key-0123456789abcdef'
const ops = { authorization: `Bearer ${OPS_TOKEN}` }
const kantin = { authorization: `Bearer ${KANTIN_KEY}` }

const suite = HAS_DB ? describe : describe.skip

suite('kode pasang tablet baru dari /ops (integrasi)', () => {
  let app: FastifyInstance
  const saved: Record<string, string | undefined> = {}

  beforeAll(async () => {
    for (const k of ['SYNC_DEVICE_KEYS', 'OPS_TOKEN', 'LOG_LEVEL']) saved[k] = process.env[k]
    process.env.SYNC_DEVICE_KEYS = `kantin:${KANTIN_KEY},other:${OTHER_KEY}`
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
    await resetDatabase()
    const { getPool } = await import('../src/db/pool.js')
    await getPool().query('DELETE FROM device_pairing_codes')
    const { _resetAuthThrottle } = await import('../src/lib/authThrottle.js')
    _resetAuthThrottle()
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

  const generate = async (tenant = 'kantin') => {
    const r = await app.inject({ method: 'POST', url: `/ops/api/tenant/${tenant}/pairing-code`, headers: ops })
    expect(r.statusCode).toBe(200)
    return r.json() as { code: string; createdAt: number; expiresAt: number }
  }
  const pair = (code: string, label = 'Tablet Kasir 2') => app.inject({ method: 'POST', url: '/api/pair', payload: { code, label } })

  it('butuh token operator untuk membuat kode', async () => {
    expect((await app.inject({ method: 'POST', url: '/ops/api/tenant/kantin/pairing-code' })).statusCode).toBe(401)
  })

  it('kode XXXX-XXXX ditukar jadi kunci perangkat baru milik tenant itu, sekali pakai', async () => {
    const { code, createdAt, expiresAt } = await generate()
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(expiresAt - createdAt).toBeGreaterThanOrEqual(29 * 60_000)

    const r = (await pair(code.toLowerCase().replace('-', ' '))).json()
    expect(r).toMatchObject({ ok: true, tenantId: 'kantin' })
    expect(r.deviceKey).toMatch(/^[0-9a-f]{64}$/)

    // Kunci baru langsung sah untuk tenant itu (lihat whoami) dan bisa memakai token developer.
    const who = await app.inject({ method: 'GET', url: '/api/sync/whoami', headers: { authorization: `Bearer ${r.deviceKey}` } })
    expect(who.statusCode).toBe(200)
    expect(JSON.stringify(who.json())).toContain('kantin')
    const devices = await app.inject({ method: 'GET', url: '/api/devices', headers: kantin })
    expect(devices.json().devices.map((d: { label: string }) => d.label)).toContain('Tablet Kasir 2')

    expect((await pair(code)).json()).toEqual({ ok: false, reason: 'invalid' })
    expect(await (await app.inject({ method: 'GET', url: '/ops/api/tenant/kantin/pairing-code', headers: ops })).json()).toMatchObject({ active: null, last: { reason: 'used' } })
  })

  it('kedaluwarsa & dicabut tak bisa dipakai; format salah ditolak', async () => {
    const { code } = await generate()
    const { getPool } = await import('../src/db/pool.js')
    await getPool().query(`UPDATE device_pairing_codes SET expires_at = now() - interval '1 second' WHERE tenant_id = 'kantin'`)
    expect((await pair(code)).json()).toEqual({ ok: false, reason: 'expired' })
    const fresh = await generate()
    await app.inject({ method: 'DELETE', url: '/ops/api/tenant/kantin/pairing-code', headers: ops })
    expect((await pair(fresh.code)).json()).toEqual({ ok: false, reason: 'invalid' })
    expect((await pair('0000-OOOO')).statusCode).toBe(400)
  })

  it('tebakan beruntun dari satu IP diblokir sementara', async () => {
    let last = 0
    for (let i = 0; i < 12; i++) last = (await pair('ABCD-EFGH')).statusCode
    expect(last).toBe(429)
  })
})
