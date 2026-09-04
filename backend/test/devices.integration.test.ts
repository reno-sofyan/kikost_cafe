import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { HAS_DB, resetDatabase, setupDatabase, teardownDatabase } from './helpers/db.js'
import { hashDeviceKey } from '../src/lib/deviceAuth.js'
import { getPool } from '../src/db/pool.js'

const ENV_KEY = 'env-device-key-0123456789abcdef'
process.env.SYNC_DEVICE_KEYS = ENV_KEY
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test'
process.env.LOG_LEVEL = 'silent'

const suite = HAS_DB ? describe : describe.skip
const auth = { authorization: `Bearer ${ENV_KEY}` }

suite('device management API (integrasi)', () => {
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

  it('menolak tanpa kunci perangkat', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/devices' })
    expect(r.statusCode).toBe(401)
  })

  it('enroll → list → rename → revoke; kunci dicabut ditolak di /api/sync', async () => {
    const NEW_KEY = 'tablet-bar-key-fedcba9876543210'
    const enroll = await app.inject({
      method: 'POST', url: '/api/devices/enroll', headers: auth,
      payload: { label: 'Tablet Bar', deviceKey: NEW_KEY },
    })
    expect(enroll.statusCode).toBe(201)
    const id = enroll.json().id

    const list = await app.inject({ method: 'GET', url: '/api/devices', headers: auth })
    expect(list.json().devices).toHaveLength(1)
    expect(list.json().devices[0]).toMatchObject({ label: 'Tablet Bar', revoked: false })

    // kunci baru bisa dipakai sync
    const okSync = await app.inject({
      method: 'POST', url: '/api/sync/push',
      headers: { authorization: `Bearer ${NEW_KEY}` },
      payload: { deviceId: id, items: [] },
    })
    expect(okSync.statusCode).toBe(200)

    await app.inject({ method: 'POST', url: `/api/devices/${id}/rename`, headers: auth, payload: { label: 'Tablet Dapur' } })
    await app.inject({ method: 'POST', url: `/api/devices/${id}/revoke`, headers: auth })

    const after = await app.inject({ method: 'GET', url: '/api/devices', headers: auth })
    expect(after.json().devices[0]).toMatchObject({ label: 'Tablet Dapur', revoked: true })

    const blocked = await app.inject({
      method: 'POST', url: '/api/sync/push',
      headers: { authorization: `Bearer ${NEW_KEY}` },
      payload: { deviceId: id, items: [] },
    })
    expect(blocked.statusCode).toBe(401)
  })

  it('enroll ulang kunci yang dicabut → reaktivasi', async () => {
    const K = 'reactivate-key-1111222233334444'
    const hash = hashDeviceKey(K)
    await getPool().query('INSERT INTO sync_devices (label, device_key_hash, revoked) VALUES ($1,$2,TRUE)', ['Lama', hash])
    const r = await app.inject({
      method: 'POST', url: '/api/devices/enroll', headers: auth,
      payload: { label: 'Hidup lagi', deviceKey: K },
    })
    expect(r.json().reactivated).toBe(true)
    const list = await app.inject({ method: 'GET', url: '/api/devices', headers: auth })
    expect(list.json().devices[0]).toMatchObject({ label: 'Hidup lagi', revoked: false })
  })
})
