/**
 * Permintaan menu dimulai dari main.tsx — bersamaan dengan unduhan chunk
 * CustomerApp, bukan setelahnya — supaya HP pelanggan tidak menunggu dua
 * perjalanan jaringan berurutan. Modul ini sengaja tanpa dependensi agar tetap
 * kecil di bundle awal.
 */
let preloaded: { token: string; response: Promise<Response> } | null = null

const menuUrl = (token: string) => `/api/t/${encodeURIComponent(token)}`

/** Token QR dari path `/order/:token[/...]`; null bila bukan halaman menu. */
export function menuTokenFromPath(pathname: string): string | null {
  const m = /^\/order\/([^/]+)\/?$/.exec(pathname)
  return m ? decodeURIComponent(m[1]) : null
}

export function preloadMenu(token: string): void {
  const response = fetch(menuUrl(token))
  // Galat ditangani pemakai di fetchMenu; ini hanya mencegah "unhandled rejection".
  response.catch(() => undefined)
  preloaded = { token, response }
}

/** Sekali pakai: muat ulang berikutnya (mis. ganti token) selalu ke jaringan. */
export function fetchMenu(token: string): Promise<Response> {
  const hit = preloaded?.token === token ? preloaded.response : null
  preloaded = null
  return hit ?? fetch(menuUrl(token))
}
