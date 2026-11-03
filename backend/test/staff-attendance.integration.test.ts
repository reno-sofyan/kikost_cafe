import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { HAS_DB, resetDatabase, setupDatabase, teardownDatabase } from './helpers/db.js'
import { getPool } from '../src/db/pool.js'

const CAFE_KEY = 'cafe-device-key-0123456789abcdef0123'
const OTHER_KEY = 'other-device-key-0123456789abcdef012'
const cafe = { authorization: `Bearer ${CAFE_KEY}` }
const other = { authorization: `Bearer ${OTHER_KEY}` }
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString('base64')

const suite = HAS_DB ? describe : describe.skip

/** Meniru HP karyawan: kunci ECDSA P-256 WebCrypto, tanda tangan r||s base64url. */
async function makePhone() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey)
  const sign = async (message: string) =>
    Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, new TextEncoder().encode(message))).toString('base64url')
  return { publicKey, sign }
}

suite('absensi karyawan lewat HP (integrasi)', () => {
  let app: FastifyInstance
  const saved: Record<string, string | undefined> = {}

  beforeAll(async () => {
    for (const k of ['SYNC_DEVICE_KEYS', 'LOG_LEVEL']) saved[k] = process.env[k]
    process.env.SYNC_DEVICE_KEYS = `cafe:${CAFE_KEY},other:${OTHER_KEY}`
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

  const setSelfieMode = (mode: 'required' | 'optional') =>
    getPool().query(
      `INSERT INTO sync_entity_state (tenant_id, entity, entity_id, payload, entity_updated_at) VALUES ('cafe', 'settings', 'singleton', $1, 1)
       ON CONFLICT (tenant_id, entity, entity_id) DO UPDATE SET payload = EXCLUDED.payload`,
      [JSON.stringify({ id: 'singleton', businessName: 'Kopi Enak', businessType: 'cafe_resto', attendancePhoneSelfie: mode })],
    )

  const enroll = async (phone: Awaited<ReturnType<typeof makePhone>>, userId = 'u-budi', userName = 'Budi') => {
    const link = await app.inject({ method: 'POST', url: '/api/sync/attendance/enroll', headers: cafe, payload: { userId, userName, createdBy: 'Pemilik' } })
    expect(link.statusCode).toBe(200)
    const r = await app.inject({ method: 'POST', url: '/api/absen/enroll', payload: { token: link.json().token, publicKey: phone.publicKey, label: 'Android' } })
    expect(r.statusCode).toBe(200)
    return { ...(r.json() as { phoneId: string; userName: string }), token: link.json().token as string }
  }

  const currentQr = async () => {
    const { qrCodeFor } = await import('../src/lib/staffAttendance.js')
    const s = (await app.inject({ method: 'GET', url: '/api/sync/attendance/qr-secret', headers: cafe })).json() as { secret: string; periodMs: number }
    const w = Math.floor(Date.now() / s.periodMs)
    return `${w}.${qrCodeFor(s.secret, w)}`
  }

  const punch = async (phone: Awaited<ReturnType<typeof makePhone>>, phoneId: string, opts: { selfie?: string | null; qr?: string } = {}) => {
    const qr = opts.qr ?? (await currentQr())
    const ch = await app.inject({ method: 'POST', url: '/api/absen/challenge', payload: { phoneId, qr, signature: await phone.sign(`kione-absen/challenge\n${phoneId}\n${qr}`) } })
    if (ch.statusCode !== 200) return ch
    const { challengeId } = ch.json() as { challengeId: string }
    const selfie = opts.selfie === undefined ? JPEG : opts.selfie
    const sha = selfie ? createHash('sha256').update(Buffer.from(selfie, 'base64')).digest('hex') : '-'
    const location = { latitude: -6.2, longitude: 106.816666, accuracy: 12 }
    const signature = await phone.sign(`kione-absen/punch\n${challengeId}\n${sha}\n-6.200000,106.816666,12`)
    return app.inject({ method: 'POST', url: '/api/absen/punch', payload: { phoneId, challengeId, selfie, location, signature } })
  }

  it('rute tablet butuh kunci perangkat', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/sync/attendance/qr-secret' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/api/sync/attendance/enroll', payload: {} })).statusCode).toBe(401)
  })

  it('daftar HP → absen masuk lalu pulang; tercatat sebagai auditLogs berantai-hash yang ditarik tablet', async () => {
    const phone = await makePhone()
    const { phoneId, userName } = await enroll(phone)
    expect(userName).toBe('Budi')

    const masuk = await punch(phone, phoneId)
    expect(masuk.statusCode).toBe(200)
    expect(masuk.json()).toMatchObject({ type: 'in', userName: 'Budi' })
    const pulang = await punch(phone, phoneId)
    expect(pulang.json()).toMatchObject({ type: 'out' })

    const pull = (await app.inject({ method: 'GET', url: '/api/sync/pull?since=0', headers: cafe })).json()
    const logs = (pull.entities.auditLogs ?? []) as { action: string; entityId: string; deviceSeq: number; prevHash: string | null; hash: string }[]
    expect(logs.map((l) => l.action).sort()).toEqual(['attendance.in', 'attendance.out'])
    const sorted = [...logs].sort((a, b) => a.deviceSeq - b.deviceSeq)
    expect(sorted[0].prevHash).toBeNull()
    expect(sorted[1].prevHash).toBe(sorted[0].hash)
    const { auditEntryHash } = await import('../src/lib/staffAttendance.js')
    for (const l of sorted) {
      const { hash, ...rest } = l as unknown as Parameters<typeof auditEntryHash>[0] & { hash: string }
      expect(auditEntryHash(rest)).toBe(hash)
    }
    // Tenant lain tidak melihatnya.
    const otherPull = (await app.inject({ method: 'GET', url: '/api/sync/pull?since=0', headers: other })).json()
    expect(otherPull.entities.auditLogs ?? []).toHaveLength(0)
  })

  it('arah absen mengikuti absen manual di tablet', async () => {
    const phone = await makePhone()
    const { phoneId } = await enroll(phone)
    const now = Date.now()
    await getPool().query(
      `INSERT INTO sync_entity_state (tenant_id, entity, entity_id, payload, entity_updated_at) VALUES ('cafe', 'auditLogs', 'm1', $1, $2)`,
      [JSON.stringify({ id: 'm1', userId: 'u-budi', userName: 'Budi', action: 'attendance.manual_in', entityType: 'attendance', entityId: 'u-budi', details: '', createdAt: now - 60_000 }), now],
    )
    expect((await punch(phone, phoneId)).json()).toMatchObject({ type: 'out' })
  })

  it('menolak QR basi, QR palsu, tanda tangan kunci lain, dan tantangan yang dipakai ulang', async () => {
    const phone = await makePhone()
    const { phoneId } = await enroll(phone)
    const { qrCodeFor } = await import('../src/lib/staffAttendance.js')
    const secret = (await app.inject({ method: 'GET', url: '/api/sync/attendance/qr-secret', headers: cafe })).json().secret as string
    const old = Math.floor(Date.now() / 20_000) - 10
    expect((await punch(phone, phoneId, { qr: `${old}.${qrCodeFor(secret, old)}` })).statusCode).toBe(409)
    const w = Math.floor(Date.now() / 20_000)
    expect((await punch(phone, phoneId, { qr: `${w}.AAAAAAAAAAAA` })).statusCode).toBe(409)

    const thief = await makePhone()
    expect((await punch(thief, phoneId)).statusCode).toBe(401)

    const qr = await currentQr()
    const ch = (await app.inject({ method: 'POST', url: '/api/absen/challenge', payload: { phoneId, qr, signature: await phone.sign(`kione-absen/challenge\n${phoneId}\n${qr}`) } })).json()
    const sha = createHash('sha256').update(Buffer.from(JPEG, 'base64')).digest('hex')
    const body = { phoneId, challengeId: ch.challengeId, selfie: JPEG, location: null, signature: await phone.sign(`kione-absen/punch\n${ch.challengeId}\n${sha}\n-`) }
    expect((await app.inject({ method: 'POST', url: '/api/absen/punch', payload: body })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/api/absen/punch', payload: body })).statusCode).toBe(409)
  })

  it('selfie wajib secara bawaan; boleh tanpa selfie bila admin memilih opsional', async () => {
    const phone = await makePhone()
    const { phoneId } = await enroll(phone)
    await setSelfieMode('required')
    expect((await punch(phone, phoneId, { selfie: null })).statusCode).toBe(400)
    await setSelfieMode('optional')
    expect((await punch(phone, phoneId, { selfie: null })).statusCode).toBe(200)
  })

  it('tautan pendaftaran sekali pakai; HP baru mencabut HP lama; HP dicabut tak bisa absen', async () => {
    const lama = await makePhone()
    const first = await enroll(lama)
    const reuse = await app.inject({ method: 'POST', url: '/api/absen/enroll', payload: { token: first.token, publicKey: lama.publicKey, label: 'x' } })
    expect(reuse.statusCode).toBe(410)

    const baru = await makePhone()
    const second = await enroll(baru)
    expect((await punch(lama, first.phoneId)).statusCode).toBe(401)
    expect((await punch(baru, second.phoneId)).statusCode).toBe(200)

    const phones = (await app.inject({ method: 'GET', url: '/api/sync/attendance/phones', headers: cafe })).json().phones
    expect(phones).toHaveLength(1)
    expect((await app.inject({ method: 'POST', url: `/api/sync/attendance/phones/${second.phoneId}/revoke`, headers: other })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: `/api/sync/attendance/phones/${second.phoneId}/revoke`, headers: cafe })).statusCode).toBe(200)
    expect((await punch(baru, second.phoneId)).statusCode).toBe(401)
  })

  it('konsol Pemilik kafe: daftar absen + selfie + lokasi', async () => {
    await setSelfieMode('required')
    const phone = await makePhone()
    const { phoneId } = await enroll(phone)
    await punch(phone, phoneId)
    const { createOwnerAccess } = await import('../src/lib/ownerAccess.js')
    const { token } = await createOwnerAccess(getPool(), 'cafe', 'HP Pemilik')
    const auth = { authorization: `Bearer ${token}` }
    const r = (await app.inject({ method: 'GET', url: '/owner/kafe/api/attendance', headers: auth })).json()
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ userName: 'Budi', type: 'in', source: 'phone', hasSelfie: true, phoneLabel: 'Android' })
    expect(r.rows[0].location).toMatchObject({ latitude: -6.2 })
    expect(r.phones).toHaveLength(1)
    const img = await app.inject({ method: 'GET', url: `/owner/kafe/api/attendance/${r.rows[0].id}/selfie`, headers: auth })
    expect(img.statusCode).toBe(200)
    expect(img.headers['content-type']).toBe('image/jpeg')
  })
})
