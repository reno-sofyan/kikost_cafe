/**
 * Bersihkan sisa data dari nama produk lama (Kikost Cafe POS / Kinara Coffee)
 * sebelum rebranding ke Kione POS. Aplikasi lama tidak pernah dipakai untuk
 * data produksi nyata — hanya pengujian pengembang — jadi tidak ada backup
 * yang perlu dibuatkan sebelum menghapus.
 *
 * Berjalan sekali di startup (lihat main.tsx), sebelum Dexie membuka databasenya
 * sendiri. Dipagari lewat localStorage supaya tidak mencoba `deleteDatabase`
 * di setiap boot selama-lamanya.
 */

const DONE_FLAG = 'kione.legacyCleanupDone'
const LEGACY_DB_NAME = 'kikost-cafe-pos'
const LEGACY_KEY_PREFIX = 'kikost.'

export async function cleanupLegacyBrand(): Promise<void> {
  try {
    if (localStorage.getItem(DONE_FLAG)) return
  } catch {
    return // localStorage tidak tersedia (mis. mode privat ketat) — tidak ada yang perlu dibersihkan
  }

  await deleteLegacyDatabase()
  clearLegacyStorageKeys()

  try {
    localStorage.setItem(DONE_FLAG, String(Date.now()))
  } catch {
    // abaikan — bukan fatal bila flag gagal tersimpan, paling hanya dicoba lagi
  }
}

function deleteLegacyDatabase(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve()
      return
    }
    const req = indexedDB.deleteDatabase(LEGACY_DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve() // tidak fatal — cukup coba lagi lain kali via flag
    req.onblocked = () => resolve() // tab lain masih membukanya; lanjutkan, bukan alasan untuk hang
  })
}

function clearLegacyStorageKeys(): void {
  try {
    const stale = Object.keys(localStorage).filter((k) => k.startsWith(LEGACY_KEY_PREFIX))
    for (const key of stale) localStorage.removeItem(key)
  } catch {
    // abaikan
  }
}
