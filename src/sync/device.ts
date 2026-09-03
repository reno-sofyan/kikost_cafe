// Identitas perangkat & metadata sinkronisasi (bukan data transaksi) - aman disimpan di localStorage.
const DEVICE_ID_KEY = 'kikost.deviceId'
const DEVICE_LABEL_KEY = 'kikost.deviceLabel'
const LAST_PULL_KEY = 'kikost.lastPullAt'

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}

/**
 * Label perangkat opsional (mis. "KASIR-1") untuk membedakan nomor transaksi &
 * antrean antar-perangkat saat offline. Jika belum diatur, diturunkan dari deviceId.
 */
export function getDeviceLabel(): string {
  const stored = localStorage.getItem(DEVICE_LABEL_KEY)
  if (stored && stored.trim()) return stored.trim().toUpperCase().slice(0, 6)
  return getDeviceId().replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase() || 'DEV'
}

export function setDeviceLabel(label: string): void {
  const clean = label.trim().toUpperCase().slice(0, 6)
  if (clean) localStorage.setItem(DEVICE_LABEL_KEY, clean)
  else localStorage.removeItem(DEVICE_LABEL_KEY)
}

export function getLastPullAt(): number {
  const raw = localStorage.getItem(LAST_PULL_KEY)
  return raw ? Number.parseInt(raw, 10) : 0
}

export function setLastPullAt(timestamp: number): void {
  localStorage.setItem(LAST_PULL_KEY, String(timestamp))
}
