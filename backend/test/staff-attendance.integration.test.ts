import { pbkdf2Sync, randomBytes } from 'node:crypto'
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
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36'

/** Hash PIN seperti src/lib/pinHash.ts (PBKDF2-SHA256, 150.000 iterasi, salt 16 byte hex). */
function hashPin(pin: string, salt = randomBytes(16).toString('hex')) {
  return { pinSalt: salt, pinHash: pbkdf2Sync(pin, Buffer.from(salt, 'hex'), 150_000, 32, 'sha256').toString('hex') }
}
const BUDI = { userId: 'u-budi', userName: 'Budi', ...hashPin('1234') }
const SITI = { userId: 'u-siti', userName: 'Siti', ...hashPin('5678') }

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

  const sendRoster = (staff = [BUDI, SITI], headers = cafe) => app.inject({ method: 'POST', url: '/api/sync/attendance/roster', headers, payload: { staff } })

  const currentQr = async (headers = cafe) => {
    const { qrCodeFor } = await import('../src/lib/staffAttendance.js')
    const s = (await app.inject({ method: 'GET', url: '/api/sync/attendance/qr-secret', headers })).json() as { secret: string; ref: string; periodMs: number }
    const w = Math.floor(Date.now() / s.periodMs)
    return `${s.ref}.${w}.${qrCodeFor(s.secret, w)}`
  }

  const start = async (qr?: string) => app.inject({ method: 'POST', url: '/api/absen/start', payload: { qr: qr ?? (await currentQr()) } })
  const identify = (challengeId: string, pin: string, userId = 'u-budi') => app.inject({ method: 'POST', url: '/api/absen/identify', payload: { challengeId, userId, pin } })
  const sendPunch = (challengeId: string, selfie: string | null = JPEG) =>
    app.inject({
      method: 'POST',
      url: '/api/absen/punch',
      headers: { 'user-agent': ANDROID_UA },
      payload: { challengeId, selfie, location: { latitude: -6.2, longitude: 106.816666, accuracy: 12 } },
    })

  /** Alur lengkap HP: pindai QR → pilih nama + PIN → selfie. */
  const punch = async (opts: { selfie?: string | null; pin?: string; userId?: string } = {}) => {
    const st = await start()
    expect(st.statusCode).toBe(200)
    const challengeId = st.json().challengeId as string
    const id = await identify(challengeId, opts.pin ?? '1234', opts.userId)
    if (id.statusCode !== 200) return id
    return sendPunch(challengeId, opts.selfie === undefined ? JPEG : opts.selfie)
  }

  it('rute tablet butuh kunci perangkat', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/sync/attendance/qr-secret' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/api/sync/attendance/roster', payload: { staff: [] } })).statusCode).toBe(401)
  })

  it('tanpa daftar HP: pindai QR → pilih nama + PIN → absen masuk lalu pulang; auditLogs berantai-hash ditarik tablet', async () => {
    expect((await sendRoster()).json()).toMatchObject({ ok: true, count: 2 })
    const st = (await start()).json()
    expect(st.staff).toEqual([
      { userId: 'u-budi', userName: 'Budi' },
      { userId: 'u-siti', userName: 'Siti' },
    ])
    expect(st).not.toHaveProperty('staff.0.pinHash')
    expect((await identify(st.challengeId, '1234')).json()).toMatchObject({ type: 'in', userName: 'Budi', clockedInSince: null })
    const masuk = await sendPunch(st.challengeId)
    expect(masuk.statusCode).toBe(200)
    expect(masuk.json()).toMatchObject({ type: 'in', userName: 'Budi' })
    expect((await punch()).json()).toMatchObject({ type: 'out' })

    const pull = (await app.inject({ method: 'GET', url: '/api/sync/pull?since=0', headers: cafe })).json()
    const logs = (pull.entities.auditLogs ?? []) as { action: string; entityId: string; details: string; deviceSeq: number; prevHash: string | null; hash: string }[]
    expect(logs.map((l) => l.action).sort()).toEqual(['attendance.in', 'attendance.out'])
    expect(logs.every((l) => l.entityId === 'u-budi')).toBe(true)
    expect(logs[0].details).toContain('Android · Chrome, PIN, selfie')
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
    await sendRoster()
    const now = Date.now()
    await getPool().query(
      `INSERT INTO sync_entity_state (tenant_id, entity, entity_id, payload, entity_updated_at) VALUES ('cafe', 'auditLogs', 'm1', $1, $2)`,
      [JSON.stringify({ id: 'm1', userId: 'u-budi', userName: 'Budi', action: 'attendance.manual_in', entityType: 'attendance', entityId: 'u-budi', details: '', createdAt: now - 60_000 }), now],
    )
    expect((await punch()).json()).toMatchObject({ type: 'out' })
  })

  it('PIN salah ditolak; 5 kali salah mengunci nama itu; PIN karyawan lain tak berlaku', async () => {
    await sendRoster()
    const ch = (await start()).json().challengeId as string
    expect((await identify(ch, '5678')).statusCode).toBe(401)
    expect((await identify(ch, '5678', 'u-siti')).statusCode).toBe(200)
    // Sesi belum terikat PIN tak bisa dipakai absen.
    const fresh = (await start()).json().challengeId as string
    expect((await sendPunch(fresh)).statusCode).toBe(401)

    for (let i = 0; i < 3; i++) expect((await identify(fresh, '0000')).json().error).toMatch(/PIN salah/)
    const fifth = await identify(fresh, '0000')
    expect(fifth.statusCode).toBe(429)
    expect((await identify(fresh, '1234')).statusCode).toBe(429)
    // Siti tetap bisa.
    expect((await identify(fresh, '5678', 'u-siti')).statusCode).toBe(200)
    // Mengubah PIN di tablet membuka kunci.
    await sendRoster([{ ...BUDI, ...hashPin('4321') }, SITI])
    expect((await identify(fresh, '4321')).statusCode).toBe(200)
  })

  it('menolak QR basi, QR palsu, QR tenant lain yang dipalsukan, dan sesi yang dipakai ulang', async () => {
    await sendRoster()
    const { qrCodeFor } = await import('../src/lib/staffAttendance.js')
    const s = (await app.inject({ method: 'GET', url: '/api/sync/attendance/qr-secret', headers: cafe })).json() as { secret: string; ref: string }
    const old = Math.floor(Date.now() / 20_000) - 10
    expect((await start(`${s.ref}.${old}.${qrCodeFor(s.secret, old)}`)).statusCode).toBe(409)
    const w = Math.floor(Date.now() / 20_000)
    expect((await start(`${s.ref}.${w}.AAAAAAAAAAAA`)).statusCode).toBe(409)
    expect((await start(`${w}.${qrCodeFor(s.secret, w)}`)).statusCode).toBe(400)
    const otherRef = (await app.inject({ method: 'GET', url: '/api/sync/attendance/qr-secret', headers: other })).json().ref as string
    expect((await start(`${otherRef}.${w}.${qrCodeFor(s.secret, w)}`)).statusCode).toBe(409)

    const ch = (await start()).json().challengeId as string
    await identify(ch, '1234')
    expect((await sendPunch(ch)).statusCode).toBe(200)
    expect((await sendPunch(ch)).statusCode).toBe(409)
  })

  it('daftar karyawan belum dikirim → HP diberi tahu; karyawan yang dihapus dari tablet tak bisa absen', async () => {
    const st = await start()
    expect(st.statusCode).toBe(409)
    expect(st.json().error).toMatch(/Daftar karyawan/)
    await sendRoster()
    const ch = (await start()).json().challengeId as string
    await sendRoster([SITI])
    expect((await identify(ch, '1234')).statusCode).toBe(404)
  })

  it('selfie wajib secara bawaan; boleh tanpa selfie bila admin memilih opsional', async () => {
    await sendRoster()
    await setSelfieMode('required')
    expect((await punch({ selfie: null })).statusCode).toBe(400)
    await setSelfieMode('optional')
    expect((await punch({ selfie: null })).statusCode).toBe(200)
  })

  it('konsol Pemilik kafe: daftar absen + selfie + lokasi', async () => {
    await setSelfieMode('required')
    await sendRoster()
    await punch()
    const { createOwnerAccess } = await import('../src/lib/ownerAccess.js')
    const { token } = await createOwnerAccess(getPool(), 'cafe', 'HP Pemilik')
    const auth = { authorization: `Bearer ${token}` }
    const r = (await app.inject({ method: 'GET', url: '/owner/kafe/api/attendance', headers: auth })).json()
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ userName: 'Budi', type: 'in', source: 'phone', hasSelfie: true, phoneLabel: 'Android · Chrome' })
    expect(r.rows[0].location).toMatchObject({ latitude: -6.2 })
    const img = await app.inject({ method: 'GET', url: `/owner/kafe/api/attendance/${r.rows[0].id}/selfie`, headers: auth })
    expect(img.statusCode).toBe(200)
    expect(img.headers['content-type']).toBe('image/jpeg')
  })
})
