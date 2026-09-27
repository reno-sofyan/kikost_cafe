import type { FastifyInstance, FastifyReply } from 'fastify'
import { getPool } from '../db/pool.js'
import { authenticateDeviceKey } from '../lib/deviceAuth.js'
import { isAuthBlocked, recordAuthFailure, recordAuthSuccess } from '../lib/authThrottle.js'

/**
 * SSE "ada perubahan" — mendorong sinyal ringan ke perangkat sehingga tarik-sync
 * terjadi seketika, bukan menunggu poll berkala. Bukan pengganti sync: payload
 * tetap ditarik lewat `/api/sync/pull`. Tetap kompatibel offline (klien punya
 * fallback poll).
 *
 * EventSource tak bisa mengirim header Authorization → kunci lewat query `?key=`.
 */
export async function registerEventRoutes(app: FastifyInstance): Promise<void> {
  const clients = new Map<FastifyReply, string>()
  const lastSeqByTenant = new Map<string, number>()
  let timer: NodeJS.Timeout | null = null

  async function currentSeq(tenantId: string): Promise<number> {
    try {
      const { rows } = await getPool().query<{ seq: string }>(
        'SELECT COALESCE(MAX(server_seq), 0) AS seq FROM sync_entity_state WHERE tenant_id = $1',
        [tenantId],
      )
      return Number(rows[0]?.seq ?? 0)
    } catch {
      return lastSeqByTenant.get(tenantId) ?? 0
    }
  }

  function ensurePolling() {
    if (timer || clients.size === 0) return
    timer = setInterval(async () => {
      if (clients.size === 0) {
        if (timer) clearInterval(timer)
        timer = null
        return
      }
      const tenants = new Set(clients.values())
      for (const tenantId of tenants) {
        const seq = await currentSeq(tenantId)
        const lastSeq = lastSeqByTenant.get(tenantId) ?? 0
        if (seq <= lastSeq) continue
        lastSeqByTenant.set(tenantId, seq)
        const frame = `event: sync\ndata: ${seq}\n\n`
        for (const [reply, clientTenantId] of clients) {
          if (clientTenantId !== tenantId) continue
          try {
            reply.raw.write(frame)
          } catch {
            clients.delete(reply)
          }
        }
      }
    }, 2500)
  }

  app.get('/api/events', async (request, reply) => {
    if (isAuthBlocked(request.ip)) {
      reply.code(429)
      return { error: 'Terlalu banyak percobaan gagal.' }
    }
    const key = String((request.query as { key?: string }).key ?? '')
    const device = await authenticateDeviceKey(key)
    if (!device) {
      recordAuthFailure(request.ip)
      reply.code(401)
      return { error: 'Kunci perangkat tidak sah' }
    }
    recordAuthSuccess(request.ip)

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    const seq = await currentSeq(device.tenantId)
    reply.raw.write(`event: hello\ndata: ${seq}\n\n`)
    lastSeqByTenant.set(device.tenantId, Math.max(lastSeqByTenant.get(device.tenantId) ?? 0, seq))
    clients.set(reply, device.tenantId)
    ensurePolling()

    const keepAlive = setInterval(() => {
      try {
        reply.raw.write(': ping\n\n')
      } catch {
        /* ditutup */
      }
    }, 25_000)

    request.raw.on('close', () => {
      clearInterval(keepAlive)
      clients.delete(reply)
    })

    return reply
  })

  app.addHook('onClose', async () => {
    if (timer) clearInterval(timer)
    for (const reply of clients.keys()) {
      try {
        reply.raw.end()
      } catch {
        /* noop */
      }
    }
    clients.clear()
    lastSeqByTenant.clear()
  })
}
