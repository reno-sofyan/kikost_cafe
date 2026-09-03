import { db } from '@/db/schema'
import { useSyncStore } from '@/state/syncStore'
import { getDeviceId, getLastPullAt, setLastPullAt } from '@/sync/device'
import { applyRemoteEntities } from '@/sync/applyRemote'
import { isBackendConfigured, pullSyncChanges, pushSyncBatch, type SyncPushItem } from '@/sync/client'
import type { SyncQueueEntry } from '@/types/domain'

const PUSH_BATCH_SIZE = 25
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
    const batch = candidates.filter(eligibleForRetry).slice(0, PUSH_BATCH_SIZE)
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

    if (batch.length < PUSH_BATCH_SIZE) hasMore = false
  }
}

async function pullRemoteChanges(): Promise<void> {
  const since = getLastPullAt()
  const response = await pullSyncChanges(since)
  await applyRemoteEntities(response.entities)
  setLastPullAt(response.serverTime)
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

  // 10 dtk: cukup responsif untuk memunculkan pesanan QR baru di kasir tanpa
  // membebani backend (single-tablet, payload kecil). Push tetap segera saat online.
  intervalHandle = setInterval(() => {
    void runSyncCycle()
    void refreshPendingCounts()
  }, 10_000)

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
