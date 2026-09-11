import { afterEach, describe, expect, it, vi } from 'vitest'
import { newId, newIdempotencyKey, randomUUID } from '@/lib/id'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// `crypto.randomUUID`/`getRandomValues` normalnya hidup di prototype (Node webcrypto),
// jadi `delete crypto.randomUUID` tak benar-benar menghapusnya — perlu `defineProperty`
// untuk menimpanya dengan own-property yang benar-benar hilang/undefined.
function stubMissing(method: 'randomUUID' | 'getRandomValues') {
  const original = crypto[method]
  Object.defineProperty(crypto, method, { value: undefined, configurable: true })
  return () => Object.defineProperty(crypto, method, { value: original, configurable: true })
}

describe('randomUUID', () => {
  afterEach(() => vi.restoreAllMocks())

  it('pakai crypto.randomUUID() saat tersedia', () => {
    expect(randomUUID()).toMatch(UUID_RE)
  })

  it('turun ke crypto.getRandomValues() kalau randomUUID tak ada (mis. WebView HarmonyOS 2.0 / Kirin 710A)', () => {
    const restore = stubMissing('randomUUID')
    try {
      expect(typeof crypto.randomUUID).toBe('undefined') // sanity: stub-nya benar-benar mempan
      const spy = vi.spyOn(crypto, 'getRandomValues')
      const id = randomUUID()
      expect(id).toMatch(UUID_RE)
      expect(spy).toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('turun ke Math.random sebagai jaring pengaman terakhir kalau getRandomValues juga tak ada', () => {
    const restoreRandomUUID = stubMissing('randomUUID')
    const restoreGetRandomValues = stubMissing('getRandomValues')
    try {
      expect(typeof crypto.randomUUID).toBe('undefined')
      expect(typeof crypto.getRandomValues).toBe('undefined')
      expect(randomUUID()).toMatch(UUID_RE)
    } finally {
      restoreGetRandomValues()
      restoreRandomUUID()
    }
  })

  it('menghasilkan ID yang unik', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => randomUUID()))
    expect(ids.size).toBe(1000)
  })

  it('newId dan newIdempotencyKey memakai jalur yang sama', () => {
    expect(newId()).toMatch(UUID_RE)
    expect(newIdempotencyKey()).toMatch(UUID_RE)
  })
})
