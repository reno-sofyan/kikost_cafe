import { db } from '@/db/schema'
import { getSettings } from '@/db/repositories/settings'
import { enqueueSync } from '@/sync/outbox'
import { jakartaDateKey } from '@/lib/datetime'
import { getTrustedNow } from '@/lib/clockGuard'
import { resolvePagerDriver } from '@/features/pager/pagerDrivers'
import type { Order } from '@/types/domain'

const TICK_MS = 15_000
/** Jeda minimum sebelum mencoba lagi order yang panggilannya gagal. */
const RETRY_BACKOFF_MS = 30_000

const lastAttemptAt = new Map<string, number>()

/** Tahap order yang pelanggannya masih memegang coaster (belum diambil/dibatalkan). */
const COASTER_HELD_STATUSES = ['PENDING_CONFIRMATION', 'DRAFT', 'CONFIRMED', 'PREPARING', 'READY'] as const

/**
 * Order hari ini yang masih memegang coaster fisik: yang sudah READY menunggu
 * diambil, dan — karena kasir bisa menyerahkan coaster saat memesan — yang masih
 * dibuat/disiapkan tapi sudah diberi nomor pager di Kasir.
 */
export async function coasterHoldingOrdersToday(): Promise<Order[]> {
  const todayKey = jakartaDateKey(getTrustedNow())
  return db.orders
    .where('lifecycleStatus')
    .anyOf([...COASTER_HELD_STATUSES])
    .filter((o) => o.status !== 'void' && jakartaDateKey(o.createdAt) === todayKey && (o.lifecycleStatus === 'READY' || o.pagerNumber != null))
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
  const holding = await coasterHoldingOrdersToday()
  const held = holding.filter((o) => o.pagerNumber != null).length
  const waitingForCoaster = holding.filter((o) => o.lifecycleStatus === 'READY' && o.pagerNumber == null && o.pagerCalledAt == null).length
  return {
    enabled: true,
    max: pagerConfig.maxPagerNumber,
    held,
    waitingForCoaster: held >= pagerConfig.maxPagerNumber ? waitingForCoaster : 0,
  }
}

/**
 * Kasir menyerahkan coaster saat memesan: catat nomornya di order (null = lepas).
 * Saat order siap, pager engine membunyikan nomor ini, bukan memilih nomor baru.
 * Ditolak bila di luar 1..maxPagerNumber atau masih dipegang pesanan lain hari ini.
 */
export async function setOrderPagerNumber(orderId: string, pagerNumber: number | null): Promise<void> {
  const { pagerConfig } = await getSettings()
  if (pagerNumber != null) {
    if (!Number.isInteger(pagerNumber) || pagerNumber < 1 || pagerNumber > pagerConfig.maxPagerNumber) {
      throw new Error(`Nomor pager harus 1–${pagerConfig.maxPagerNumber}.`)
    }
    const holder = (await coasterHoldingOrdersToday()).find((o) => o.id !== orderId && o.pagerNumber === pagerNumber)
    if (holder) throw new Error(`Pager #${pagerNumber} masih dipegang pesanan ${holder.orderNumber}.`)
  }
  await db.transaction('rw', db.orders, db.syncQueue, async () => {
    const fresh = await db.orders.get(orderId)
    if (!fresh) throw new Error('Pesanan tidak ditemukan')
    if (fresh.pagerCalledAt != null) throw new Error('Pager pesanan ini sudah dipanggil — nomornya tak bisa diganti.')
    await db.orders.update(orderId, { pagerNumber, updatedAt: getTrustedNow() })
    const updated = await db.orders.get(orderId)
    if (updated) await enqueueSync('orders', orderId, updated)
  })
}

/** Tetapkan `pagerNumber` + `pagerCalledAt` pada sebuah order (di dalam transaksi), lalu sinkronkan. */
async function assignPagerNumber(orderId: string, pagerNumber: number): Promise<void> {
  await db.transaction('rw', db.orders, db.syncQueue, async () => {
    const fresh = await db.orders.get(orderId)
    if (!fresh || fresh.pagerCalledAt != null) return
    await db.orders.update(orderId, {
      pagerNumber,
      pagerCalledAt: getTrustedNow(),
      updatedAt: getTrustedNow(),
    })
    const updated = await db.orders.get(orderId)
    if (updated) await enqueueSync('orders', orderId, updated)
  })
}

/**
 * Memindai order yang baru siap (lifecycle READY) dan menetapkan nomor coaster
 * dari kumpulan 1..maxPagerNumber — sekali per order. Perilakunya bercabang
 * menurut `connectionType`:
 *
 * - `usb-serial`: mengirim perintah panggil ke base station lewat driver;
 *   `pagerCalledAt` baru ditandai setelah pengiriman BERHASIL, dan dicoba lagi
 *   dengan backoff bila gagal (kabel lepas, port sibuk, dst.).
 * - `manual`: base station keypad-only (mis. iWare Q10M, Retekess TD157) tidak
 *   punya antarmuka apa pun untuk dikirimi perintah — nomor langsung ditetapkan
 *   & ditandai (tak ada transport yang bisa gagal/di-retry). Layar Dapur
 *   menampilkannya sebagai instruksi untuk staf memencet manual di keypad.
 *
 * Nomor coaster didaur ulang: begitu order lepas dari READY (diambil/dibatalkan)
 * nomornya bebas dipakai order berikutnya, jadi hari sibuk dengan lebih dari
 * `maxPagerNumber` pesanan tetap kebagian coaster. Bila semua coaster sedang
 * dipakai, order menunggu dan dicoba lagi siklus berikutnya.
 *
 * `order.pagerCalledAt` + `order.pagerNumber` ikut tersinkron, jadi kalau
 * perangkat lain sudah memanggil/menetapkan, perangkat ini melewatinya.
 * Perangkat tanpa pager (`connectionType: 'none'`) tidak melakukan apa-apa.
 */
export async function processPagerQueue(): Promise<void> {
  const { pagerConfig } = await getSettings()
  if (pagerConfig.connectionType === 'none' || !pagerConfig.autoCallOnReady) return

  const holding = await coasterHoldingOrdersToday()
  const pending = holding
    .filter((o) => o.lifecycleStatus === 'READY' && o.pagerCalledAt == null)
    .sort((a, b) => a.createdAt - b.createdAt)
  if (pending.length === 0) return

  const driver = pagerConfig.connectionType === 'usb-serial' ? resolvePagerDriver(pagerConfig) : null
  const now = getTrustedNow()

  for (const order of pending) {
    const prev = lastAttemptAt.get(order.id)
    if (prev != null && now - prev < RETRY_BACKOFF_MS) continue

    const pagerNumber =
      order.pagerNumber ?? pickFreePagerNumber(holding, pagerConfig.maxPagerNumber, order.id)
    if (pagerNumber == null) {
      // Semua coaster sedang dipakai — coba lagi siklus berikutnya (tanpa backoff)
      // saat ada order yang diambil pelanggan dan nomornya bebas.
      console.warn(
        `[pager] semua ${pagerConfig.maxPagerNumber} coaster sedang dipakai; ${order.orderNumber} menunggu coaster bebas`,
      )
      continue
    }

    if (driver == null) {
      // Mode manual: tidak ada transport untuk dicoba/gagal — langsung tetapkan.
      await assignPagerNumber(order.id, pagerNumber)
      order.pagerNumber = pagerNumber
      continue
    }

    lastAttemptAt.set(order.id, now)
    try {
      await driver.call(pagerNumber)
      await assignPagerNumber(order.id, pagerNumber)
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
