/**
 * Dukungan WebView Android lama (Chromium ±80–91) — tablet kasir yang "Android System
 * WebView"-nya tak pernah diperbarui (mis. Galaxy Tab S5e dengan WebView bawaan pabrik).
 * Pasangan sisi CSS-nya ada di postcss-legacy-webview.js. Dimuat paling awal di main.tsx.
 */

/** Versi utama Chromium WebView (`null` = bukan Chromium, mis. test/jsdom). */
export function webViewChromeVersion(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): number | null {
  const m = /Chrom(?:e|ium)\/(\d+)/.exec(ua)
  return m ? Number(m[1]) : null
}

/** Di bawah versi ini sebagian tampilan bergantung pada polyfill — sarankan pembaruan WebView. */
export const RECOMMENDED_WEBVIEW_VERSION = 88

function define(target: object, name: string, value: unknown) {
  if (!(name in target)) Object.defineProperty(target, name, { value, writable: true, configurable: true, enumerable: false })
}

/** API JS yang dipakai aplikasi/library tapi belum ada di Chromium lama. */
export function installPolyfills(): void {
  function at(this: ArrayLike<unknown>, index: number) {
    const i = Math.trunc(index) || 0
    const k = i < 0 ? this.length + i : i
    return k < 0 || k >= this.length ? undefined : this[k]
  }
  define(Array.prototype, 'at', at) // Chrome 92 — dipakai jsPDF (Export Nota ke PDF)
  define(String.prototype, 'at', at)
  define(Object, 'hasOwn', (o: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(o, key)) // Chrome 93
  define(String.prototype, 'replaceAll', function (this: string, search: string | RegExp, replacement: string) {
    // Chrome 85
    return search instanceof RegExp ? this.replace(search, replacement) : this.split(search).join(replacement)
  })
}

const ASPECT_CLASS = /(?:^|\s)aspect-(?:\[(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\]|(square)|(video))(?:\s|$)/

/** Rasio lebar/tinggi dari kelas Tailwind `aspect-*` (null = tak ada). */
export function aspectRatioOf(className: string): number | null {
  const m = ASPECT_CLASS.exec(className)
  if (!m) return null
  if (m[3]) return 1
  if (m[4]) return 16 / 9
  return Number(m[1]) / Number(m[2])
}

/**
 * `aspect-ratio` (Chrome 88): tanpa dukungan, kotak gambar produk kehilangan tingginya.
 * Tinggi dihitung dari lebar setiap kali ukurannya berubah.
 */
function installAspectRatioFallback(): void {
  if (typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined') return
  const watched = new WeakSet<Element>()
  const resize = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const el = entry.target as HTMLElement
      const ratio = aspectRatioOf(el.className)
      if (ratio) el.style.height = `${el.getBoundingClientRect().width / ratio}px`
    }
  })
  const scan = (root: ParentNode) => {
    root.querySelectorAll('[class*="aspect-"]').forEach((el) => {
      if (!watched.has(el) && aspectRatioOf(el.className)) {
        watched.add(el)
        resize.observe(el)
      }
    })
  }
  scan(document)
  new MutationObserver((mutations) => {
    for (const m of mutations) m.addedNodes.forEach((n) => n instanceof Element && scan(n.parentNode ?? n))
  }).observe(document.documentElement, { childList: true, subtree: true })
}

export function installLegacyWebViewSupport(): void {
  installPolyfills()
  if (typeof CSS !== 'undefined' && typeof document !== 'undefined' && !CSS.supports('aspect-ratio', '1 / 1')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installAspectRatioFallback)
    else installAspectRatioFallback()
  }
}
