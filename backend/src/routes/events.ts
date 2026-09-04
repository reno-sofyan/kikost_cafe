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
  const clients = new Set<FastifyReply>()
  let lastSeq = 0
  let timer: NodeJS.Timeout | null = null

  async function currentSeq(): Promise<number> {
    try {
      const { rows } = await getPool().query<{ seq: string }>('SELECT last_value AS seq FROM sync_server_seq')
      return Number(rows[0]?.seq ?? 0)
    } catch {
      return lastSeq
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
      const seq = await currentSeq()
      if (seq > lastSeq) {
        lastSeq = seq
        const frame = `event: sync\ndata: ${seq}\n\n`
        for (const reply of clients) {
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
    reply.raw.write(`event: hello\ndata: ${await currentSeq()}\n\n`)
    lastSeq = Math.max(lastSeq, await currentSeq())
    clients.add(reply)
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
    for (const reply of clients) {
      try {
        reply.raw.end()
      } catch {
        /* noop */
      }
    }
    clients.clear()
  })
}
