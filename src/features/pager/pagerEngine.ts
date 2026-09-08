import { db } from '@/db/schema'
import { getSettings } from '@/db/repositories/settings'
import { enqueueSync } from '@/sync/outbox'
import { jakartaDateKey } from '@/lib/datetime'
import { resolvePagerDriver } from '@/features/pager/pagerDrivers'

const TICK_MS = 15_000
/** Jeda minimum sebelum mencoba lagi order yang panggilannya gagal. */
const RETRY_BACKOFF_MS = 30_000

const lastAttemptAt = new Map<string, number>()

/**
 * Memindai order yang baru siap (lifecycle READY) dan membunyikan pager Retekess
 * memakai `order.queueNumber` sebagai nomor pager — sekali per order.
 *
 * `order.pagerCalledAt` ikut tersinkron, jadi kalau perangkat lain sudah
 * memanggil, perangkat ini melewatinya. Perangkat tanpa hardware pager
 * (`connectionType: 'none'`) tidak melakukan apa-apa.
 */
export async function processPagerQueue(): Promise<void> {
  const { pagerConfig } = await getSettings()
  if (pagerConfig.connectionType === 'none' || !pagerConfig.autoCallOnReady) return

  const todayKey = jakartaDateKey(Date.now())
  const candidates = await db.orders
    .where('lifecycleStatus')
    .equals('READY')
    .filter(
      (o) =>
        o.pagerCalledAt == null &&
        o.queueNumber != null &&
        o.queueNumber >= 1 &&
        o.queueNumber <= pagerConfig.maxPagerNumber &&
        o.status !== 'void' &&
        jakartaDateKey(o.createdAt) === todayKey,
    )
    .toArray()
  if (candidates.length === 0) return

  const driver = resolvePagerDriver(pagerConfig)
  const now = Date.now()

  for (const order of candidates) {
    const prev = lastAttemptAt.get(order.id)
    if (prev != null && now - prev < RETRY_BACKOFF_MS) continue
    lastAttemptAt.set(order.id, now)
    try {
      await driver.call(order.queueNumber as number)
      await db.transaction('rw', db.orders, db.syncQueue, async () => {
        const fresh = await db.orders.get(order.id)
        if (!fresh || fresh.pagerCalledAt != null) return
        await db.orders.update(order.id, { pagerCalledAt: Date.now(), updatedAt: Date.now() })
        const updated = await db.orders.get(order.id)
        if (updated) await enqueueSync('orders', order.id, updated)
      })
      lastAttemptAt.delete(order.id)
    } catch (err) {
      console.warn(
        `[pager] gagal memanggil pager #${order.queueNumber} untuk ${order.orderNumber}:`,
        err instanceof Error ? err.message : err,
      )
      // biarkan pagerCalledAt null → dicoba lagi setelah backoff
    }
  }
}

/** Mirip startPrintEngine: jalankan pemroses pager berkala. */
export function startPagerEngine(): () => void {
  void processPagerQueue()
  const handle = setInterval(() => void processPagerQueue(), TICK_MS)
  return () => clearInterval(handle)
}
