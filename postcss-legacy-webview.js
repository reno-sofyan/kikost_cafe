/**
 * Menulis ulang CSS supaya tetap benar di WebView Android lama (Chromium ±80–87) —
 * tablet kasir yang "Android System WebView"-nya tak pernah diperbarui (mis. Galaxy Tab
 * S5e dengan WebView bawaan pabrik). Tanpa ini:
 *  - `inset: 0` (Chrome 87+) diabaikan → semua dialog layar penuh tak muncul di tempatnya;
 *  - aturan berisi `:where()` (Chrome 88+) dibuang utuh → reset tombol bawaan hilang;
 *  - `dvh` (Chrome 108+) diabaikan → tinggi maksimum dialog hilang.
 * `aspect-ratio` (Chrome 88+) ditangani saat runtime: src/lib/legacyWebView.ts.
 */

const SIDES = ['top', 'right', 'bottom', 'left']

/** `inset: a [b [c [d]]]` → nilai per sisi, urutan seperti margin. */
function insetSides(value) {
  const parts = value.trim().split(/\s+/)
  const [t, r = t, b = t, l = r] = parts
  return [t, r, b, l]
}

/** Buang pembungkus `:where(...)` (kurung bersarang ditangani). */
function unwrapWhere(selector) {
  let out = ''
  let i = 0
  while (i < selector.length) {
    if (selector.startsWith(':where(', i)) {
      let depth = 1
      let j = i + ':where('.length
      const start = j
      while (j < selector.length && depth > 0) {
        if (selector[j] === '(') depth++
        else if (selector[j] === ')') depth--
        j++
      }
      out += unwrapWhere(selector.slice(start, j - 1))
      i = j
    } else {
      out += selector[i]
      i++
    }
  }
  return out
}

/** @type {import('postcss').PluginCreator<void>} */
const legacyWebView = () => ({
  postcssPlugin: 'kione-legacy-webview',
  Rule(rule) {
    if (rule.selector.includes(':where(')) rule.selector = unwrapWhere(rule.selector)
  },
  Declaration: {
    inset(decl) {
      const sides = insetSides(decl.value)
      SIDES.forEach((side, i) => decl.cloneBefore({ prop: side, value: sides[i] }))
      decl.remove()
    },
  },
  DeclarationExit(decl) {
    // Cadangan `vh` tepat sebelum `dvh`: browser lama memakai vh, yang baru menimpanya dengan dvh.
    if (/\ddvh\b/.test(decl.value) && !(decl.prev()?.type === 'decl' && decl.prev().prop === decl.prop)) {
      decl.cloneBefore({ value: decl.value.replace(/(\d)dvh\b/g, '$1vh') })
    }
  },
})
legacyWebView.postcss = true

export default legacyWebView
