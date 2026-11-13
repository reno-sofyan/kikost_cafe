import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings, businessDisplayName } from '@/db/repositories/settings'
import { getDeviceId, getDeviceLabel } from '@/sync/device'
import { getApiBaseUrl } from '@/sync/deviceConfig'
import { ensurePersistentStorage, getStoragePersistStatus } from '@/lib/persistentStorage'
import { Icon } from '@/components/ui/Icon'
import { PRODUCT_LOGO, PRODUCT_NAME, PRODUCT_TAGLINE, PRODUCT_VERSION } from '@/lib/brand'
import { useUiPrefsStore } from '@/state/uiPrefsStore'
import { useSessionStore } from '@/state/sessionStore'
import { useDeveloperUnlocked } from '@/state/developerStore'
import { useSyncStore } from '@/state/syncStore'
import { DEVELOPER_ONLY, DEVELOPER_TOKEN_LENGTH, lockDeveloperMode, pairAndUnlockDeveloperMode, unlockDeveloperMode } from '@/lib/developerAccess'
import { Capacitor } from '@capacitor/core'
import { RECOMMENDED_WEBVIEW_VERSION, webViewChromeVersion } from '@/lib/legacyWebView'
import { getDeviceKey } from '@/sync/deviceConfig'
import { Button } from '@/components/ui/Button'

/**
 * Panel "Tentang". Selain identitas produk, panel ini adalah tempat pertama
 * yang dibuka saat meminta bantuan — jadi ia menampilkan data yang biasanya
 * ditanyakan lebih dulu (versi, id perangkat, alamat server) dalam bentuk yang
 * gampang dibacakan lewat telepon.
 */
export function AboutPanel() {
  const settings = useLiveQuery(() => getSettings(), [])
  const apiBaseUrl = getApiBaseUrl()
  const haptics = useUiPrefsStore((s) => s.haptics)
  const setHaptics = useUiPrefsStore((s) => s.setHaptics)
  const [storageStatus, setStorageStatus] = useState(getStoragePersistStatus())

  useEffect(() => {
    // ensurePersistentStorage() sudah dipanggil sekali di main.tsx; panggilan di sini
    // aman diulang (browser yang sudah mengizinkan langsung menjawab `true` lagi) dan
    // memastikan panel ini menunjukkan status terkini saat dibuka, bukan status basi
    // dari sebelum izin diberikan/ditolak oleh OS.
    let alive = true
    void ensurePersistentStorage().then((r) => alive && setStorageStatus(r))
    return () => {
      alive = false
    }
  }, [])

  const storageLabel = !storageStatus.supported
    ? 'Tidak didukung perangkat ini'
    : storageStatus.persisted
      ? 'Terkunci (aman dari penghapusan otomatis)'
      : 'Belum terkunci — cadangkan data secara berkala'

  const webView = webViewChromeVersion()
  const rows: { label: string; value: string }[] = [
    { label: 'Versi aplikasi', value: PRODUCT_VERSION },
    { label: 'Usaha terdaftar', value: businessDisplayName(settings) },
    { label: 'Perangkat', value: getDeviceLabel() || '—' },
    { label: 'ID perangkat', value: getDeviceId() },
    { label: 'Server sinkronisasi', value: apiBaseUrl || 'Belum diatur (mode offline penuh)' },
    { label: 'Zona waktu', value: settings?.timezone ?? '—' },
    { label: 'Penyimpanan data', value: storageLabel },
    { label: 'WebView (mesin tampilan)', value: webView ? `Chrome ${webView}` : '—' },
  ]

  return (
    <div className="max-w-xl space-y-6">
      <div className="card flex items-center gap-4 p-5">
        <img src={PRODUCT_LOGO} alt={PRODUCT_NAME} className="h-9 w-auto" />
        <div className="min-w-0">
          <p className="text-sm text-ink-200">{PRODUCT_TAGLINE}</p>
        </div>
      </div>

      <div className="card divide-y divide-ink-700 overflow-hidden">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start justify-between gap-4 px-5 py-3">
            <span className="flex-none text-sm text-ink-300">{r.label}</span>
            <span className="min-w-0 break-all text-right text-sm font-medium text-ink-50">{r.value}</span>
          </div>
        ))}
      </div>

      {webView != null && webView < RECOMMENDED_WEBVIEW_VERSION && (
        <div className="card flex items-start gap-3 border-accent-500/40 p-5 text-sm text-ink-200">
          <span className="mt-0.5 flex-none text-accent-500">
            <Icon name="alertTriangle" size={18} />
          </span>
          <p>
            WebView tablet ini versi lama (Chrome {webView}). Aplikasi tetap berjalan, tetapi tampilan paling rapi dengan versi terbaru: buka{' '}
            <b>Play Store</b>, cari <b>Android System WebView</b>, lalu ketuk <b>Perbarui</b>.
          </p>
        </div>
      )}

      {/* Preferensi perangkat ini saja (tiap tablet bisa beda) — lihat uiPrefsStore. */}
      <label className="card flex cursor-pointer items-center justify-between gap-4 p-5">
        <span>
          <span className="block text-sm font-semibold text-ink-50">Getar saat tombol ditekan</span>
          <span className="block text-xs text-ink-300">Getar ringan di tablet Android sebagai tanda ketukan diterima. Hanya untuk perangkat ini.</span>
        </span>
        <input type="checkbox" className="h-5 w-5 flex-none" checked={haptics} onChange={(e) => setHaptics(e.target.checked)} />
      </label>

      <DeveloperAccessCard />

      <div className="card flex items-start gap-3 p-5 text-sm text-ink-200">
        <span className="mt-0.5 flex-none text-brand-400">
          <Icon name="alertTriangle" size={18} />
        </span>
        <p>
          Data transaksi tersimpan di perangkat ini. Sinkronisasi server & backup diatur oleh developer — hubungi developer bila
          perangkat belum tersambung ke server, karena tanpa itu kerusakan perangkat berarti data hilang.
        </p>
      </div>
    </div>
  )
}

