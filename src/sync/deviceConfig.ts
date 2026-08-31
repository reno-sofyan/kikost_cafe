// Konfigurasi koneksi backend per-perangkat.
//
// Prioritas: nilai yang disimpan pengguna (localStorage, lewat Pengaturan > Sinkronisasi)
// > nilai build-time (import.meta.env). Ini memungkinkan APK yang sama dipasang di
// beberapa tablet dan dikonfigurasi (URL + kunci perangkat) langsung di tablet,
// tanpa build ulang.

const API_BASE_URL_KEY = 'kikost.sync.apiBaseUrl'
const DEVICE_KEY_KEY = 'kikost.sync.deviceKey'

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

export function getApiBaseUrl(): string {
  const stored = readStored(API_BASE_URL_KEY)?.trim()
  return (stored && stored.length > 0 ? stored : envApiBaseUrl()).replace(/\/+$/, '')
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
      const clean = config.apiBaseUrl.trim().replace(/\/+$/, '')
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
