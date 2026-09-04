import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { HAS_DB, resetDatabase, setupDatabase, teardownDatabase } from './helpers/db.js'
import { getPool } from '../src/db/pool.js'

process.env.SYNC_DEVICE_KEYS = process.env.SYNC_DEVICE_KEYS ?? 'test-device-key-0123456789abcdef'
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test'
process.env.LOG_LEVEL = 'silent'

const suite = HAS_DB ? describe : describe.skip

const TOKEN = 'abcdef0123456789abcdef0123456789'

async function seedEntity(entity: string, id: string, payload: Record<string, unknown>): Promise<void> {
  await getPool().query(
    `INSERT INTO sync_entity_state (entity, entity_id, payload, entity_updated_at, server_seq)
     VALUES ($1, $2, $3::jsonb, $4, nextval('sync_server_seq'))`,
    [entity, id, JSON.stringify(payload), Number(payload.updatedAt ?? 1)],
  )
}

async function seedCatalog(): Promise<void> {
  await seedEntity('settings', 'singleton', {
    id: 'singleton', cafeName: 'Kikost', address: 'Jl. Test', phone: '',
    taxPercent: 10, serviceChargePercent: 5, roundingIncrement: 100, updatedAt: 1,
  })
  await seedEntity('cafeTables', 't1', {
    id: 't1', name: 'Meja 1', qrToken: TOKEN, qrActive: true, status: 'available', updatedAt: 1,
  })
  await seedEntity('categories', 'c1', { id: 'c1', name: 'Kopi', sortOrder: 0, active: true, updatedAt: 1 })
  await seedEntity('products', 'p1', {
    id: 'p1', categoryId: 'c1', name: 'Latte', price: 25000, isAvailable: true, modifierGroupIds: [], photoDataUrl: null, updatedAt: 1,
  })
}

suite('public QR order API (integrasi)', () => {
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

  it('GET /api/t/:token → menu; token nonaktif → 410', async () => {
    await seedCatalog()
    const ok = await app.inject({ method: 'GET', url: `/api/t/${TOKEN}` })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().items).toHaveLength(1)
    expect(ok.json().table.name).toBe('Meja 1')

    await getPool().query(
      "UPDATE sync_entity_state SET payload = jsonb_set(payload, '{qrActive}', 'false') WHERE entity='cafeTables'",
    )
    const gone = await app.inject({ method: 'GET', url: `/api/t/${TOKEN}` })
    expect(gone.statusCode).toBe(410)
  })

  it('POST orders → order QR di sync_entity_state; harga dari server; idempoten', async () => {
    await seedCatalog()
    const headers = { 'idempotency-key': 'cust-key-abc123', 'content-type': 'application/json' }
    const body = { customerName: 'Budi <x>', items: [{ productId: 'p1', qty: 2, modifierOptionIds: [], note: 'panas' }] }

    const res1 = await app.inject({ method: 'POST', url: `/api/t/${TOKEN}/orders`, headers, payload: body })
    expect(res1.statusCode).toBe(201)
    const out = res1.json()
    expect(out.subtotal).toBe(50000)
    expect(out.grandTotal).toBe(57800) // 50000 + 2500 SC + 5250 tax → 57750 → round 100
    expect(out.orderNumber).toMatch(/^QR\d{5}$/)

    // idempotency: kirim ulang → order yang sama
    const res2 = await app.inject({ method: 'POST', url: `/api/t/${TOKEN}/orders`, headers, payload: body })
    expect(res2.json().orderId).toBe(out.orderId)

    const { rows } = await getPool().query(
      "SELECT payload FROM sync_entity_state WHERE entity='orders'",
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].payload.lifecycleStatus).toBe('PENDING_CONFIRMATION')
    expect(rows[0].payload.source).toBe('qr_table')
    expect(rows[0].payload.grandTotal).toBe(57800)
    expect(rows[0].payload.notes).toBe('Budi x') // disanitasi

    const items = await getPool().query("SELECT payload FROM sync_entity_state WHERE entity='orderItems'")
    expect(items.rows).toHaveLength(1)
    expect(items.rows[0].payload.unitPrice).toBe(25000)
  })

  it('status pesanan hanya untuk token meja yang cocok', async () => {
    await seedCatalog()
    const created = await app.inject({
      method: 'POST',
      url: `/api/t/${TOKEN}/orders`,
      headers: { 'idempotency-key': 'key-0001', 'content-type': 'application/json' },
      payload: { items: [{ productId: 'p1', qty: 1, modifierOptionIds: [], note: '' }] },
    })
    const orderId = created.json().orderId
    const st = await app.inject({ method: 'GET', url: `/api/t/${TOKEN}/orders/${orderId}` })
    expect(st.statusCode).toBe(200)
    const body = st.json()
    expect(body.status).toBe('PENDING_CONFIRMATION')
    expect(body.paid).toBe(false)
    expect(body.items[0]).toMatchObject({ name: 'Latte', qty: 1, lineTotal: 25000 })
    expect(body.subtotal).toBe(25000)
    expect(body.serviceChargeAmount).toBe(1250) // 5%
    expect(body.taxAmount).toBe(2625) // 10% dari (subtotal + SC)
  })

  it('POST calls → tableCalls entity', async () => {
    await seedCatalog()
    const r = await app.inject({
      method: 'POST',
      url: `/api/t/${TOKEN}/calls`,
      headers: { 'content-type': 'application/json' },
      payload: { type: 'waiter' },
    })
    expect(r.statusCode).toBe(201)
    const { rows } = await getPool().query("SELECT payload FROM sync_entity_state WHERE entity='tableCalls'")
    expect(rows[0].payload).toMatchObject({ type: 'waiter', status: 'pending', tableId: 't1' })
  })

  it('produk tak tersedia → 409, tak menulis order', async () => {
    await seedCatalog()
    await getPool().query(
      "UPDATE sync_entity_state SET payload = jsonb_set(payload,'{isAvailable}','false') WHERE entity='products'",
    )
    const r = await app.inject({
      method: 'POST',
      url: `/api/t/${TOKEN}/orders`,
      headers: { 'idempotency-key': 'key-xxxx', 'content-type': 'application/json' },
      payload: { items: [{ productId: 'p1', qty: 1, modifierOptionIds: [], note: '' }] },
    })
    expect(r.statusCode).toBe(409)
    const { rows } = await getPool().query("SELECT 1 FROM sync_entity_state WHERE entity='orders'")
    expect(rows).toHaveLength(0)
  })
})
