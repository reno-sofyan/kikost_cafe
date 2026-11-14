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

/** `gap` pada flexbox (Chrome 84) — `CSS.supports('gap')` tetap true karena grid sudah mendukungnya. */
function supportsFlexGap(): boolean {
  const probe = document.createElement('div')
  probe.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden'
  probe.appendChild(document.createElement('div'))
  probe.appendChild(document.createElement('div'))
  document.body.appendChild(probe)
  const ok = probe.scrollHeight === 1
  probe.remove()
  return ok
}

type MarginProp = 'marginTop' | 'marginRight' | 'marginBottom' | 'marginLeft'

/**
 * Flex `gap` (Chrome 84): WebView lama mengabaikannya pada flexbox sehingga semua tombol,
 * label & kartu menempel. Celah diganti margin anak, dibaca dari gaya terhitung kontainer
 * (arah, wrap & kelas responsif ikut benar). Margin milik anak sendiri (mis. `ml-auto`) dibiarkan.
 * `emulate`: hanya untuk tes e2e di Chromium modern — gap asli dimatikan dulu.
 */
export function installFlexGapFallback({ emulate = false }: { emulate?: boolean } = {}): void {
  type Styled = HTMLElement | SVGElement
  const SELECTOR = '[class*="gap-"]'
  type Prop = 'width' | MarginProp
  type Role = 'item' | 'container'
  /**
   * Properti yang diubah per elemen: nilai inline asli, nilai terhitung miliknya sendiri, dan
   * tambahan per peran. Satu elemen bisa sekaligus anak (diberi margin oleh induknya) dan
   * kontainer gap (dilebarkan untuk wrap) — tambahan keduanya dijumlahkan, bukan saling timpa.
   */
  const touched = new WeakMap<Styled, Map<Prop, { base: string; own: number } & Record<Role, number>>>()

  const apply = (el: Styled, prop: Prop) => {
    const props = touched.get(el)
    const t = props?.get(prop)
    if (!props || !t) return
    if (t.item || t.container) {
      el.style[prop] = `${t.own + t.item + t.container}px`
    } else {
      el.style[prop] = t.base
      props.delete(prop)
    }
  }
  const clear = (role: Role, el: Styled) => touched.get(el)?.forEach((t, prop) => ((t[role] = 0), apply(el, prop)))
  const add = (role: Role, el: Styled, prop: Prop, own: number, px: number) => {
    const props = touched.get(el) ?? new Map()
    touched.set(el, props)
    const t = props.get(prop) ?? { base: el.style[prop], own, item: 0, container: 0 }
    t[role] = px
    props.set(prop, t)
    apply(el, prop)
  }
  const SIDE_AUTO: Record<MarginProp, RegExp> = {
    marginTop: /(?:^|\s|:)m[ty]?-auto(?:\s|$)/,
    marginBottom: /(?:^|\s|:)m[by]?-auto(?:\s|$)/,
    marginLeft: /(?:^|\s|:)m[lxs]?-auto(?:\s|$)/,
    marginRight: /(?:^|\s|:)m[rxe]?-auto(?:\s|$)/,
  }
  /**
   * Margin anak sendiri: celah ditambahkan di atasnya (gap asli juga begitu), kecuali margin
   * `auto` (mis. `ml-auto`) — itu menyerap sisa ruang, jadi celah tak perlu ditambahkan.
   */
  const ownMargin = (el: Styled, prop: MarginProp): number | null =>
    SIDE_AUTO[prop].test(el.getAttribute('class') ?? '')
      ? null
      : (touched.get(el)?.get(prop)?.own ?? (parseFloat(getComputedStyle(el)[prop]) || 0))

  const process = (container: HTMLElement) => {
    const items = Array.from(container.children).filter((c): c is Styled => c instanceof HTMLElement || c instanceof SVGElement)
    // Tombol dkk. punya `transition`: margin yang diubah akan beranimasi dan terbaca setengah
    // jalan (ukuran & titik patah salah). Transisi dimatikan selama dihitung lalu dikembalikan.
    const frozen: Styled[] = [container, ...items]
    const transitions = frozen.map((el) => el.style.transition)
    frozen.forEach((el) => (el.style.transition = 'none'))
    try {
      layout(container, items)
    } finally {
      void container.getBoundingClientRect()
      frozen.forEach((el, i) => (el.style.transition = transitions[i]))
    }
  }

  const layout = (container: HTMLElement, items: Styled[]) => {
    clear('container', container)
    items.forEach((el) => clear('item', el))
    if (emulate) {
      container.style.removeProperty('row-gap')
      container.style.removeProperty('column-gap')
    }
    const cs = getComputedStyle(container)
    if (cs.display !== 'flex' && cs.display !== 'inline-flex') return
    const rowGap = parseFloat(cs.rowGap) || 0
    const colGap = parseFloat(cs.columnGap) || 0
    if (emulate) {
      container.style.setProperty('row-gap', '0px', 'important')
      container.style.setProperty('column-gap', '0px', 'important')
    }
    if (!rowGap && !colGap) return

    const vertical = cs.flexDirection.startsWith('column')
    const reverse = cs.flexDirection.endsWith('reverse')
    const mainGap = vertical ? rowGap : colGap
    const startProp: MarginProp = vertical ? (reverse ? 'marginBottom' : 'marginTop') : reverse ? 'marginRight' : 'marginLeft'
    const endProp: MarginProp = vertical ? (reverse ? 'marginTop' : 'marginBottom') : reverse ? 'marginLeft' : 'marginRight'
    const flow = items.filter((el) => {
      const s = getComputedStyle(el)
      return s.display !== 'none' && s.position !== 'absolute' && s.position !== 'fixed'
    })
    if (!flow.length) return
    // Semua margin dibaca sebelum ada yang diubah (membaca di sela penulisan memaksa tata letak ulang).
    const ownStart = flow.map((el) => ownMargin(el, startProp))
    const ownEnd = flow.map((el) => ownMargin(el, endProp))
    const addEnd = (i: number) => ownEnd[i] != null && add('item', flow[i], endProp, ownEnd[i]!, mainGap)

    const wrapRow = !vertical && cs.flexWrap !== 'nowrap'
    if (!wrapRow) {
      if (!mainGap) return
      // Teks lepas (mis. `<svg/> Tambah`) juga item flex, tapi tak bisa diberi margin:
      // celah sebelum teks dipasang di sisi akhir elemen sebelumnya.
      const textItem = (n: Node) => n.nodeType === Node.TEXT_NODE && !!n.textContent?.trim()
      let prev: Node | null = null
      for (const node of Array.from(container.childNodes)) {
        const i = flow.indexOf(node as Styled)
        if (i < 0 && !textItem(node)) continue
        if (prev) {
          if (i >= 0) {
            if (ownStart[i] != null) add('item', flow[i], startProp, ownStart[i]!, mainGap)
          } else if (flow.includes(prev as Styled)) addEnd(flow.indexOf(prev as Styled))
        }
        prev = node
      }
      return
    }

    // Wrap baris: setiap anak diberi margin akhir `colGap` dan kontainer dilebarkan `colGap`
    // ke sisi akhir (margin negatif) — titik patah baris jadi persis sama dengan gap asli,
    // dan margin anak terakhir tiap baris jatuh di area lebihan itu.
    if (colGap) {
      const before = container.getBoundingClientRect().width
      // Margin `auto` sang kontainer (mis. `ml-auto` di sisi lain) tak terpengaruh; sisi akhirnya dihitung dari nilainya sendiri.
      const margin = ownMargin(container, endProp) ?? (parseFloat(cs[endProp]) || 0)
      flow.forEach((_, i) => addEnd(i))
      add('container', container, endProp, margin, -colGap)
      // Lebar tetap (mis. `w-full`) tak ikut melebar oleh margin negatif.
      if (container.getBoundingClientRect().width < before + colGap - 0.5) add('container', container, 'width', before, colGap)
    }
    if (!rowGap) return
    // Baris kedua dst. berjarak `rowGap` ke baris di atasnya; baris dikenali dari posisi tegak anak.
    const line: number[] = []
    let lineBottom = -Infinity
    flow.forEach((el, i) => {
      const { top, bottom } = el.getBoundingClientRect()
      const startsLine = i > 0 && top >= lineBottom
      line.push(i === 0 ? 0 : line[i - 1] + (startsLine ? 1 : 0))
      lineBottom = startsLine || i === 0 ? bottom : Math.max(lineBottom, bottom)
    })
    const ownTop = flow.map((el) => ownMargin(el, 'marginTop'))
    flow.forEach((el, i) => line[i] > 0 && ownTop[i] != null && add('item', el, 'marginTop', ownTop[i]!, rowGap))
  }

  const pending = new Set<HTMLElement>()
  let frame = 0
  const flush = () => {
    frame = 0
    const batch = Array.from(pending)
    pending.clear()
    // Kontainer terluar dulu: tata letak anak bergantung pada lebar yang diberikan induknya.
    batch.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    batch.forEach((el) => el.isConnected && process(el))
  }
  const queue = (el: Element | null) => {
    if (!(el instanceof HTMLElement) || !el.matches(SELECTOR)) return
    pending.add(el)
    if (!frame) frame = requestAnimationFrame(flush)
  }
  const queueTree = (el: Element) => {
    queue(el)
    el.querySelectorAll(SELECTOR).forEach(queue)
  }

  queueTree(document.body)
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      const target = m.target as Element
      if (m.type === 'attributes') {
        queueTree(target)
        queue(target.parentElement)
      } else {
        queue(target)
        m.addedNodes.forEach((n) => n instanceof Element && queueTree(n))
      }
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] })
  let resizeTimer = 0
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => queueTree(document.body), 100)
  })
}

declare global {
  interface Window {
    /** Tes e2e: paksa cadangan flex gap di Chromium modern (lihat tests/e2e/legacy-webview.spec.ts). */
    __KIONE_EMULATE_NO_FLEX_GAP__?: boolean
  }
}

export function installLegacyWebViewSupport(): void {
  installPolyfills()
  if (typeof CSS === 'undefined' || typeof document === 'undefined') return
  const onReady = (fn: () => void) => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn())
  if (!CSS.supports('aspect-ratio', '1 / 1')) onReady(installAspectRatioFallback)
  onReady(() => {
    const emulate = window.__KIONE_EMULATE_NO_FLEX_GAP__ === true
    if (emulate || !supportsFlexGap()) installFlexGapFallback({ emulate })
  })
}
