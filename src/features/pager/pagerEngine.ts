import { db } from '@/db/schema'
import { getSettings } from '@/db/repositories/settings'
import { enqueueSync } from '@/sync/outbox'
import { jakartaDateKey } from '@/lib/datetime'
import { resolvePagerDriver } from '@/features/pager/pagerDrivers'
import type { Order } from '@/types/domain'

const TICK_MS = 15_000
/** Jeda minimum sebelum mencoba lagi order yang panggilannya gagal. */
const RETRY_BACKOFF_MS = 30_000

const lastAttemptAt = new Map<string, number>()

/** Order hari ini yang masih menunggu diambil pelanggan (memegang coaster fisik). */
async function readyOrdersToday(): Promise<Order[]> {
  const todayKey = jakartaDateKey(Date.now())
  return db.orders
    .where('lifecycleStatus')
    .equals('READY')
    .filter((o) => o.status !== 'void' && jakartaDateKey(o.createdAt) === todayKey)
    .toArray()
}

/**
 * Nomor coaster bebas terkecil dalam 1..max yang belum dipegang order lain yang
 * masih READY hari ini. `null` bila kumpulan penuh (semua coaster sedang dipakai).
 */
export function pickFreePagerNumber(readyOrders: Order[], max: number, excludeOrderId?: string): number | null {
  const held = new Set<number>()
  for (const o of readyOrders) {
    if (o.id === excludeOrderId) continue
    if (o.pagerNumber != null) held.add(o.pagerNumber)
  }
  for (let n = 1; n <= max; n += 1) if (!held.has(n)) return n
  return null
}

export interface PagerPoolSnapshot {
  enabled: boolean
  max: number
  held: number
  /** Order READY yang belum kebagian coaster karena kumpulan penuh. */
  waitingForCoaster: number
}

/** Ringkasan pemakaian coaster untuk ditampilkan di Layar Dapur / Kasir. */
export async function getPagerPoolSnapshot(): Promise<PagerPoolSnapshot> {
  const { pagerConfig } = await getSettings()
  if (pagerConfig.connectionType === 'none') {
    return { enabled: false, max: pagerConfig.maxPagerNumber, held: 0, waitingForCoaster: 0 }
  }
  const ready = await readyOrdersToday()
  const held = ready.filter((o) => o.pagerNumber != null).length
  const waitingForCoaster = ready.filter((o) => o.pagerNumber == null && o.pagerCalledAt == null).length
  return {
    enabled: true,
    max: pagerConfig.maxPagerNumber,
    held,
    waitingForCoaster: held >= pagerConfig.maxPagerNumber ? waitingForCoaster : 0,
  }
}

/**
 * Memindai order yang baru siap (lifecycle READY) dan membunyikan pager Retekess
 * memakai nomor coaster dari kumpulan 1..maxPagerNumber — sekali per order.
 *
 * Nomor coaster didaur ulang: begitu order lepas dari READY (diambil/dibatalkan)
 * nomornya bebas dipakai order berikutnya, jadi hari sibuk dengan lebih dari
 * `maxPagerNumber` pesanan tetap kebagian coaster. Bila semua coaster sedang
 * dipakai, order menunggu dan dicoba lagi siklus berikutnya.
 *
 * `order.pagerCalledAt` + `order.pagerNumber` ikut tersinkron, jadi kalau
 * perangkat lain sudah memanggil, perangkat ini melewatinya. Perangkat tanpa
 * hardware pager (`connectionType: 'none'`) tidak melakukan apa-apa.
 */
export async function processPagerQueue(): Promise<void> {
  const { pagerConfig } = await getSettings()
  if (pagerConfig.connectionType === 'none' || !pagerConfig.autoCallOnReady) return

  const ready = await readyOrdersToday()
  const pending = ready
    .filter((o) => o.pagerCalledAt == null)
    .sort((a, b) => a.createdAt - b.createdAt)
  if (pending.length === 0) return

  const driver = resolvePagerDriver(pagerConfig)
  const now = Date.now()

  for (const order of pending) {
    const prev = lastAttemptAt.get(order.id)
    if (prev != null && now - prev < RETRY_BACKOFF_MS) continue

    const pagerNumber =
      order.pagerNumber ?? pickFreePagerNumber(ready, pagerConfig.maxPagerNumber, order.id)
    if (pagerNumber == null) {
      // Semua coaster sedang dipakai — coba lagi siklus berikutnya (tanpa backoff)
      // saat ada order yang diambil pelanggan dan nomornya bebas.
      console.warn(
        `[pager] semua ${pagerConfig.maxPagerNumber} coaster sedang dipakai; ${order.orderNumber} menunggu coaster bebas`,
      )
      continue
    }

    lastAttemptAt.set(order.id, now)
    try {
      await driver.call(pagerNumber)
      await db.transaction('rw', db.orders, db.syncQueue, async () => {
        const fresh = await db.orders.get(order.id)
        if (!fresh || fresh.pagerCalledAt != null) return
        await db.orders.update(order.id, {
          pagerNumber,
          pagerCalledAt: Date.now(),
          updatedAt: Date.now(),
        })
        const updated = await db.orders.get(order.id)
        if (updated) await enqueueSync('orders', order.id, updated)
      })
      // Tandai lokal agar draw berikutnya di loop yang sama tidak memakai ulang nomor.
      order.pagerNumber = pagerNumber
      lastAttemptAt.delete(order.id)
    } catch (err) {
      console.warn(
        `[pager] gagal memanggil coaster #${pagerNumber} untuk ${order.orderNumber}:`,
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
