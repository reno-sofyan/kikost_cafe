import { getApiBaseUrl, getDeviceKey, isBackendConfigured } from '@/sync/deviceConfig'
import { runSyncCycle } from '@/sync/engine'

/**
 * Mendengarkan sinyal SSE "ada perubahan" dari server → memicu tarik-sync
 * seketika. Bukan pengganti poll berkala (tetap jalan sebagai fallback),
 * hanya mempercepat kemunculan mis. pesanan QR baru.
 */
export function startEventStream(): () => void {
  if (!isBackendConfigured() || typeof EventSource === 'undefined') return () => {}

  let es: EventSource | null = null
  let retry = 0
  let stopped = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const connect = () => {
    if (stopped) return
    const base = getApiBaseUrl().replace(/\/+$/, '')
    const key = getDeviceKey()
    if (!base || !key) return
    try {
      es = new EventSource(`${base}/api/events?key=${encodeURIComponent(key)}`)
    } catch {
      scheduleReconnect()
      return
    }

    es.addEventListener('sync', () => {
      void runSyncCycle()
    })
    es.onopen = () => {
      retry = 0
    }
    es.onerror = () => {
      es?.close()
      es = null
      scheduleReconnect()
    }
  }

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return
    const delay = Math.min(3000 * 2 ** Math.min(retry, 4), 60_000)
    retry++
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  connect()
  const onOnline = () => {
    if (!es) {
      retry = 0
      connect()
    }
  }
  window.addEventListener('online', onOnline)

  return () => {
    stopped = true
    window.removeEventListener('online', onOnline)
    if (reconnectTimer) clearTimeout(reconnectTimer)
    es?.close()
  }
}
