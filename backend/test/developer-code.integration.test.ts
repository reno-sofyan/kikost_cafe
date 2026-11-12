import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, expect, it, describe } from 'vitest'
import { HAS_DB, resetDatabase, setupDatabase, teardownDatabase } from './helpers/db.js'

const OPS_TOKEN = 'ops-token-test-0123456789abcdef0123456789abcdef'
const KANTIN_KEY = 'kantin-device-key-0123456789abcdef'
const OTHER_KEY = 'other-device-key-0123456789abcdef'
const ops = { authorization: `Bearer ${OPS_TOKEN}` }
const kantin = { authorization: `Bearer ${KANTIN_KEY}` }
const other = { authorization: `Bearer ${OTHER_KEY}` }

const suite = HAS_DB ? describe : describe.skip

suite('token Mode Developer dari /ops (integrasi)', () => {
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
    await getPool().query('DELETE FROM developer_access_codes')
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
    const r = await app.inject({ method: 'POST', url: `/ops/api/tenant/${tenant}/developer-code`, headers: ops })
    expect(r.statusCode).toBe(200)
    return r.json() as { code: string; createdAt: number; expiresAt: number }
  }
  const consume = (code: string, headers = kantin) => app.inject({ method: 'POST', url: '/api/sync/developer-code/consume', headers, payload: { code } })
  const status = async (tenant = 'kantin') => (await app.inject({ method: 'GET', url: `/ops/api/tenant/${tenant}/developer-code`, headers: ops })).json()
  const wrong = (code: string) => String((Number(code) + 1) % 10_000).padStart(4, '0')

  it('butuh token operator untuk membuat & kunci perangkat untuk memakai', async () => {
    expect((await app.inject({ method: 'POST', url: '/ops/api/tenant/kantin/developer-code' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/api/sync/developer-code/consume', payload: { code: '1234' } })).statusCode).toBe(401)
  })

  it('4 angka, berlaku ±10 menit, sekali pakai', async () => {
    const { code, createdAt, expiresAt } = await generate()
    expect(code).toMatch(/^\d{4}$/)
    expect(expiresAt - createdAt).toBeGreaterThanOrEqual(9 * 60_000)
    expect(await status()).toMatchObject({ active: { createdAt, failedCount: 0 } })
    expect((await consume(code)).json()).toEqual({ ok: true, createdAt })
    expect((await consume(code)).json()).toEqual({ ok: false, reason: 'no_code' })
    expect(await status()).toMatchObject({ active: null, last: { reason: 'used' } })
  })

  it('hangus setelah 5x salah — tebakan beruntun tak bisa menghabiskan 10.000 kemungkinan', async () => {
    const { code } = await generate()
    for (let left = 4; left >= 1; left--) expect((await consume(wrong(code))).json()).toEqual({ ok: false, reason: 'invalid', attemptsLeft: left })
    expect((await consume(wrong(code))).json()).toEqual({ ok: false, reason: 'burned' })
    expect((await consume(code)).json()).toEqual({ ok: false, reason: 'no_code' })
    expect(await status()).toMatchObject({ active: null, last: { reason: 'burned' } })
  })

  it('kedaluwarsa, dicabut, dan terisolasi per tenant', async () => {
    const { code } = await generate()
    expect((await consume(code, other)).json()).toEqual({ ok: false, reason: 'no_code' })
    const { getPool } = await import('../src/db/pool.js')
    await getPool().query(`UPDATE developer_access_codes SET expires_at = now() - interval '1 second' WHERE tenant_id = 'kantin'`)
    expect((await consume(code)).json()).toEqual({ ok: false, reason: 'expired' })

    const fresh = await generate()
    expect((await app.inject({ method: 'DELETE', url: '/ops/api/tenant/kantin/developer-code', headers: ops })).statusCode).toBe(200)
    expect((await consume(fresh.code)).json()).toEqual({ ok: false, reason: 'no_code' })
    expect(await status()).toMatchObject({ active: null, last: { reason: 'revoked' } })
  })

  it('format token salah ditolak 400', async () => {
    expect((await consume('12a4')).statusCode).toBe(400)
  })
})
