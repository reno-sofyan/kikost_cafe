import { Capacitor } from '@capacitor/core'

/**
 * Menyimpan sebuah berkas (JSON/CSV/PDF) lintas platform.
 *
 * - Web/PWA: unduhan browser biasa (`<a download>`).
 * - APK Android/iOS: WebView TIDAK menangani unduhan blob / `<a download>` /
 *   `jsPDF.save()`, jadi berkas ditulis ke penyimpanan lewat `@capacitor/filesystem`
 *   lalu dibuka lembar "Bagikan" (`@capacitor/share`) supaya bisa dikirim ke
 *   WhatsApp / Google Drive / email.
 *
 * @returns lokasi berkas pada perangkat native, atau `null` di web.
 */
export async function saveFile(filename: string, blob: Blob): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    return null
  }

  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')

  const base64 = await blobToBase64(blob)
  // Directory.Cache: tanpa izin storage & aman dibersihkan OS setelah dibagikan.
  const written = await Filesystem.writeFile({
    path: filename,
    data: base64,
    directory: Directory.Cache,
  })

  try {
    await Share.share({ title: filename, text: `Berkas ${filename} dari Kikost Cafe POS`, url: written.uri })
  } catch (err) {
    // Pengguna membatalkan lembar bagikan bukan kegagalan — berkas tetap tersimpan.
    if (err instanceof Error && /cancell?ed/i.test(err.message)) return written.uri
    throw err
  }
  return written.uri
}

/** Bungkus teks jadi Blob lalu simpan. */
export function saveTextFile(filename: string, content: string, mimeType: string): Promise<string | null> {
  return saveFile(filename, new Blob([content], { type: `${mimeType};charset=utf-8` }))
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(blob)
  })
}
