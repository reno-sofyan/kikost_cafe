import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { getPool } from '../db/pool.js'
import {
  AttendanceError,
  completeEnrollment,
  completePunch,
  createEnrollment,
  getQrSecret,
  listPhones,
  QR_PERIOD_MS,
  revokePhone,
  startPunch,
} from '../lib/staffAttendance.js'

/**
 * Absensi karyawan lewat HP (lihat src/lib/staffAttendance.ts).
 *
 * Tablet (kunci perangkat, di bawah /api/sync):
 *  GET  /api/sync/attendance/qr-secret          → rahasia QR dinamis tenant ini
 *  POST /api/sync/attendance/enroll             { userId, userName, createdBy } → tautan pendaftaran sekali pakai
 *  GET  /api/sync/attendance/phones             → HP terdaftar
 *  POST /api/sync/attendance/phones/:id/revoke
 *
 * HP karyawan (publik; gerbangnya = token pendaftaran / tanda tangan kunci HP):
 *  POST /api/absen/enroll     { token, publicKey, label }
 *  POST /api/absen/challenge  { phoneId, qr, signature }
 *  POST /api/absen/punch      { phoneId, challengeId, selfie, location, signature }
 */

const enrollSchema = z.object({ userId: z.string().min(1).max(200), userName: z.string().min(1).max(80), createdBy: z.string().min(1).max(80) })
const phoneEnrollSchema = z.object({ token: z.string().min(10).max(100), publicKey: z.unknown(), label: z.string().max(60).default('HP') })
const challengeSchema = z.object({ phoneId: z.string().max(40), qr: z.string().max(40), signature: z.string().max(200) })
const punchSchema = z.object({
  phoneId: z.string().max(40),
  challengeId: z.string().max(40),
  selfie: z.string().max(600_000).nullable(),
  location: z
    .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100_000) })
    .nullable(),
  signature: z.string().max(200),
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
    return { secret: await getQrSecret(getPool(), request.tenantId), periodMs: QR_PERIOD_MS }
  })

  app.post('/api/sync/attendance/enroll', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = enrollSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'Data karyawan tidak valid.' }
    }
    const result = await createEnrollment(getPool(), request.tenantId, parsed.data)
    request.log.info({ tenantId: request.tenantId, userId: parsed.data.userId }, 'absen HP: tautan pendaftaran dibuat')
    reply.header('cache-control', 'no-store')
    return result
  })

  app.get('/api/sync/attendance/phones', async (request) => ({ phones: await listPhones(getPool(), request.tenantId) }))

  app.post<{ Params: { id: string } }>('/api/sync/attendance/phones/:id/revoke', async (request, reply) => {
    if (!(await revokePhone(getPool(), request.tenantId, request.params.id))) {
      reply.code(404)
      return { error: 'HP tidak ditemukan.' }
    }
    request.log.info({ tenantId: request.tenantId, phoneId: request.params.id }, 'absen HP: HP dicabut dari tablet')
    return { ok: true }
  })

  // ---- HP karyawan ----
  const phoneLimit = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }

  app.post('/api/absen/enroll', phoneLimit, async (request, reply) => {
    const parsed = phoneEnrollSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'Data pendaftaran tidak valid.' }
    }
    try {
      const result = await completeEnrollment(parsed.data.token, parsed.data.publicKey, parsed.data.label)
      request.log.info({ phoneId: result.phoneId }, 'absen HP: HP terdaftar')
      return result
    } catch (err) {
      return fail(reply, err)
    }
  })

  app.post('/api/absen/challenge', phoneLimit, async (request, reply) => {
    const parsed = challengeSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'Isi QR tidak valid. Pindai QR absensi di tablet kasir.' }
    }
    try {
      return await startPunch(getPool(), parsed.data)
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
        phoneId: parsed.data.phoneId,
        challengeId: parsed.data.challengeId,
        selfieBase64: parsed.data.selfie,
        location: parsed.data.location,
        signature: parsed.data.signature,
        ip: request.ip || null,
        userAgent: request.headers['user-agent'] ?? null,
      })
      request.log.info({ phoneId: parsed.data.phoneId, type: result.type }, 'absen HP: tercatat')
      return result
    } catch (err) {
      return fail(reply, err)
    }
  })
}
