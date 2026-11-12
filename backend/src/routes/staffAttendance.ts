import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { getPool } from '../db/pool.js'
import { AttendanceError, completePunch, getQrSecret, identifyStaff, QR_PERIOD_MS, replaceRoster, startPunch } from '../lib/staffAttendance.js'

/**
 * Absensi karyawan lewat HP (lihat src/lib/staffAttendance.ts). Tanpa mendaftarkan HP.
 *
 * Tablet (kunci perangkat, di bawah /api/sync):
 *  GET  /api/sync/attendance/qr-secret  → rahasia + penanda QR dinamis tenant ini
 *  POST /api/sync/attendance/roster     { staff: [{ userId, userName, pinHash, pinSalt }] } → daftar karyawan aktif
 *
 * HP karyawan (publik; gerbangnya = QR segar di tablet + PIN karyawan):
 *  POST /api/absen/start     { qr }                         → sesi + daftar nama karyawan
 *  POST /api/absen/identify  { challengeId, userId, pin }   → arah absen (masuk/pulang)
 *  POST /api/absen/punch     { challengeId, selfie, location }
 */

const rosterSchema = z.object({
  staff: z
    .array(
      z.object({
        userId: z.string().min(1).max(200),
        userName: z.string().min(1).max(80),
        pinHash: z.string().regex(/^[0-9a-f]{64}$/i),
        pinSalt: z.string().regex(/^[0-9a-f]{8,128}$/i),
      }),
    )
    .max(500),
})
const startSchema = z.object({ qr: z.string().max(60) })
const identifySchema = z.object({ challengeId: z.string().max(40), userId: z.string().min(1).max(200), pin: z.string().regex(/^\d{4,8}$/) })
const punchSchema = z.object({
  challengeId: z.string().max(40),
  selfie: z.string().max(600_000).nullable(),
  location: z
    .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100_000) })
    .nullable(),
})

function fail(reply: FastifyReply, err: unknown) {
  if (err instanceof AttendanceError) {
    reply.code(err.statusCode)
    return { error: err.message }
  }
  throw err
}

export async function registerStaffAttendanceRoutes(app: FastifyInstance): Promise<void> {
  // ---- Tablet ----
  app.get('/api/sync/attendance/qr-secret', async (request, reply) => {
    reply.header('cache-control', 'no-store')
    const { secret, ref } = await getQrSecret(getPool(), request.tenantId)
    return { secret, ref, periodMs: QR_PERIOD_MS }
  })

  app.post('/api/sync/attendance/roster', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = rosterSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'Daftar karyawan tidak valid.' }
    }
    const count = await replaceRoster(request.tenantId, parsed.data.staff)
    return { ok: true, count }
  })

  // ---- HP karyawan ----
  const phoneLimit = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }

  app.post('/api/absen/start', phoneLimit, async (request, reply) => {
    const parsed = startSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'Isi QR tidak valid. Pindai QR absensi di tablet kasir.' }
    }
    try {
      return await startPunch(getPool(), parsed.data.qr)
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.post('/api/absen/identify', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = identifySchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'PIN harus 4–8 angka.' }
    }
    try {
      return await identifyStaff(parsed.data)
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.post('/api/absen/punch', phoneLimit, async (request, reply) => {
    const parsed = punchSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'Data absen tidak valid.' }
    }
    try {
      const result = await completePunch({
        challengeId: parsed.data.challengeId,
        selfieBase64: parsed.data.selfie,
        location: parsed.data.location,
        ip: request.ip || null,
        userAgent: request.headers['user-agent'] ?? null,
      })
      request.log.info({ challengeId: parsed.data.challengeId, type: result.type }, 'absen HP: tercatat')
      return result
    } catch (err) {
      return fail(reply, err)
    }
  })
}
