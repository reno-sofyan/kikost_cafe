import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getPool } from '../db/pool.js'
import { hashDeviceKey } from '../lib/deviceAuth.js'

/**
 * Manajemen perangkat sinkronisasi. Auth = kunci perangkat yang sah (model
 * kepercayaan yang sama dengan /api/sync — satu kafe, perangkat tepercaya).
 * Perangkat mana pun yang sudah tersambung boleh mendaftarkan / mencabut
 * perangkat lain. RBAC berbasis pengguna server = Fase 3.
 */

const enrollSchema = z.object({
  label: z.string().min(1).max(80),
  deviceKey: z.string().min(16).max(200),
})
const renameSchema = z.object({ label: z.string().min(1).max(80) })

export async function registerDeviceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/devices', async (request) => {
    const { rows } = await getPool().query(
      `SELECT id, label, revoked,
              extract(epoch from created_at) * 1000 AS created_at,
              extract(epoch from last_seen_at) * 1000 AS last_seen_at
         FROM sync_devices
        WHERE tenant_id = $1
        ORDER BY created_at`,
      [request.tenantId],
    )
    return {
      devices: rows.map((r) => ({
        id: r.id,
        label: r.label,
        revoked: r.revoked,
        createdAt: Math.round(Number(r.created_at)),
        lastSeenAt: r.last_seen_at == null ? null : Math.round(Number(r.last_seen_at)),
      })),
    }
  })

  app.post('/api/devices/enroll', async (request, reply) => {
    const parsed = enrollSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'Data tidak valid', issues: parsed.error.issues }
    }
    const hash = hashDeviceKey(parsed.data.deviceKey.trim())
    const existing = await getPool().query('SELECT id, revoked, tenant_id FROM sync_devices WHERE device_key_hash = $1', [hash])
    if (existing.rows.length > 0) {
      if (existing.rows[0].tenant_id !== request.tenantId) {
        reply.code(409)
        return { error: 'Kunci perangkat sudah dipakai oleh usaha lain.' }
      }
      if (existing.rows[0].revoked) {
        await getPool().query('UPDATE sync_devices SET revoked = FALSE, label = $2 WHERE id = $1 AND tenant_id = $3', [
          existing.rows[0].id,
          parsed.data.label.trim(),
          request.tenantId,
        ])
        return { id: existing.rows[0].id, reactivated: true }
      }
      reply.code(409)
      return { error: 'Kunci perangkat ini sudah terdaftar.' }
    }
    const { rows } = await getPool().query<{ id: string }>(
      'INSERT INTO sync_devices (label, device_key_hash, tenant_id) VALUES ($1, $2, $3) RETURNING id',
      [parsed.data.label.trim(), hash, request.tenantId],
    )
    reply.code(201)
    return { id: rows[0].id }
  })

  app.post('/api/devices/:id/revoke', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const { rowCount } = await getPool().query('UPDATE sync_devices SET revoked = TRUE WHERE id = $1 AND tenant_id = $2', [id, request.tenantId])
    if (!rowCount) {
      reply.code(404)
      return { error: 'Perangkat tidak ditemukan.' }
    }
    return { ok: true }
  })

  app.post('/api/devices/:id/rename', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = renameSchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'Nama tidak valid.' }
    }
    const { rowCount } = await getPool().query('UPDATE sync_devices SET label = $2 WHERE id = $1 AND tenant_id = $3', [
      id,
      parsed.data.label.trim(),
      request.tenantId,
    ])
    if (!rowCount) {
      reply.code(404)
      return { error: 'Perangkat tidak ditemukan.' }
    }
    return { ok: true }
  })
}
