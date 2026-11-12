/**
 * Satu-satunya sumber durasi & kurva animasi aplikasi kasir. Nilainya dipasang sebagai
 * variabel CSS (`--kione-motion-*`) oleh `applyMotionTokens()` saat startup, lalu dipakai
 * kelas animasi di index.css. Ubah di sini saja.
 *
 * Aturan: hanya transform & opacity; masuk = ease-out, keluar = ease-in; animasi tak
 * pernah memblokir input (tanpa pointer-events: none pada layar yang masuk).
 */
export const MOTION = {
  /** Perpindahan layar/modul. */
  route: 240,
  /** Modal & bottom sheet masuk. */
  sheetIn: 260,
  /** Modal & bottom sheet keluar (lebih singkat — kasir menunggu layar di belakangnya). */
  sheetOut: 180,
  /** Indikator tab bergeser. */
  indicator: 220,
  /** Umpan balik tombol saat ditekan. */
  press: 100,
  /** Lama centang "berhasil" pada tombol. */
  success: 900,
} as const

export const EASING = {
  /** Elemen yang masuk: cepat lalu melambat. */
  out: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  /** Elemen yang keluar: pelan lalu cepat. */
  in: 'cubic-bezier(0.4, 0, 1, 1)',
  /** Bergerak di tempat (indikator tab). */
  inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const

/** Jarak geser layar saat maju/mundur — pendek supaya terasa cepat, bukan seperti carousel. */
export const ROUTE_SLIDE_PX = 28

export function applyMotionTokens(root: HTMLElement = document.documentElement): void {
  const vars: Record<string, string> = {
    '--kione-motion-route': `${MOTION.route}ms`,
    '--kione-motion-sheet-in': `${MOTION.sheetIn}ms`,
    '--kione-motion-sheet-out': `${MOTION.sheetOut}ms`,
    '--kione-motion-indicator': `${MOTION.indicator}ms`,
    '--kione-motion-press': `${MOTION.press}ms`,
    '--kione-ease-out': EASING.out,
    '--kione-ease-in': EASING.in,
    '--kione-ease-in-out': EASING.inOut,
    '--kione-route-slide': `${ROUTE_SLIDE_PX}px`,
  }
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

// ---- Arah transisi antar layar ------------------------------------------------------

export type RouteTransition = 'forward' | 'back' | 'fade' | 'none'

/** Segmen pertama path = modul (kasir, laporan, stok, …). */
export const moduleOf = (path: string): string => path.split('/')[1] ?? ''
const depthOf = (path: string): number => path.split('/').filter(Boolean).length

/**
 * Arah transisi dari riwayat navigasi, bukan per halaman:
 * - pindah modul (Kasir → Laporan) = `fade` (tab setara);
 * - di dalam modul: indeks riwayat mundur (tombol back) = `back`; masuk lebih dalam
 *   (Kasir → Bayar) = `forward`; keluar ke tingkat lebih dangkal = `back`;
 * - path sama (hanya query/hash) = `none`.
 * `prevIdx`/`nextIdx` = `history.state.idx` milik React Router (null bila tak ada).
 */
export function routeTransitionFor(prev: { path: string; idx: number | null }, next: { path: string; idx: number | null }): RouteTransition {
  if (prev.path === next.path) return 'none'
  if (moduleOf(prev.path) !== moduleOf(next.path)) return 'fade'
  if (prev.idx != null && next.idx != null && next.idx < prev.idx) return 'back'
  return depthOf(next.path) >= depthOf(prev.path) ? 'forward' : 'back'
}

/** Opasitas awal layar yang masuk — tak dari 0, supaya tak pernah tampak layar kosong. */
const ROUTE_START_OPACITY = 0.35

/** Keyframe masuk layar baru (Web Animations API — tanpa me-mount ulang layar). */
export function routeKeyframes(transition: RouteTransition, reduced: boolean): Keyframe[] {
  if (transition === 'none') return []
  if (reduced || transition === 'fade') return [{ opacity: ROUTE_START_OPACITY }, { opacity: 1 }]
  const dx = transition === 'forward' ? ROUTE_SLIDE_PX : -ROUTE_SLIDE_PX
  return [
    { opacity: ROUTE_START_OPACITY, transform: `translateX(${dx}px)` },
    { opacity: 1, transform: 'none' },
  ]
}