/** Mode Developer: dibuka dengan token 4 angka sekali pakai dari Konsol Operator (/ops). */
function DeveloperAccessCard() {
  const unlocked = useDeveloperUnlocked()
  const user = useSessionStore((s) => s.currentUser)
  // Kunci perangkat ditolak server (dicabut / salah ketik): token developer pun tak bisa
  // dicek, jadi tawarkan kode pasang lagi supaya tablet tak terkunci di luar.
  const keyRejected = useSyncStore((s) => /HTTP 401/.test(s.lastError ?? ''))
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Satu-satunya jalur kirim (form submit): token sekali pakai tak boleh terkirim dua kali.
  async function submit() {
    if (!user || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await unlockDeveloperMode(token, { userId: user.id, userName: user.name })
      if (!res.ok) setError(res.message)
    } finally {
      setToken('')
      setBusy(false)
    }
  }

  return (
    <div className="card p-5">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink-50">
        <Icon name={unlocked ? 'settings' : 'lock'} size={16} className="text-brand-400" /> Mode Developer
      </p>
      {unlocked ? (
        <>
          <p className="mt-1 text-xs text-ink-300">Aktif sampai keluar akun. Pengaturan teknis terbuka:</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-ink-200">
            {DEVELOPER_ONLY.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <Button variant="secondary" size="sm" className="mt-3" leftIcon={<Icon name="lock" size={15} />} onClick={lockDeveloperMode}>
            Kunci sekarang
          </Button>
        </>
      ) : !getDeviceKey() || keyRejected ? (
        <PairingForm rejected={keyRejected && !!getDeviceKey()} />
      ) : (
        <>
          <p className="mt-1 text-xs text-ink-300">
            Pengaturan teknis (sinkronisasi, backup, penyedia QRIS, pager, barcode timbangan) hanya untuk developer. Masukkan token {DEVELOPER_TOKEN_LENGTH} angka
            dari Konsol Operator — sekali pakai, butuh internet.
          </p>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <input
              className="input-field max-w-[9rem] text-center text-lg tracking-[0.4em]"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={DEVELOPER_TOKEN_LENGTH}
              aria-label="Token developer"
              placeholder="••••"
              value={token}
              onChange={(e) => setToken(e.target.value.replace(/\D/g, ''))}
            />
            <Button type="submit" disabled={token.length !== DEVELOPER_TOKEN_LENGTH} loading={busy}>
              Buka
            </Button>
          </form>
          {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
        </>
      )}
    </div>
  )
}

/** Alamat server bawaan untuk tablet baru: aplikasi web memakai domainnya sendiri; APK ke server produksi. */
function defaultServerUrl(): string {
  if (Capacitor.isNativePlatform()) return 'https://pos.kikost.com'
  return window.location.origin
}

/**
 * Tablet BARU (belum punya kunci perangkat — token developer belum bisa dicek): kode pasang
 * 8 karakter dari Konsol Operator → tablet mendapat kunci perangkat sendiri & Mode Developer
 * terbuka; isian tab Sinkronisasi sudah terisi, developer tinggal menekan Simpan.
 */
function PairingForm({ rejected = false }: { rejected?: boolean }) {
  const user = useSessionStore((s) => s.currentUser)
  const [server, setServer] = useState(defaultServerUrl)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function submit() {
    if (!user || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await pairAndUnlockDeveloperMode(server, code, `Tablet ${getDeviceLabel()}`, { userId: user.id, userName: user.name })
      if (res.ok) setDone(true)
      else setError(res.message)
    } finally {
      setCode('')
      setBusy(false)
    }
  }

  if (done) return <p className="mt-2 text-sm text-success-500">Tablet dipasangkan. Buka tab Sinkronisasi — isian sudah terisi — lalu tekan Uji Koneksi & Simpan.</p>

  return (
    <>
      <p className="mt-1 text-xs text-ink-300">
        {rejected ? 'Kunci perangkat tablet ini ditolak server (HTTP 401) — mungkin sudah dicabut atau salah ketik.' : 'Perangkat ini belum tersambung ke server.'} Developer: buat{' '}
        <b>Kode Pasang Tablet</b> di Konsol Operator, lalu masukkan di sini (sekali pakai, butuh internet).
      </p>
      <form
        className="mt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <input className="input-field" aria-label="Alamat server" autoComplete="off" value={server} onChange={(e) => setServer(e.target.value)} />
        <div className="flex gap-2">
          <input
            className="input-field max-w-[12rem] text-center font-semibold uppercase tracking-[0.2em]"
            aria-label="Kode pasang"
            autoComplete="off"
            autoCapitalize="characters"
            maxLength={9}
            placeholder="XXXX-XXXX"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <Button type="submit" disabled={code.replace(/[\s-]/g, '').length !== 8} loading={busy}>
            Pasangkan
          </Button>
        </div>
      </form>
      {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
    </>
  )
}
