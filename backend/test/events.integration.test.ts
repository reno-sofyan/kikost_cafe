import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HAS_DB, setupDatabase, teardownDatabase } from './helpers/db.js'

const ENV_KEY = 'env-device-key-0123456789abcdef'
process.env.SYNC_DEVICE_KEYS = ENV_KEY
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test'
process.env.LOG_LEVEL = 'silent'

const suite = HAS_DB ? describe : describe.skip

suite('SSE /api/events (integrasi)', () => {
  let app: FastifyInstance
  beforeAll(async () => {
    await setupDatabase()
    const { resetConfigCache } = await import('../src/config.js')
    resetConfigCache()
    const { buildServer } = await import('../src/server.js')
    app = await buildServer()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
    await teardownDatabase()
  })

  it('menolak tanpa / dengan kunci salah', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/events' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/events?key=salah' })).statusCode).toBe(401)
  })

  it('kunci sah → stream text/event-stream dengan frame hello', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/events?key=${ENV_KEY}`,
      // payloadAsStream supaya inject tak menunggu koneksi ditutup
      payloadAsStream: true,
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')
    const chunk: Buffer = await new Promise((resolve) => {
      res.stream().once('data', (d: Buffer) => resolve(d))
    })
    expect(chunk.toString()).toContain('event: hello')
    res.stream().destroy()
  })
})
