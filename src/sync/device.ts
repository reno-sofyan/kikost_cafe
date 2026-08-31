// Identitas perangkat & metadata sinkronisasi (bukan data transaksi) - aman disimpan di localStorage.
const DEVICE_ID_KEY = 'kikost.deviceId'
const LAST_PULL_KEY = 'kikost.lastPullAt'

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}

export function getLastPullAt(): number {
  const raw = localStorage.getItem(LAST_PULL_KEY)
  return raw ? Number.parseInt(raw, 10) : 0
}

export function setLastPullAt(timestamp: number): void {
  localStorage.setItem(LAST_PULL_KEY, String(timestamp))
}
