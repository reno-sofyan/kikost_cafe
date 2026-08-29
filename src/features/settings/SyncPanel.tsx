import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { useSyncStore } from '@/state/syncStore'
import { isBackendConfigured } from '@/sync/client'
import { triggerManualSync } from '@/sync/engine'
import { formatDateTime } from '@/lib/datetime'
import { Icon } from '@/components/ui/Icon'

export function SyncPanel() {
  const sync = useSyncStore()
  const failedEntries = useLiveQuery(() => db.syncQueue.where('status').equals('failed').reverse().sortBy('updatedAt'), []) ?? []
  const pendingEntries = useLiveQuery(() => db.syncQueue.where('status').equals('pending').count(), []) ?? 0

  return (
    <div className="max-w-lg space-y-6">
      <div className="card p-5">
        <h3 className="mb-3 font-semibold text-ink-100">Status Sinkronisasi</h3>
        {!isBackendConfigured() && (
          <p className="mb-3 rounded-lg bg-yellow-900/20 p-3 text-sm text-yellow-400">
            URL backend belum dikonfigurasi (VITE_API_BASE_URL). Aplikasi tetap dapat digunakan sepenuhnya secara offline;
            data akan tersinkron otomatis setelah backend dikonfigurasi.
          </p>
        )}
        <div className="mb-1 flex items-center gap-2 text-ink-200">
          <Icon name={sync.isOnline ? 'wifi' : 'wifiOff'} size={18} />
          {sync.isOnline ? 'Perangkat online' : 'Perangkat offline'}
        </div>
        <p className="text-sm text-ink-400">Menunggu sinkronisasi: {pendingEntries}</p>
        <p className="text-sm text-ink-400">Gagal sinkronisasi: {failedEntries.length}</p>
        {sync.lastSyncedAt && <p className="text-sm text-ink-400">Sinkron terakhir: {formatDateTime(sync.lastSyncedAt)}</p>}
        <button className="btn-primary mt-4 flex items-center gap-2" onClick={() => void triggerManualSync()}>
          <Icon name="refresh" size={16} className={sync.isSyncing ? 'animate-spin' : ''} />
          Sinkronkan Sekarang
        </button>
      </div>

      {failedEntries.length > 0 && (
        <div className="card p-5">
          <h3 className="mb-3 font-semibold text-ink-100">Log Kegagalan Sinkronisasi</h3>
          <div className="space-y-2">
            {failedEntries.map((entry) => (
              <div key={entry.id} className="rounded-lg bg-red-900/20 p-3 text-sm">
                <p className="text-red-300">
                  {entry.entity} • percobaan ke-{entry.attempts}
                </p>
                <p className="text-red-400">{entry.lastError}</p>
                <p className="text-xs text-ink-500">{formatDateTime(entry.updatedAt)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
