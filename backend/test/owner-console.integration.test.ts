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

  /** Lewat endpoint /ops (dibatasi 10/menit) — dipakai tes yang menguji endpoint itu sendiri. */
  const createAccessHttp = async (tenant: string, label = 'HP Pemilik') => {
    const r = await app.inject({ method: 'POST', url: `/ops/api/tenant/${tenant}/owner-access`, headers: ops, payload: { label } })
    expect(r.statusCode).toBe(200)
    return r.json() as { id: string; token: string; label: string; createdAt: number; consolePath: string }
  }
  const createAccess = async (tenant: string, label = 'HP Pemilik') => {
    const { createOwnerAccess } = await import('../src/lib/ownerAccess.js')
    return createOwnerAccess(getPool(), tenant, label)
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
    const created = await createAccessHttp('kantin', '  HP Bu Sari  ')
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

    const ov = await app.inject({ method: 'GET', url: '/owner/kantin/api/overview', headers: bearer(token) })
    expect(ov.statusCode).toBe(200)
    expect(ov.json()).toMatchObject({
      tenantId: 'kantin',
      businessName: 'Kantin Bu Sari',
      businessType: 'kantin',
      today: { revenue: 25000, txns: 1 },
      cancellations: { todayCount: 1, todayValue: 8000 },
    })

    const detail = (await app.inject({ method: 'GET', url: '/owner/kantin/api/detail', headers: bearer(token) })).json()
    expect(detail.totals.revenue).toBe(25000)
    expect(detail.orders.map((o: { orderNumber: string }) => o.orderNumber).sort()).toEqual(['TRX-1', 'TRX-2'])
    expect(detail.auditLogs[0]).toMatchObject({ userName: 'Andi' })

    const cancels = (await app.inject({ method: 'GET', url: '/owner/kantin/api/cancellations?days=7', headers: bearer(token) })).json()
    expect(cancels.totals.count).toBe(1)

    const { rows } = await getPool().query<{ last_used_at: Date | null }>('SELECT last_used_at FROM owner_access_tokens')
    expect(rows[0].last_used_at).not.toBeNull()
  })

  it('export PDF ter-scope ke tenant token', async () => {
    await seed()
    const { token } = await createAccess('kantin')
    const r = await app.inject({ method: 'GET', url: '/owner/kantin/api/export/transactions.pdf', headers: bearer(token) })
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toBe('application/pdf')
    expect(r.headers['content-disposition']).toContain('transaksi-kantin-')
    expect((await app.inject({ method: 'GET', url: '/owner/kantin/api/export/x.pdf', headers: bearer(token) })).statusCode).toBe(404)
    expect(
      (await app.inject({ method: 'GET', url: '/owner/kantin/api/export/transactions.pdf?from=2026-13-01', headers: bearer(token) })).statusCode,
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

  it('rekap penjualan dibedakan: kafe (pelayan, tip, platform) vs kantin (tagihan tertunda), per tenant', async () => {
    await seed()
    const now = Date.now()
    const extra: [string, string, string, Record<string, unknown>][] = [
      ['cafe', 'orders', 'c1', { id: 'c1', orderNumber: 'CAFE-1', status: 'paid', type: 'dine_in', guestCount: 3, waiterName: 'Rani', grandTotal: 99000, createdAt: now, paidAt: now }],
      ['cafe', 'orderItems', 'ci1', { id: 'ci1', orderId: 'c1', productName: 'Kopi Susu', qty: 3, lineTotal: 99000 }],
      ['cafe', 'payments', 'cp1', { id: 'cp1', orderId: 'c1', method: 'qris', amount: 99000, tipAmount: 10000 }],
      ['kantin', 'orders', 'pl1', { id: 'pl1', orderNumber: 'TRX-3', status: 'open', grandTotal: 15000, createdAt: now, payLater: { name: 'Pak Budi', note: '', markedAt: now } }],
    ]
    for (const [tenant, entity, id, payload] of extra) {
      await getPool().query(
        `INSERT INTO sync_entity_state (tenant_id, entity, entity_id, payload, entity_updated_at) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id, entity, entity_id) DO UPDATE SET payload = EXCLUDED.payload`,
        [tenant, entity, id, JSON.stringify(payload), now],
      )
    }
    const cafe = await createAccess('cafe')
    const kantin = await createAccess('kantin')

    const c = (await app.inject({ method: 'GET', url: '/owner/kafe/api/sales', headers: bearer(cafe.token) })).json()
    expect(c.profile).toBe('cafe')
    expect(c.totals).toMatchObject({ count: 1, revenue: 99000, tips: 10000, guests: 3 })
    expect(c.byWaiter).toEqual([{ name: 'Rani', count: 1, revenue: 99000, tips: 10000 }])
    expect(c.topProducts[0]).toMatchObject({ name: 'Kopi Susu', qty: 3 })
    expect(c.payLater.count).toBe(0)

    const k = (await app.inject({ method: 'GET', url: '/owner/kantin/api/sales', headers: bearer(kantin.token) })).json()
    expect(k.profile).toBe('kantin')
    expect(k.totals).toMatchObject({ count: 1, revenue: 25000 })
    expect(k.payLater).toMatchObject({ count: 1, value: 15000 })
    expect(k.payLater.rows[0].name).toBe('Pak Budi')
    expect(JSON.stringify(k)).not.toContain('Kopi Susu')

    expect((await app.inject({ method: 'GET', url: '/owner/kantin/api/sales?from=2026-13-40', headers: bearer(kantin.token) })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/owner/api/sales' })).statusCode).toBe(401)
  })

  it('akses dipisah per jenis usaha: /owner/kafe hanya kafe, /owner/kantin hanya kantin', async () => {
    await seed()
    const cafe = await createAccessHttp('cafe')
    const kantin = await createAccessHttp('kantin')
    expect(cafe).toMatchObject({ consolePath: '/owner/kafe' })
    expect(kantin).toMatchObject({ consolePath: '/owner/kantin' })

    const get = (url: string, token: string) => app.inject({ method: 'GET', url, headers: bearer(token) })
    expect((await get('/owner/kafe/api/overview', cafe.token)).statusCode).toBe(200)
    expect((await get('/owner/kantin/api/overview', kantin.token)).statusCode).toBe(200)

    // Token di area yang salah → 403 + alamat konsol yang benar, tanpa data.
    const cross = await get('/owner/kantin/api/overview', cafe.token)
    expect(cross.statusCode).toBe(403)
    expect(cross.json()).toMatchObject({ consolePath: '/owner/kafe' })
    expect(cross.body).not.toContain('Kopi Enak')
    expect((await get('/owner/kafe/api/detail', kantin.token)).statusCode).toBe(403)
    expect((await get('/owner/kafe/api/export/transactions.pdf', kantin.token)).statusCode).toBe(403)
    // Tautan lama /owner untuk kafe/kantin juga ditolak, diarahkan ke alamat barunya.
    const legacy = await get('/owner/api/overview', kantin.token)
    expect(legacy.statusCode).toBe(403)
    expect(legacy.json()).toMatchObject({ consolePath: '/owner/kantin' })

    // Endpoint khusus hanya ada di areanya.
    expect((await get('/owner/kantin/api/tables', kantin.token)).statusCode).toBe(404)
    expect((await get('/owner/kafe/api/pay-later', cafe.token)).statusCode).toBe(404)

    // Shell HTML per area membawa judul & area masing-masing.
    const shell = await app.inject({ method: 'GET', url: '/owner/kafe' })
    expect(shell.statusCode).toBe(200)
    expect(shell.body).toContain('Konsol Pemilik Kafe')
    expect(shell.body).toContain("const AREA = 'kafe'")
    expect(shell.body).not.toContain('__OWNER_')
    expect((await app.inject({ method: 'GET', url: '/owner/kantin' })).body).toContain("const AREA = 'kantin'")
  })

  it('isi khusus: meja kafe; tagihan tertunda & bukti bayar kantin', async () => {
    await seed()
    const now = Date.now()
    const photo = 'data:image/jpeg;base64,' + Buffer.from('jpeg-bytes').toString('base64')
    const extra: [string, string, string, Record<string, unknown>][] = [
      ['cafe', 'cafeTables', 't1', { id: 't1', name: 'Meja 1', area: 'Dalam', capacity: 4, status: 'occupied', currentOrderId: 'c2', guestCount: 3, occupiedSince: now }],
      ['cafe', 'cafeTables', 't2', { id: 't2', name: 'Meja 2', area: 'Dalam', capacity: 2, status: 'available', currentOrderId: null }],
      ['cafe', 'orders', 'c2', { id: 'c2', orderNumber: 'CAFE-2', status: 'open', grandTotal: 45000, waiterName: 'Rani', createdAt: now }],
      ['cafe', 'payments', 'cp1', { id: 'cp1', orderId: 'c1', method: 'cash', amount: 99000, tipAmount: 7000 }],
      ['kantin', 'orders', 'pl1', { id: 'pl1', orderNumber: 'TRX-3', status: 'open', grandTotal: 15000, createdAt: now, payLater: { name: 'Pak Budi', note: 'Divisi gudang', markedAt: now, markedByName: 'Andi' } }],
      ['kantin', 'payments', 'kp1', { id: 'kp1', orderId: 'o1', method: 'qris', amount: 25000 }],
      ['kantin', 'paymentProofs', 'pr1', { id: 'pr1', orderId: 'o1', billId: 'b1', photoDataUrl: photo, takenByName: 'Andi', createdAt: now }],
      ['kantin', 'paymentProofs', 'pr2', { id: 'pr2', orderId: 'o1', billId: 'b1', photoDataUrl: null, noPhotoReason: 'Kamera rusak', takenByName: 'Andi', createdAt: now }],
    ]
    for (const [tenant, entity, id, payload] of extra) {
      await getPool().query(
        `INSERT INTO sync_entity_state (tenant_id, entity, entity_id, payload, entity_updated_at) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id, entity, entity_id) DO UPDATE SET payload = EXCLUDED.payload`,
        [tenant, entity, id, JSON.stringify(payload), now],
      )
    }
    const cafe = await createAccess('cafe')
    const kantin = await createAccess('kantin')
    const get = (url: string, token: string) => app.inject({ method: 'GET', url, headers: bearer(token) })

    const cov = (await get('/owner/kafe/api/overview', cafe.token)).json()
    expect(cov.area).toBe('kafe')
    expect(cov.highlights).toMatchObject({ tipsToday: 7000, tables: { total: 2, occupied: 1 } })
    const tables = (await get('/owner/kafe/api/tables', cafe.token)).json().tables
    expect(tables[0]).toMatchObject({ name: 'Meja 1', status: 'occupied', order: { orderNumber: 'CAFE-2', grandTotal: 45000, waiterName: 'Rani' } })
    expect(tables[1]).toMatchObject({ name: 'Meja 2', order: null })

    const kov = (await get('/owner/kantin/api/overview', kantin.token)).json()
    expect(kov.highlights).toMatchObject({ payLater: { count: 1, value: 15000 }, proofsToday: { count: 2, withoutPhoto: 1 } })
    const pl = (await get('/owner/kantin/api/pay-later', kantin.token)).json()
    expect(pl.open).toHaveLength(1)
    expect(pl.open[0]).toMatchObject({ name: 'Pak Budi', note: 'Divisi gudang', markedByName: 'Andi', value: 15000 })

    const proofs = (await get('/owner/kantin/api/proofs', kantin.token)).json()
    expect(proofs.proofs).toHaveLength(2)
    expect(JSON.stringify(proofs)).not.toContain('base64')
    const withPhoto = proofs.proofs.find((x: { id: string }) => x.id === 'pr1')
    expect(withPhoto).toMatchObject({ hasPhoto: true, method: 'qris', amount: 25000, orderNumber: 'TRX-1' })
    expect(proofs.proofs.find((x: { id: string }) => x.id === 'pr2')).toMatchObject({ hasPhoto: false, noPhotoReason: 'Kamera rusak' })

    const img = await get('/owner/kantin/api/proofs/pr1/photo', kantin.token)
    expect(img.statusCode).toBe(200)
    expect(img.headers['content-type']).toBe('image/jpeg')
    expect(img.rawPayload.toString()).toBe('jpeg-bytes')
    expect((await get('/owner/kantin/api/proofs/pr2/photo', kantin.token)).statusCode).toBe(404)
  })

  it('percobaan token salah berulang memblokir IP sementara', async () => {
    const { token } = await createAccess('kantin')
    for (let i = 0; i < 10; i++) {
      await app.inject({ method: 'GET', url: '/owner/api/overview', headers: bearer(`kio_tebakan${i}`) })
    }
    expect((await app.inject({ method: 'GET', url: '/owner/api/overview', headers: bearer(token) })).statusCode).toBe(429)
  })
})
