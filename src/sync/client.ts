import type { SyncEntity } from '@/types/domain'
import { getApiBaseUrl, getDeviceKey, isBackendConfigured as isConfigured } from '@/sync/deviceConfig'
import { noteTrustedTimestampFromResponse } from '@/lib/clockGuard'

export interface SyncPushItem {
  entity: SyncEntity
  entityId: string
  idempotencyKey: string
  payload: unknown
  /** `true` = hapus entitas di server (tombstone) — lihat `enqueueSyncDelete`. */
  deleted?: boolean
}

export interface SyncPushResultItem {
  idempotencyKey: string
  status: 'accepted' | 'duplicate' | 'rejected'
  error?: string
}

export interface SyncPushResponse {
  results: SyncPushResultItem[]
  serverTime: number
}

export interface SyncPullResponse {
  entities: Partial<Record<SyncEntity, unknown[]>>
  /** ID entitas yang dihapus sejak `since`. Opsional: server lama tak mengirimnya. */
  deletions?: Partial<Record<SyncEntity, string[]>>
  serverTime: number
}

function apiBaseUrl(): string {
  return getApiBaseUrl()
}

function deviceSyncKey(): string {
  return getDeviceKey()
}

export class SyncNotConfiguredError extends Error {
  constructor() {
    super('URL backend belum dikonfigurasi. Atur VITE_API_BASE_URL pada file .env.')
    this.name = 'SyncNotConfiguredError'
  }
}

async function authorizedFetch(path: string, init: RequestInit): Promise<Response> {
  const base = apiBaseUrl()
  if (!base) throw new SyncNotConfiguredError()
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${deviceSyncKey()}`,
      ...init.headers,
    },
  })
  // Setiap kali backend terjangkau, majukan jam-tak-bisa-mundur perangkat ini
  // dari header `Date` respons — lihat clockGuard.ts. Sumber waktu tepercaya
  // untuk deteksi jam sistem dimundurkan, dipakai a.l. oleh evaluasi lisensi.
  noteTrustedTimestampFromResponse(response)
  return response
}

/**
 * Balasan bukan-JSON (biasanya HTML — proxy/URL Backend salah, atau server down)
 * bikin `response.json()` gagal dengan pesan kriptis "Unexpected token '<'".
 * Dicek eksplisit di sini supaya errornya langsung nunjuk ke penyebab yang jelas.
 */
async function parseJsonOrThrow<T>(response: Response, failLabel: string): Promise<T> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new Error(
      `${failLabel} (HTTP ${response.status}): server membalas bukan JSON — cek URL Backend di Pengaturan > Sinkronisasi.`,
    )
  }
  return (await response.json()) as T
}

export async function pushSyncBatch(deviceId: string, items: SyncPushItem[]): Promise<SyncPushResponse> {
  const response = await authorizedFetch('/api/sync/push', {
    method: 'POST',
    body: JSON.stringify({ deviceId, items }),
  })
  const data = await parseJsonOrThrow<SyncPushResponse>(response, 'Sinkronisasi gagal')
  if (!response.ok) {
    throw new Error(`Sinkronisasi gagal (HTTP ${response.status})`)
  }
  return data
}

export async function pullSyncChanges(since: number): Promise<SyncPullResponse> {
  const response = await authorizedFetch(`/api/sync/pull?since=${since}`, { method: 'GET' })
  const data = await parseJsonOrThrow<SyncPullResponse>(response, 'Gagal mengambil data terbaru')
  if (!response.ok) {
    throw new Error(`Gagal mengambil data terbaru (HTTP ${response.status})`)
  }
  return data
}

export async function pingBackend(): Promise<boolean> {
  try {
    const response = await authorizedFetch('/api/health', { method: 'GET' })
    return response.ok
  } catch {
    return false
  }
}

export function isBackendConfigured(): boolean {
  return isConfigured()
}

// ---- Manajemen perangkat sinkronisasi ----

export interface SyncDevice {
  id: string
  label: string
  revoked: boolean
  createdAt: number
  lastSeenAt: number | null
}

async function deviceJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await authorizedFetch(path, init)
  const body = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
  return body
}

export async function listSyncDevices(): Promise<SyncDevice[]> {
  return (await deviceJson<{ devices: SyncDevice[] }>('/api/devices', { method: 'GET' })).devices
}

export async function enrollSyncDevice(label: string, deviceKey: string): Promise<void> {
  await deviceJson('/api/devices/enroll', { method: 'POST', body: JSON.stringify({ label, deviceKey }) })
}

export async function revokeSyncDevice(id: string): Promise<void> {
  await deviceJson(`/api/devices/${id}/revoke`, { method: 'POST', body: '{}' })
}

export async function renameSyncDevice(id: string, label: string): Promise<void> {
  await deviceJson(`/api/devices/${id}/rename`, { method: 'POST', body: JSON.stringify({ label }) })
}

// ---- QRIS dinamis Midtrans dari kasir (lihat backend/src/routes/midtransCashier.ts) ----

export type MidtransChargeStatus = 'pending' | 'paid' | 'expired' | 'failed' | 'cancelled'

export interface MidtransCharge {
  chargeId: string
  qrString: string
  grossAmount: number
  expiryTime: string | null
  isProduction: boolean
}

export interface MidtransChargeState {
  status: MidtransChargeStatus
  reference?: string
  amount?: number
}

async function midtransCall<T>(path: string, init: RequestInit, failLabel: string): Promise<T> {
  const response = await authorizedFetch(path, init)
  const data = await parseJsonOrThrow<T & { error?: string }>(response, failLabel)
  if (!response.ok) throw new Error(data.error || `${failLabel} (HTTP ${response.status})`)
  return data
}

export function getMidtransConfig(): Promise<{ enabled: boolean; isProduction: boolean }> {
  return midtransCall('/api/sync/midtrans/config', { method: 'GET' }, 'Cek Midtrans gagal')
}

export function createMidtransCharge(params: { orderId: string; billId: string; amount: number }): Promise<MidtransCharge> {
  return midtransCall('/api/sync/midtrans/charges', { method: 'POST', body: JSON.stringify(params) }, 'Gagal membuat QRIS')
}

export function getMidtransCharge(chargeId: string): Promise<MidtransChargeState> {
  return midtransCall(`/api/sync/midtrans/charges/${encodeURIComponent(chargeId)}`, { method: 'GET' }, 'Cek status QRIS gagal')
}

export function cancelMidtransCharge(chargeId: string): Promise<MidtransChargeState> {
  return midtransCall(`/api/sync/midtrans/charges/${encodeURIComponent(chargeId)}/cancel`, { method: 'POST' }, 'Batal QRIS gagal')
}
