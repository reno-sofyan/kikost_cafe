import { afterEach, describe, expect, it, vi } from 'vitest'

const persisted = vi.fn()
const persist = vi.fn()

function stubStorageManager() {
  vi.stubGlobal('navigator', { storage: { persisted, persist } })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  vi.resetModules()
})

describe('ensurePersistentStorage', () => {
  it('tidak didukung bila navigator.storage.persist tak tersedia (WebView lama)', async () => {
    vi.stubGlobal('navigator', {})
    const { ensurePersistentStorage } = await import('./persistentStorage')

    const result = await ensurePersistentStorage()

    expect(result).toEqual({ supported: false, persisted: false })
  })

  it('tidak meminta ulang bila sudah pernah dikunci sebelumnya', async () => {
    stubStorageManager()
    persisted.mockResolvedValue(true)
    const { ensurePersistentStorage } = await import('./persistentStorage')

    const result = await ensurePersistentStorage()

    expect(result).toEqual({ supported: true, persisted: true })
    expect(persist).not.toHaveBeenCalled()
  })

  it('meminta izin baru bila belum terkunci, dan melaporkan hasil penolakan OS', async () => {
    stubStorageManager()
    persisted.mockResolvedValue(false)
    persist.mockResolvedValue(false)
    const { ensurePersistentStorage } = await import('./persistentStorage')

    const result = await ensurePersistentStorage()

    expect(persist).toHaveBeenCalledOnce()
    expect(result).toEqual({ supported: true, persisted: false })
  })

  it('permintaan diberikan → persisted true', async () => {
    stubStorageManager()
    persisted.mockResolvedValue(false)
    persist.mockResolvedValue(true)
    const { ensurePersistentStorage } = await import('./persistentStorage')

    expect(await ensurePersistentStorage()).toEqual({ supported: true, persisted: true })
  })

  it('error tak terduga tidak pernah dilempar keluar (tak boleh memblokir startup)', async () => {
    stubStorageManager()
    persisted.mockRejectedValue(new Error('boom'))
    const { ensurePersistentStorage } = await import('./persistentStorage')

    await expect(ensurePersistentStorage()).resolves.toEqual({ supported: true, persisted: false })
  })

  it('getStoragePersistStatus mencerminkan hasil panggilan terakhir tanpa perlu await ulang', async () => {
    stubStorageManager()
    persisted.mockResolvedValue(true)
    const { ensurePersistentStorage, getStoragePersistStatus } = await import('./persistentStorage')

    await ensurePersistentStorage()

    expect(getStoragePersistStatus()).toEqual({ supported: true, persisted: true })
  })
})
