import { afterEach, describe, expect, it, vi } from 'vitest'

const isNative = vi.fn(() => false)
const writeFile = vi.fn(async () => ({ uri: 'file:///cache/x.json' }))
const share = vi.fn(async () => undefined)

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => isNative() } }))
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile: (...a: unknown[]) => writeFile(...(a as [])) },
  Directory: { Cache: 'CACHE' },
}))
vi.mock('@capacitor/share', () => ({ Share: { share: (...a: unknown[]) => share(...(a as [])) } }))

afterEach(() => {
  vi.clearAllMocks()
  isNative.mockReturnValue(false)
})

describe('saveTextFile', () => {
  it('web: memicu unduhan lewat anchor download', async () => {
    const { saveTextFile } = await import('./saveFile')
    const createURL = vi.fn(() => 'blob:x')
    const revokeURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: createURL, revokeObjectURL: revokeURL })
    const click = vi.fn()
    vi.spyOn(document, 'createElement').mockReturnValue({ click, href: '', download: '' } as unknown as HTMLElement)

    const res = await saveTextFile('lap.csv', 'a,b', 'text/csv')

    expect(res).toBeNull()
    expect(click).toHaveBeenCalledOnce()
    expect(revokeURL).toHaveBeenCalledWith('blob:x')
    vi.unstubAllGlobals()
  })

  it('native: menulis berkas lalu membuka lembar bagikan', async () => {
    isNative.mockReturnValue(true)
    const { saveTextFile } = await import('./saveFile')

    const uri = await saveTextFile('backup.json', '{}', 'application/json')

    expect(writeFile).toHaveBeenCalledOnce()
    expect(writeFile.mock.calls[0][0]).toMatchObject({ path: 'backup.json', directory: 'CACHE' })
    expect(share).toHaveBeenCalledOnce()
    expect(uri).toBe('file:///cache/x.json')
  })

  it('native: batal di lembar bagikan bukan error', async () => {
    isNative.mockReturnValue(true)
    share.mockRejectedValueOnce(new Error('Share canceled'))
    const { saveTextFile } = await import('./saveFile')

    await expect(saveTextFile('backup.json', '{}', 'application/json')).resolves.toBe('file:///cache/x.json')
  })
})
