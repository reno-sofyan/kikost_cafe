// Konfigurasi koneksi backend per-perangkat.
//
// Prioritas: nilai yang disimpan pengguna (localStorage, lewat Pengaturan > Sinkronisasi)
// > nilai build-time (import.meta.env). Ini memungkinkan APK yang sama dipasang di
// beberapa tablet dan dikonfigurasi (URL + kunci perangkat) langsung di tablet,
// tanpa build ulang.

const API_BASE_URL_KEY = 'kione.sync.apiBaseUrl'
const DEVICE_KEY_KEY = 'kione.sync.deviceKey'
const FULL_RESYNC_FOR_KEY = 'kione.sync.fullResyncFor'

export interface DeviceSyncConfig {
  apiBaseUrl: string
  deviceKey: string
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function envApiBaseUrl(): string {
  return (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? ''
}

function envDeviceKey(): string {
  return (import.meta.env.VITE_DEVICE_SYNC_KEY as string | undefined)?.trim() ?? ''
}

/**
 * Perbaiki salah ketik umum: lupa skema (`pos.contoh.com` -> `https://pos.contoh.com`)
 * atau kepencet nempelin `/api` di akhir (bikin path jadi dobel, mis. `/api/api/sync/...`).
 * Tanpa ini, salah ketik begini bikin fetch() nyasar ke bundel HTML lokal aplikasi
 * sendiri alih-alih server, dan errornya jadi "Unexpected token '<'" yang membingungkan.
 */
function normalizeApiBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '')
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  url = url.replace(/\/api$/i, '')
  return url
}

export function getApiBaseUrl(): string {
  const stored = readStored(API_BASE_URL_KEY)?.trim()
  return normalizeApiBaseUrl(stored && stored.length > 0 ? stored : envApiBaseUrl())
}

export function getDeviceKey(): string {
  const stored = readStored(DEVICE_KEY_KEY)?.trim()
  return stored && stored.length > 0 ? stored : envDeviceKey()
}

export function getDeviceSyncConfig(): DeviceSyncConfig {
  return { apiBaseUrl: getApiBaseUrl(), deviceKey: getDeviceKey() }
}

/** true bila perangkat memakai nilai yang di-set manual (bukan warisan build-time). */
export function hasStoredOverride(): boolean {
  return Boolean(readStored(API_BASE_URL_KEY) || readStored(DEVICE_KEY_KEY))
}

export function saveDeviceSyncConfig(config: Partial<DeviceSyncConfig>): void {
  try {
    if (config.apiBaseUrl !== undefined) {
      const clean = normalizeApiBaseUrl(config.apiBaseUrl)
      if (clean) localStorage.setItem(API_BASE_URL_KEY, clean)
      else localStorage.removeItem(API_BASE_URL_KEY)
    }
    if (config.deviceKey !== undefined) {
      const clean = config.deviceKey.trim()
      if (clean) localStorage.setItem(DEVICE_KEY_KEY, clean)
      else localStorage.removeItem(DEVICE_KEY_KEY)
    }
  } catch {
    /* localStorage tidak tersedia — konfigurasi tidak tersimpan */
  }
}

export function clearDeviceSyncConfig(): void {
  try {
    localStorage.removeItem(API_BASE_URL_KEY)
    localStorage.removeItem(DEVICE_KEY_KEY)
  } catch {
    /* abaikan */
  }
}

export function isBackendConfigured(): boolean {
  return getApiBaseUrl().length > 0
}

/** Identitas backend aktif: URL + kunci (kunci menentukan tenant di server). */
function backendIdentity(): string {
  return `${getApiBaseUrl()}|${getDeviceKey()}`
}

/**
 * true bila backend aktif belum pernah menerima dorongan penuh data lokal dari
 * perangkat ini — backend baru pertama kali disimpan, atau URL/kunci diganti ke
 * server/tenant lain. Data yang ditulis sebelum itu (mis. katalog bawaan
 * onboarding) tak pernah masuk antrean sync dengan sendirinya, sehingga menu
 * pesan-mandiri QR kosong sampai sinkron ulang penuh dijalankan.
 */
export function needsFullResync(): boolean {
  return isBackendConfigured() && readStored(FULL_RESYNC_FOR_KEY) !== backendIdentity()
}

export function markFullResyncDone(): void {
  try {
    localStorage.setItem(FULL_RESYNC_FOR_KEY, backendIdentity())
  } catch {
    /* localStorage tidak tersedia — sinkron ulang penuh akan ditawarkan lagi */
  }
}
