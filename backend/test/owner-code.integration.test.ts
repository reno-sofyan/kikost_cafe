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

suite('kode pembatalan Pemilik dari /ops (integrasi)', () => {
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
    const { _resetOwnerCodeThrottle } = await import('../src/lib/ownerCancelCodes.js')
    _resetOwnerCodeThrottle()
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

  const generate = async (tenant = 'kantin') => {
    const r = await app.inject({ method: 'POST', url: `/ops/api/tenant/${tenant}/owner-code`, headers: ops })
    expect(r.statusCode).toBe(200)
    return r.json() as { code: string; createdAt: number }
  }
  const consume = (code: string, headers = kantin) =>
    app.inject({ method: 'POST', url: '/api/sync/owner-code/consume', headers, payload: { code } })
  const status = async (tenant = 'kantin') =>
    (await app.inject({ method: 'GET', url: `/ops/api/tenant/${tenant}/owner-code`, headers: ops })).json()

  it('butuh token operator untuk membuat kode & kunci perangkat untuk memakainya', async () => {
    expect((await app.inject({ method: 'POST', url: '/ops/api/tenant/kantin/owner-code' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/api/sync/owner-code/consume', payload: { code: '123456' } })).statusCode).toBe(401)
  })

  it('kode 6 digit, sekali pakai, lalu status menunjukkan sudah dipakai', async () => {
    const { code, createdAt } = await generate()
    expect(code).toMatch(/^\d{6}$/)
    expect(await status()).toMatchObject({ active: { createdAt }, lastUsed: null })

    const ok = await consume(code)
    expect(ok.json()).toEqual({ ok: true, createdAt })
    expect((await consume(code)).json()).toEqual({ ok: false, reason: 'no_code' })
    expect(await status()).toMatchObject({ active: null, lastUsed: { createdAt } })
  })

  it('kode hanya berlaku untuk tenant-nya', async () => {
    const { code } = await generate('kantin')
    expect((await consume(code, other)).json()).toEqual({ ok: false, reason: 'no_code' })
    expect((await consume(code)).json()).toMatchObject({ ok: true })
  })

  it('kode baru menggantikan yang lama; hapus membuatnya tak berlaku', async () => {
    const first = await generate()
    const second = await generate()
    if (first.code !== second.code) expect((await consume(first.code)).json()).toEqual({ ok: false, reason: 'invalid' })
    await app.inject({ method: 'DELETE', url: '/ops/api/tenant/kantin/owner-code', headers: ops })
    expect((await consume(second.code)).json()).toEqual({ ok: false, reason: 'no_code' })
  })

  it('5× salah → terkunci sementara (kode benar pun ditolak)', async () => {
    const { code } = await generate()
    const wrong = code === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++) expect((await consume(wrong)).json()).toEqual({ ok: false, reason: 'invalid' })
    expect((await consume(code)).json()).toMatchObject({ ok: false, reason: 'locked' })
  })

  it('dua tablet memakai kode bersamaan → hanya satu yang berhasil', async () => {
    const { code } = await generate()
    const results = await Promise.all([consume(code), consume(code), consume(code)])
    expect(results.filter((r) => r.json().ok === true)).toHaveLength(1)
  })

  it('format kode salah ditolak 400', async () => {
    expect((await consume('12ab')).statusCode).toBe(400)
  })
})
