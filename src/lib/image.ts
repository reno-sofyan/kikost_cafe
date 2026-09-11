/**
 * Kecilkan gambar sebelum disimpan sebagai data URL di Dexie/IndexedDB.
 *
 * Foto dari kamera tablet bisa 5-10MB mentah — menyimpannya apa adanya sebagai
 * base64 (di settings, produk, QRIS, dst.) bisa membuat penulisan ke IndexedDB
 * lambat di perangkat low-end (mis. saat "Menyiapkan aplikasi..." pada onboarding),
 * dan lama-lama membengkakkan database secara tak perlu — foto logo/QRIS/produk
 * cuma pernah ditampilkan kecil di layar.
 */
export function readFileAsResizedDataUrl(file: File, maxDimension = 800, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => resolve(reader.result as string) // gagal decode gambar → pakai file asli apa adanya
      img.onload = () => {
        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height))
        const width = Math.round(img.width * scale)
        const height = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(reader.result as string)
          return
        }
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}
