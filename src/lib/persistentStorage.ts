/**
 * Meminta browser/WebView mengunci IndexedDB sebagai "persistent storage" lewat
 * `navigator.storage.persist()` — begitu diberikan, Android/Chrome tidak lagi boleh
 * menghapus data situs ini secara otomatis saat perangkat kekurangan ruang
 * penyimpanan ("storage pressure eviction"). Tanpa ini, IndexedDB app ini
 * berstatus "best-effort": data kasir (order, stok, shift) bisa hilang diam-diam
 * di tablet yang penyimpanannya hampir penuh — padahal app ini offline-first dan
 * IndexedDB adalah SATU-SATUNYA sumber kebenaran sampai tersinkron ke server.
 *
 * API ini opsional di WebView tertentu (lihat globalErrorHandler.ts soal WebView
 * yang tak lengkap) dan browser boleh menolak permintaannya — kegagalan di sini
 * TIDAK PERNAH melempar/memblokir render, hanya dicatat untuk diagnostik.
 */

export interface StoragePersistResult {
  /** `navigator.storage.persist` tersedia di runtime ini. */
  supported: boolean
  /** Penyimpanan situs ini terkunci (tidak akan dihapus otomatis oleh OS). */
  persisted: boolean
}

let lastResult: StoragePersistResult = { supported: false, persisted: false }

/** Status terakhir yang diketahui, tanpa menunggu promise — dipakai UI sinkron (mis. AboutPanel). */
export function getStoragePersistStatus(): StoragePersistResult {
  return lastResult
}

/**
 * Panggil sekali saat startup aplikasi (lihat main.tsx). Aman dipanggil berkali-kali;
 * browser yang sudah memberi izin akan langsung mengembalikan `true` tanpa prompt ulang.
 */
export async function ensurePersistentStorage(): Promise<StoragePersistResult> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    lastResult = { supported: false, persisted: false }
    return lastResult
  }
  try {
    const alreadyPersisted = (await navigator.storage.persisted?.()) ?? false
    const persisted = alreadyPersisted || (await navigator.storage.persist())
    lastResult = { supported: true, persisted }
    if (!persisted) {
      // Bukan error — sebagian browser menolak sampai kriteria engagement terpenuhi
      // (mis. sudah di-install sebagai PWA). Dicatat supaya terlihat saat diagnosa.
      console.warn('[persistentStorage] navigator.storage.persist() ditolak — data bisa dihapus OS saat storage penuh.')
    }
    return lastResult
  } catch (err) {
    console.warn('[persistentStorage] gagal meminta persistent storage:', err)
    lastResult = { supported: true, persisted: false }
    return lastResult
  }
}
