import { db } from '@/db/schema'
import { useSyncStore } from '@/state/syncStore'
import { getDeviceId, getLastPullAt, setLastPullAt } from '@/sync/device'
import { applyRemoteDeletions, applyRemoteEntities } from '@/sync/applyRemote'
import { isBackendConfigured, pullSyncChanges, pushSyncBatch, type SyncPushItem } from '@/sync/client'
import type { SyncQueueEntry } from '@/types/domain'

// Server menerima ≤200 item & ≤8 MiB per push. 100 item memangkas jumlah request
// (batas laju 240/menit per IP) tanpa mendekati batas ukuran; batas byte menjaga
// batch berisi foto produk (data-url) tetap jauh di bawah 8 MiB.
const PUSH_MAX_ITEMS = 100
const PUSH_MAX_BYTES = 2 * 1024 * 1024
/** Pengaman putaran tarik berhalaman dalam satu siklus. */
const MAX_PULL_PAGES = 50
const RETRY_BACKOFF_BASE_MS = 5000
const MAX_ATTEMPTS_BEFORE_BACKOFF_CAP = 6

let isRunning = false
let intervalHandle: ReturnType<typeof setInterval> | null = null

export async function refreshPendingCounts(): Promise<void> {
  const pending = await db.syncQueue.where('status').equals('pending').count()
  const failed = await db.syncQueue.where('status').equals('failed').count()
  useSyncStore.getState().setCounts(pending, failed)
}

function eligibleForRetry(entry: SyncQueueEntry): boolean {
  if (entry.status === 'pending') return true
  if (entry.status !== 'failed') return false
  const backoff = Math.min(RETRY_BACKOFF_BASE_MS * 2 ** Math.min(entry.attempts, MAX_ATTEMPTS_BEFORE_BACKOFF_CAP), 5 * 60_000)
  return Date.now() - entry.updatedAt >= backoff
}

/** Menjalankan satu siklus sinkronisasi: kirim antrean lokal, lalu tarik perubahan dari server. */
export async function runSyncCycle(): Promise<void> {
  if (isRunning) return
  if (!isBackendConfigured()) return
  if (!navigator.onLine) return

  isRunning = true
  const store = useSyncStore.getState()
  store.setSyncing(true)
  try {
    await pushPendingQueue()
    await pullRemoteChanges()
    await refreshPendingCounts()
    useSyncStore.getState().setResult({ success: true })
  } catch (error) {
    useSyncStore.getState().setResult({ success: false, error: error instanceof Error ? error.message : String(error) })
  } finally {
    isRunning = false
    useSyncStore.getState().setSyncing(false)
  }
}

async function pushPendingQueue(): Promise<void> {
  const deviceId = getDeviceId()
  let hasMore = true
  while (hasMore) {
    const candidates = await db.syncQueue.where('status').anyOf(['pending', 'failed']).sortBy('createdAt')
    const eligible = candidates.filter(eligibleForRetry)
    const batch = takeBatch(eligible)
    if (batch.length === 0) {
      hasMore = false
      break
    }

    await db.syncQueue.bulkUpdate(batch.map((entry) => ({ key: entry.id, changes: { status: 'syncing' as const } })))

    const items: SyncPushItem[] = batch.map((entry) => ({
      entity: entry.entity,
      entityId: entry.entityId,
      idempotencyKey: entry.idempotencyKey,
      payload: entry.payload,
      ...(entry.operation === 'delete' ? { deleted: true } : {}),
    }))

    try {
      const response = await pushSyncBatch(deviceId, items)
      const resultByKey = new Map(response.results.map((r) => [r.idempotencyKey, r]))
      for (const entry of batch) {
        const result = resultByKey.get(entry.idempotencyKey)
        if (result && (result.status === 'accepted' || result.status === 'duplicate')) {
          await db.syncQueue.update(entry.id, { status: 'synced', updatedAt: Date.now(), lastError: null })
        } else {
          await db.syncQueue.update(entry.id, {
            status: 'failed',
            attempts: entry.attempts + 1,
            lastError: result?.error ?? 'Ditolak server',
            updatedAt: Date.now(),
          })
        }
      }
    } catch (error) {
      if (isRateLimited(error)) {
        // Server sedang membatasi laju — bukan kegagalan data. Kembalikan ke antrean
        // tanpa menambah `attempts`, supaya siklus berikut (≤20 dtk) langsung mencoba
        // lagi alih-alih menunggu backoff yang bisa mencapai 5 menit.
        await db.syncQueue.bulkUpdate(
          batch.map((entry) => ({
            key: entry.id,
            changes: { status: 'pending' as const, lastError: 'Server sibuk (HTTP 429), dicoba lagi otomatis', updatedAt: Date.now() },
          })),
        )
        throw error
      }
      await db.syncQueue.bulkUpdate(
        batch.map((entry) => ({
          key: entry.id,
          changes: {
            status: 'failed' as const,
            attempts: entry.attempts + 1,
            lastError: error instanceof Error ? error.message : 'Gagal terhubung ke server',
            updatedAt: Date.now(),
          },
        })),
      )
      hasMore = false
      throw error
    }

    if (batch.length >= eligible.length) hasMore = false
  }
}

/** Ambil entri terdepan sampai PUSH_MAX_ITEMS atau ±PUSH_MAX_BYTES (minimal satu entri). */
function takeBatch(eligible: SyncQueueEntry[]): SyncQueueEntry[] {
  const batch: SyncQueueEntry[] = []
  let bytes = 0
  for (const entry of eligible) {
    if (batch.length >= PUSH_MAX_ITEMS) break
    const size = JSON.stringify(entry.payload ?? null).length
    if (batch.length > 0 && bytes + size > PUSH_MAX_BYTES) break
    batch.push(entry)
    bytes += size
  }
  return batch
}

function isRateLimited(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 429
}

async function pullRemoteChanges(): Promise<void> {
  // Server membatasi baris per entitas; `hasMore` = masih ada sisa. Ditarik habis
  // dalam siklus ini supaya tablet baru/yang lama offline tak menunggu 20 dtk per halaman.
  for (let page = 0; page < MAX_PULL_PAGES; page++) {
    const response = await pullSyncChanges(getLastPullAt())
    await applyRemoteEntities(response.entities)
    await applyRemoteDeletions(response.deletions ?? {})
    setLastPullAt(response.serverTime)
    if (!response.hasMore) break
  }
}

export function startSyncEngine(): () => void {
  const handleOnline = () => {
    useSyncStore.getState().setOnline(true)
    void runSyncCycle()
  }
  const handleOffline = () => useSyncStore.getState().setOnline(false)

  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)

  void refreshPendingCounts()
  if (navigator.onLine) void runSyncCycle()

  // 20 dtk fallback: SSE (`startEventStream`) yang memicu tarik-sync seketika saat
  // ada perubahan; poll ini hanya jaring pengaman bila SSE putus. Push tetap
  // segera saat online.
  intervalHandle = setInterval(() => {
    void runSyncCycle()
    void refreshPendingCounts()
  }, 20_000)

  return () => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
    if (intervalHandle) clearInterval(intervalHandle)
  }
}

export async function triggerManualSync(): Promise<void> {
  await runSyncCycle()
}

export async function listFailedSyncEntries(): Promise<SyncQueueEntry[]> {
  return db.syncQueue.where('status').equals('failed').toArray()
}
