import { useCallback, useEffect, useState } from 'react'
import { takePendingPairing } from '@/lib/developerAccess'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { useSyncStore } from '@/state/syncStore'
import { useSessionStore } from '@/state/sessionStore'
import { roleHasPermission } from '@/lib/permissions'
import {
  enrollSyncDevice,
  isBackendConfigured,
  listSyncDevices,
  pingBackend,
  renameSyncDevice,
  serverHasForeignCatalog,
  revokeSyncDevice,
  type SyncDevice,
  type SyncIdentity,
} from '@/sync/client'
import { checkTenantBinding, wipeLocalDataForNewTenant } from '@/sync/tenantGuard'
import { BUSINESS_TYPE_LABELS } from '@/lib/businessType'
import type { BusinessType } from '@/types/domain'
import { triggerManualSync } from '@/sync/engine'
import { enqueueFullResync } from '@/sync/outbox'
import { discardUntouchedSampleCatalog, isSampleCatalogUntouched, sampleCatalogIds } from '@/db/sampleCatalog'
import { toast } from '@/state/toastStore'
import {
  clearDeviceSyncConfig,
  getApiBaseUrl,
  getDeviceKey,
  hasStoredOverride,
  markFullResyncDone,
  needsFullResync,
  saveDeviceSyncConfig,
} from '@/sync/deviceConfig'
import { getDeviceId } from '@/sync/device'
import { formatDateTime } from '@/lib/datetime'
import { Icon } from '@/components/ui/Icon'
import { useConfirmDialog } from '@/components/ui/useConfirmDialog'
import { usePromptDialog } from '@/components/ui/usePromptDialog'

