import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanupLegacyBrand } from './legacyCleanup'

describe('cleanupLegacyBrand', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('menghapus IndexedDB lama & kunci localStorage berprefix kikost., lalu memasang flag', async () => {
    localStorage.setItem('kikost.deviceId', 'abc')
    localStorage.setItem('kikost.sync.apiBaseUrl', 'https://old.example.com')
    localStorage.setItem('kione.deviceId', 'keep-me') // kunci baru — tidak boleh ikut terhapus

    const deleteDatabase = vi.fn((name: string) => {
      const req = { onsuccess: null as (() => void) | null, onerror: null, onblocked: null } as unknown as IDBOpenDBRequest
      queueMicrotask(() => req.onsuccess?.(new Event('success')))
      expect(name).toBe('kikost-cafe-pos')
      return req
    })
    vi.stubGlobal('indexedDB', { deleteDatabase })

    await cleanupLegacyBrand()

    expect(deleteDatabase).toHaveBeenCalledWith('kikost-cafe-pos')
    expect(localStorage.getItem('kikost.deviceId')).toBeNull()
    expect(localStorage.getItem('kikost.sync.apiBaseUrl')).toBeNull()
    expect(localStorage.getItem('kione.deviceId')).toBe('keep-me')
    expect(localStorage.getItem('kione.legacyCleanupDone')).toBeTruthy()

    vi.unstubAllGlobals()
  })

  it('tidak mencoba lagi setelah flag terpasang (idempoten)', async () => {
    localStorage.setItem('kione.legacyCleanupDone', '123')
    const deleteDatabase = vi.fn()
    vi.stubGlobal('indexedDB', { deleteDatabase })

    await cleanupLegacyBrand()

    expect(deleteDatabase).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
