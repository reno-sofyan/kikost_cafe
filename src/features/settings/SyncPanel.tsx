import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { useSyncStore } from '@/state/syncStore'
import { isBackendConfigured, pingBackend } from '@/sync/client'
import { triggerManualSync } from '@/sync/engine'
import {
  clearDeviceSyncConfig,
  getApiBaseUrl,
  getDeviceKey,
  hasStoredOverride,
  saveDeviceSyncConfig,
} from '@/sync/deviceConfig'
import { getDeviceId } from '@/sync/device'
import { formatDateTime } from '@/lib/datetime'
import { Icon } from '@/components/ui/Icon'

export function SyncPanel() {
  const sync = useSyncStore()
  const failedEntries = useLiveQuery(() => db.syncQueue.where('status').equals('failed').reverse().sortBy('updatedAt'), []) ?? []
  const pendingEntries = useLiveQuery(() => db.syncQueue.where('status').equals('pending').count(), []) ?? 0

  const [apiUrl, setApiUrl] = useState(getApiBaseUrl())
  const [deviceKey, setDeviceKey] = useState(getDeviceKey())
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [saved, setSaved] = useState(false)

  async function handleTest() {
    setTestState('testing')
    saveDeviceSyncConfig({ apiBaseUrl: apiUrl, deviceKey })
    const ok = await pingBackend()
    setTestState(ok ? 'ok' : 'fail')
  }

  function handleSave() {
    saveDeviceSyncConfig({ apiBaseUrl: apiUrl, deviceKey })
    setSaved(true)
    setTestState('idle')
    setTimeout(() => setSaved(false), 2500)
    void triggerManualSync()
  }

  function handleReset() {
    clearDeviceSyncConfig()
    setApiUrl(getApiBaseUrl())
    setDeviceKey(getDeviceKey())
    setTestState('idle')
  }

  function generateKey() {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    setDeviceKey(Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''))
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="card p-5">
        <h3 className="mb-3 font-semibold text-ink-100">Status Sinkronisasi</h3>
        {!isBackendConfigured() && (
          <p className="mb-3 rounded-lg bg-yellow-900/20 p-3 text-sm text-yellow-400">
            Backend belum dikonfigurasi. Aplikasi tetap dapat digunakan sepenuhnya secara offline; data akan tersinkron
            otomatis setelah backend diatur di bawah.
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

      <div className="card p-5">
        <h3 className="mb-1 font-semibold text-ink-100">Konfigurasi Backend Perangkat</h3>
        <p className="mb-3 text-xs text-ink-500">
          ID perangkat: <span className="font-mono">{getDeviceId()}</span>
          {hasStoredOverride() ? ' • memakai konfigurasi tersimpan di tablet ini' : ' • memakai nilai bawaan build'}
        </p>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-ink-300">URL Backend</span>
          <input
            className="input-field"
            placeholder="https://pos.kikost.com"
            value={apiUrl}
            onChange={(e) => {
              setApiUrl(e.target.value)
              setTestState('idle')
            }}
          />
        </label>

        <label className="mb-2 block">
          <span className="mb-1 block text-sm text-ink-300">Kunci Perangkat</span>
          <input
            className="input-field font-mono text-sm"
            placeholder="tempel kunci dari administrator"
            value={deviceKey}
            onChange={(e) => {
              setDeviceKey(e.target.value)
              setTestState('idle')
            }}
          />
        </label>
        <button className="mb-3 text-xs text-brew-400 hover:underline" onClick={generateKey}>
          Buat kunci acak
        </button>

        {testState === 'ok' && <p className="mb-2 text-sm text-sage-500">Koneksi backend berhasil.</p>}
        {testState === 'fail' && (
          <p className="mb-2 text-sm text-red-400">Gagal terhubung. Periksa URL, kunci, dan koneksi internet.</p>
        )}
        {saved && <p className="mb-2 text-sm text-sage-500">Konfigurasi disimpan.</p>}

        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" disabled={testState === 'testing' || !apiUrl.trim()} onClick={() => void handleTest()}>
            {testState === 'testing' ? 'Menguji...' : 'Uji Koneksi'}
          </button>
          <button className="btn-primary" disabled={!apiUrl.trim()} onClick={handleSave}>
            Simpan
          </button>
          {hasStoredOverride() && (
            <button className="btn-ghost" onClick={handleReset}>
              Kembalikan ke bawaan
            </button>
          )}
        </div>
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