export function SyncPanel() {
  const sync = useSyncStore()
  const currentUser = useSessionStore((s) => s.currentUser)
  const canManageDevices = !!currentUser && roleHasPermission(currentUser.role, 'users.manage')
  const failedEntries = useLiveQuery(() => db.syncQueue.where('status').equals('failed').reverse().sortBy('updatedAt'), []) ?? []
  const pendingEntries = useLiveQuery(() => db.syncQueue.where('status').equals('pending').count(), []) ?? 0

  // Baru dipasangkan lewat kode pasang (Tentang → Mode Developer): isian terisi, tinggal Simpan.
  const [pending] = useState(takePendingPairing)
  const [apiUrl, setApiUrl] = useState(pending?.apiBaseUrl ?? getApiBaseUrl())
  const [deviceKey, setDeviceKey] = useState(pending?.deviceKey ?? getDeviceKey())
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [saved, setSaved] = useState(false)
  const [resyncState, setResyncState] = useState<'idle' | 'running' | 'done'>('idle')
  const [resyncCount, setResyncCount] = useState<number | null>(null)
  const [autoResyncDeferred, setAutoResyncDeferred] = useState(false)
  /** Kunci yang ditolak karena milik usaha lain (beserta kunci yang dipakai sebelumnya). */
  const [foreignTenant, setForeignTenant] = useState<{ identity: SyncIdentity; rejected: { apiBaseUrl: string; deviceKey: string } } | null>(null)
  const { confirm: confirmResync, dialog: resyncConfirmDialog } = useConfirmDialog()

  async function handleFullResync() {
    const ok = await confirmResync({
      title: 'Sinkron ulang semua data?',
      description:
        'Seluruh data lokal (produk, kategori, meja, riwayat, dll.) akan didorong ulang ke server, ' +
        'terlepas dari status sync sebelumnya. Pakai ini kalau backend baru dikonfigurasi di perangkat ' +
        'yang sudah lama dipakai offline. Proses bisa memakan waktu untuk data yang banyak.',
      confirmLabel: 'Sinkron Ulang',
    })
    if (!ok) return
    if (!(await tenantAllowed())) return
    setResyncState('running')
    try {
      const count = await enqueueFullResync()
      markFullResyncDone()
      setResyncCount(count)
      await triggerManualSync()
      setResyncState('done')
    } catch {
      setResyncState('idle')
    }
  }

  async function handleTest() {
    setTestState('testing')
    saveDeviceSyncConfig({ apiBaseUrl: apiUrl, deviceKey })
    const ok = await pingBackend()
    setTestState(ok ? 'ok' : 'fail')
  }

  function handleSave() {
    const previous = { apiBaseUrl: getApiBaseUrl(), deviceKey: getDeviceKey() }
    saveDeviceSyncConfig({ apiBaseUrl: apiUrl, deviceKey })
    setForeignTenant(null)
    setTestState('idle')
    void (async () => {
      // Kunci milik usaha lain sementara perangkat ini berisi data usaha: tolak &
      // kembalikan kunci lama, supaya data tak pernah terdorong ke tenant lain.
      if (!(await tenantAllowed(previous))) return
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      await syncAfterSave()
    })()
  }

  /**
   * Cek kunci aktif masih milik usaha perangkat ini. Server tak terjangkau = lolos
   * (mesin sinkron mengecek lagi sebelum mendorong data). Bila ditolak dan `previous`
   * diberikan, konfigurasi lama dipulihkan.
   */
  async function tenantAllowed(previous?: { apiBaseUrl: string; deviceKey: string }): Promise<boolean> {
    const res = await checkTenantBinding().catch(() => null)
    if (!res || res.ok) return true
    const rejected = { apiBaseUrl: getApiBaseUrl(), deviceKey: getDeviceKey() }
    if (previous) {
      saveDeviceSyncConfig(previous)
      setApiUrl(previous.apiBaseUrl)
      setDeviceKey(previous.deviceKey)
    }
    setForeignTenant({ identity: res.identity, rejected })
    return false
  }

  async function handleMoveToForeignTenant() {
    if (!foreignTenant) return
    const name = foreignTenant.identity.businessName ?? 'usaha lain'
    const ok = await confirmResync({
      title: `Hapus semua data di perangkat ini?`,
      description:
        `Perangkat ini akan dikosongkan (produk, transaksi, shift, pengguna, pengaturan) lalu disambungkan ke "${name}". ` +
        'Data yang belum tersinkron akan HILANG. Buat backup dulu di Pengaturan → Backup bila perlu. Tindakan ini tidak dapat dibatalkan.',
      confirmLabel: 'Hapus & Pindah',
      tone: 'danger',
    })
    if (!ok) return
    saveDeviceSyncConfig(foreignTenant.rejected)
    await wipeLocalDataForNewTenant()
  }

  /**
   * Backend baru (pertama kali disimpan, atau URL/kunci diganti) belum punya data
   * lama perangkat ini — dorong semuanya sekali, otomatis. Ditunda bila server
   * belum terjangkau supaya salah ketik URL tidak menumpuk antrean ganda.
   */
  async function syncAfterSave() {
    setAutoResyncDeferred(false)
    if (needsFullResync()) {
      if (await pingBackend()) {
        setResyncState('running')
        try {
          // Tablet tambahan: katalog contoh yang belum dipakai diganti katalog dari server.
          if ((await isSampleCatalogUntouched()) && (await serverHasForeignCatalog(sampleCatalogIds()))) {
            if (await discardUntouchedSampleCatalog()) toast.success('Katalog contoh di tablet ini diganti katalog dari server.')
          }
          const count = await enqueueFullResync()
          markFullResyncDone()
          setResyncCount(count)
          setResyncState('done')
        } catch {
          setResyncState('idle')
        }
      } else {
        setAutoResyncDeferred(true)
      }
    }
    await triggerManualSync()
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

        {canManageDevices && isBackendConfigured() && (
          <div className="mt-4 border-t border-ink-800 pt-4">
            <button
              className="btn-secondary flex items-center gap-2"
              disabled={resyncState === 'running'}
              onClick={() => void handleFullResync()}
            >
              <Icon name="refresh" size={16} className={resyncState === 'running' ? 'animate-spin' : ''} />
              {resyncState === 'running' ? 'Menyinkron ulang...' : 'Sinkron Ulang Semua Data'}
            </button>
            <p className="mt-2 text-xs text-ink-500">
              Dorong ulang semua data lokal ke server, termasuk yang sudah lama ada sebelum backend ini
              dikonfigurasi. Pakai sekali saat menyambungkan perangkat lama ke backend baru.
            </p>
            {resyncState === 'done' && resyncCount !== null && (
              <p className="mt-2 text-sm text-success-500">{resyncCount} item dimasukkan ke antrean & sedang disinkron.</p>
            )}
          </div>
        )}
      </div>
      {resyncConfirmDialog}

      {foreignTenant && (
        <div className="card border-red-500 p-5">
          <h3 className="mb-1 flex items-center gap-2 font-semibold text-red-400">
            <Icon name="alertTriangle" size={18} /> Kunci milik usaha lain
          </h3>
          <p className="text-sm text-ink-200">
            Kunci yang dimasukkan terdaftar untuk{' '}
            <span className="font-semibold">
              {foreignTenant.identity.businessName ?? 'usaha lain'}
              {foreignTenant.identity.businessType ? ` (${BUSINESS_TYPE_LABELS[foreignTenant.identity.businessType as BusinessType] ?? foreignTenant.identity.businessType})` : ''}
            </span>
            , sedangkan perangkat ini sudah berisi data usaha lain. Supaya data tidak tercampur, kunci tidak disimpan dan kunci sebelumnya dipulihkan.
          </p>
          <p className="mt-2 text-sm text-ink-300">Untuk memindahkan tablet ini ke usaha tersebut, kosongkan dulu datanya.</p>
          <div className="mt-3 flex gap-2">
            <button className="btn-secondary" onClick={() => setForeignTenant(null)}>
              Tetap di usaha ini
            </button>
            {canManageDevices && (
              <button className="btn-danger" onClick={() => void handleMoveToForeignTenant()}>
                Kosongkan perangkat &amp; pindah
              </button>
            )}
          </div>
        </div>
      )}

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
            placeholder="https://pos.usahaanda.com"
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
        <button className="mb-3 text-xs text-brand-400 hover:underline" onClick={generateKey}>
          Buat kunci acak
        </button>

        {testState === 'ok' && <p className="mb-2 text-sm text-success-500">Koneksi backend berhasil.</p>}
        {testState === 'fail' && (
          <p className="mb-2 text-sm text-red-400">Gagal terhubung. Periksa URL, kunci, dan koneksi internet.</p>
        )}
        {saved && <p className="mb-2 text-sm text-success-500">Konfigurasi disimpan.</p>}
        {autoResyncDeferred && (
          <p className="mb-2 text-sm text-yellow-400">
            Server belum terjangkau, jadi data lama perangkat ini belum dikirim. Tekan Simpan lagi saat sudah online.
          </p>
        )}

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

      {canManageDevices && isBackendConfigured() && <DeviceManager />}

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

function DeviceManager() {
  const [devices, setDevices] = useState<SyncDevice[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const { confirm, dialog: confirmDialog } = useConfirmDialog()
  const { prompt, dialog: promptDialog } = usePromptDialog()

  const load = useCallback(async () => {
    try {
      setDevices(await listSyncDevices())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat daftar perangkat.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function guard(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-5">
      <h3 className="mb-1 font-semibold text-ink-100">Perangkat Tersinkron</h3>
      <p className="mb-3 text-xs text-ink-500">
        Daftarkan tablet tambahan lalu masukkan kunci yang sama di tablet itu (Pengaturan → Sinkronisasi). Cabut
        perangkat yang hilang/dicuri — sync-nya langsung ditolak server.
      </p>

      {error && <p className="mb-2 rounded-lg bg-red-900/20 p-2 text-sm text-red-400">{error}</p>}

      <div className="mb-4 space-y-2">
        {(devices ?? []).map((d) => (
          <div key={d.id} className="flex items-center justify-between rounded-lg border border-ink-800 p-2.5 text-sm">
            <div className="min-w-0">
              <p className={`font-medium ${d.revoked ? 'text-ink-500 line-through' : 'text-ink-100'}`}>{d.label}</p>
              <p className="text-xs text-ink-500">
                {d.lastSeenAt ? `Terakhir sync ${formatDateTime(d.lastSeenAt)}` : 'Belum pernah sync'}
                {d.revoked ? ' • dicabut' : ''}
              </p>
            </div>
            <div className="flex flex-none gap-2">
              <button
                className="btn-ghost !min-h-[2.75rem] !px-2 !py-1 text-xs"
                onClick={async () => {
                  const next = await prompt({ title: 'Ubah Nama Perangkat', initialValue: d.label })
                  if (next) void guard(() => renameSyncDevice(d.id, next))
                }}
              >
                Ubah nama
              </button>
              {!d.revoked && (
                <button
                  className="btn-danger !min-h-[2.75rem] !px-2 !py-1 text-xs"
                  disabled={busy}
                  onClick={async () => {
                    const ok = await confirm({ title: `Cabut akses "${d.label}"?`, description: 'Perangkat itu tak bisa sync lagi.', confirmLabel: 'Cabut', tone: 'danger' })
                    if (ok) void guard(() => revokeSyncDevice(d.id))
                  }}
                >
                  Cabut
                </button>
              )}
            </div>
          </div>
        ))}
        {devices?.length === 0 && (
          <p className="text-sm text-ink-500">
            Belum ada perangkat terdaftar di database — tablet ini kemungkinan memakai kunci dari environment.
          </p>
        )}
      </div>

      <div className="space-y-2 border-t border-ink-800 pt-3">
        <p className="text-sm font-medium text-ink-200">Daftarkan perangkat baru</p>
        <input className="input-field !min-h-0 !py-2 text-sm" placeholder="Nama perangkat (mis. Tablet Bar)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input className="input-field !min-h-0 !py-2 font-mono text-xs" placeholder="Kunci perangkat (buat di tablet baru, tempel di sini)" value={key} onChange={(e) => setKey(e.target.value)} />
        <button
          className="btn-primary !min-h-[2.75rem] !py-2 text-sm"
          disabled={busy || !label.trim() || key.trim().length < 16}
          onClick={() =>
            void guard(async () => {
              await enrollSyncDevice(label.trim(), key.trim())
              setLabel('')
              setKey('')
            })
          }
        >
          Daftarkan
        </button>
      </div>
      {confirmDialog}
      {promptDialog}
    </div>
  )
}
