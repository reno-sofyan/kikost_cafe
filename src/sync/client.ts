import type { SyncEntity } from '@/types/domain'
import { getApiBaseUrl, getDeviceKey, isBackendConfigured as isConfigured } from '@/sync/deviceConfig'

export interface SyncPushItem {
  entity: SyncEntity
  entityId: string
  idempotencyKey: string
  payload: unknown
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
  return response
}

export async function pushSyncBatch(deviceId: string, items: SyncPushItem[]): Promise<SyncPushResponse> {
  const response = await authorizedFetch('/api/sync/push', {
    method: 'POST',
    body: JSON.stringify({ deviceId, items }),
  })
  if (!response.ok) {
    throw new Error(`Sinkronisasi gagal (HTTP ${response.status})`)
  }
  return (await response.json()) as SyncPushResponse
}

export async function pullSyncChanges(since: number): Promise<SyncPullResponse> {
  const response = await authorizedFetch(`/api/sync/pull?since=${since}`, { method: 'GET' })
  if (!response.ok) {
    throw new Error(`Gagal mengambil data terbaru (HTTP ${response.status})`)
  }
  return (await response.json()) as SyncPullResponse
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
