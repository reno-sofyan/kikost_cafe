import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearDeviceSyncConfig,
  getApiBaseUrl,
  getDeviceKey,
  hasStoredOverride,
  isBackendConfigured,
  saveDeviceSyncConfig,
} from './deviceConfig'

beforeEach(() => {
  localStorage.clear()
})

describe('deviceConfig', () => {
  it('default kosong bila tidak ada env & tidak ada stored', () => {
    expect(getApiBaseUrl()).toBe('')
    expect(getDeviceKey()).toBe('')
    expect(isBackendConfigured()).toBe(false)
    expect(hasStoredOverride()).toBe(false)
  })

  it('menyimpan & membaca konfigurasi, menghapus trailing slash', () => {
    saveDeviceSyncConfig({ apiBaseUrl: 'https://pos.kikost.com/', deviceKey: '  abc123  ' })
    expect(getApiBaseUrl()).toBe('https://pos.kikost.com')
    expect(getDeviceKey()).toBe('abc123')
    expect(isBackendConfigured()).toBe(true)
    expect(hasStoredOverride()).toBe(true)
  })

  it('menambahkan https:// bila skema tak ditulis', () => {
    saveDeviceSyncConfig({ apiBaseUrl: 'pos.kikost.com' })
    expect(getApiBaseUrl()).toBe('https://pos.kikost.com')
  })

  it('membuang /api yang kepencet ikut ditulis di akhir URL', () => {
    saveDeviceSyncConfig({ apiBaseUrl: 'https://pos.kikost.com/api' })
    expect(getApiBaseUrl()).toBe('https://pos.kikost.com')
  })

  it('menyimpan string kosong = menghapus kunci itu', () => {
    saveDeviceSyncConfig({ apiBaseUrl: 'https://x.test', deviceKey: 'k' })
    saveDeviceSyncConfig({ apiBaseUrl: '' })
    expect(getApiBaseUrl()).toBe('')
    expect(getDeviceKey()).toBe('k')
  })

  it('clearDeviceSyncConfig menghapus semua', () => {
    saveDeviceSyncConfig({ apiBaseUrl: 'https://x.test', deviceKey: 'k' })
    clearDeviceSyncConfig()
    expect(hasStoredOverride()).toBe(false)
    expect(getApiBaseUrl()).toBe('')
  })
})
