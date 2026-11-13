import { describe, expect, it } from 'vitest'
import postcss from 'postcss'
import legacyWebView from '../../postcss-legacy-webview.js'
import { aspectRatioOf, installPolyfills, webViewChromeVersion } from '@/lib/legacyWebView'

const run = async (css: string) => (await postcss([legacyWebView]).process(css, { from: undefined })).css

describe('postcss-legacy-webview (WebView Chromium 80–87)', () => {
  it('inset → top/right/bottom/left', async () => {
    expect(await run('.a{inset:0}')).toBe('.a{top:0;right:0;bottom:0;left:0}')
    expect(await run('.b{inset:1px 2px}')).toBe('.b{top:1px;right:2px;bottom:1px;left:2px}')
    expect(await run('.c{inset:1px 2px 3px}')).toBe('.c{top:1px;right:2px;bottom:3px;left:2px}')
    // Variabel Tailwind bukan properti inset.
    expect(await run('.d{--tw-ring-inset: }')).toBe('.d{--tw-ring-inset: }')
  })

  it(':where() dibuka, termasuk kurung bersarang', async () => {
    expect(await run('button,input:where([type=button]){color:red}')).toBe('button,input[type=button]{color:red}')
    expect(await run('[hidden]:where(:not([hidden=until-found])){display:none}')).toBe('[hidden]:not([hidden=until-found]){display:none}')
  })

  it('dvh mendapat cadangan vh tepat sebelumnya', async () => {
    expect(await run('.e{max-height:calc(100dvh - 2rem)}')).toBe('.e{max-height:calc(100vh - 2rem);max-height:calc(100dvh - 2rem)}')
  })
})

describe('legacyWebView runtime', () => {
  it('membaca versi Chromium dari user agent WebView', () => {
    expect(webViewChromeVersion('Mozilla/5.0 (Linux; Android 11; SM-T725; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/86.0.4240.198 Safari/537.36')).toBe(86)
    expect(webViewChromeVersion('Mozilla/5.0 Firefox/120.0')).toBeNull()
  })

  it('rasio dari kelas aspect-*', () => {
    expect(aspectRatioOf('mb-3 aspect-[5/4] w-full')).toBe(1.25)
    expect(aspectRatioOf('aspect-square rounded')).toBe(1)
    expect(aspectRatioOf('aspect-video')).toBeCloseTo(16 / 9)
    expect(aspectRatioOf('w-full')).toBeNull()
  })

  it('polyfill hanya mengisi yang belum ada, dan perilakunya benar', () => {
    const saved = { at: Array.prototype.at, hasOwn: Object.hasOwn }
    try {
      // @ts-expect-error simulasi Chromium lama
      delete Array.prototype.at
      // @ts-expect-error simulasi Chromium lama
      delete Object.hasOwn
      installPolyfills()
      expect([1, 2, 3].at(-1)).toBe(3)
      expect([1, 2, 3].at(0)).toBe(1)
      expect([1, 2, 3].at(5)).toBeUndefined()
      expect(Object.hasOwn({ a: 1 }, 'a')).toBe(true)
      expect(Object.hasOwn({ a: 1 }, 'b')).toBe(false)
    } finally {
      Object.defineProperty(Array.prototype, 'at', { value: saved.at, writable: true, configurable: true, enumerable: false })
      Object.defineProperty(Object, 'hasOwn', { value: saved.hasOwn, writable: true, configurable: true, enumerable: false })
    }
  })
})
