/**
 * Tumpukan modal yang sedang terbuka (lihat Modal.tsx). Esc & tombol back Android hanya
 * menutup yang paling atas — dulu satu Esc menutup semua modal yang terbuka sekaligus.
 */
const openModals: { close: () => void }[] = []

export function pushModal(entry: { close: () => void }): () => void {
  openModals.push(entry)
  return () => {
    const i = openModals.indexOf(entry)
    if (i >= 0) openModals.splice(i, 1)
  }
}

export function isTopModal(entry: { close: () => void }): boolean {
  return openModals[openModals.length - 1] === entry
}

/** Tutup modal teratas (tombol back Android). `false` = tak ada modal terbuka. */
export function closeTopModal(): boolean {
  const top = openModals[openModals.length - 1]
  if (!top) return false
  top.close()
  return true
}
