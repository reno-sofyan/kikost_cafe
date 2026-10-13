import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearDeviceSyncConfig,
  getApiBaseUrl,
  getDeviceKey,
  hasStoredOverride,
  isBackendConfigured,
  markFullResyncDone,
  needsFullResync,
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
    saveDeviceSyncConfig({ apiBaseUrl: 'https://pos.contoh.com/', deviceKey: '  abc123  ' })
    expect(getApiBaseUrl()).toBe('https://pos.contoh.com')
    expect(getDeviceKey()).toBe('abc123')
    expect(isBackendConfigured()).toBe(true)
    expect(hasStoredOverride()).toBe(true)
  })

  it('menambahkan https:// bila skema tak ditulis', () => {
    saveDeviceSyncConfig({ apiBaseUrl: 'pos.contoh.com' })
    expect(getApiBaseUrl()).toBe('https://pos.contoh.com')
  })

  it('membuang /api yang kepencet ikut ditulis di akhir URL', () => {
    saveDeviceSyncConfig({ apiBaseUrl: 'https://pos.contoh.com/api' })
    expect(getApiBaseUrl()).toBe('https://pos.contoh.com')
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

  it('needsFullResync: false tanpa backend, true sampai ditandai, true lagi bila URL/kunci berganti', () => {
    expect(needsFullResync()).toBe(false)

    saveDeviceSyncConfig({ apiBaseUrl: 'https://pos.contoh.com', deviceKey: 'kunci-a' })
    expect(needsFullResync()).toBe(true)
    markFullResyncDone()
    expect(needsFullResync()).toBe(false)

    // Menyimpan ulang nilai yang sama tidak memicu sinkron ulang penuh lagi.
    saveDeviceSyncConfig({ apiBaseUrl: 'https://pos.contoh.com/', deviceKey: 'kunci-a' })
    expect(needsFullResync()).toBe(false)

    saveDeviceSyncConfig({ deviceKey: 'kunci-b' })
    expect(needsFullResync()).toBe(true)
    markFullResyncDone()
    saveDeviceSyncConfig({ apiBaseUrl: 'https://lain.contoh.com' })
    expect(needsFullResync()).toBe(true)
  })
})
