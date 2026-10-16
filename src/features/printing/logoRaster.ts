import { getSettings } from '@/db/repositories/settings'
import type { ReceiptData } from '@/features/printing/receiptData'

/**
 * Logo usaha di struk thermal: gambar (data URL) → bitmap 1-bit → perintah raster
 * ESC/POS `GS v 0`, yang didukung hampir semua printer thermal 58/80mm.
 */

export interface MonoBitmap {
  /** Lebar dalam byte (8 titik per byte). */
  widthBytes: number
  height: number
  /** Baris demi baris, bit 1 = titik hitam, MSB = titik paling kiri. */
  data: Uint8Array
}

/** Batas ukuran logo dalam titik printer (203 dpi): cukup jelas tanpa memboroskan kertas. */
const MAX_DOTS: Record<'58mm' | '80mm', { w: number; h: number }> = {
  '58mm': { w: 256, h: 128 },
  '80mm': { w: 320, h: 160 },
}

/**
 * RGBA → bitmap 1-bit dengan dithering Floyd–Steinberg (gradasi logo tetap
 * terbaca, bukan jadi blok hitam). Piksel transparan dianggap putih (kertas).
 */
export function rgbaToMonoBitmap(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): MonoBitmap {
  const gray = new Float32Array(width * height)
  for (let i = 0; i < width * height; i += 1) {
    const a = rgba[i * 4 + 3] / 255
    const lum = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]
    gray[i] = lum * a + 255 * (1 - a)
  }
  const widthBytes = Math.ceil(width / 8)
  const data = new Uint8Array(widthBytes * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      const old = gray[i]
      const black = old < 128
      const err = old - (black ? 0 : 255)
      if (black) data[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7)
      if (x + 1 < width) gray[i + 1] += (err * 7) / 16
      if (y + 1 < height) {
        if (x > 0) gray[i + width - 1] += (err * 3) / 16
        gray[i + width] += (err * 5) / 16
        if (x + 1 < width) gray[i + width + 1] += err / 16
      }
    }
  }
  return { widthBytes, height, data }
}

/** Perintah `GS v 0` (mode normal) untuk satu bitmap. */
export function escPosRasterCommand(bmp: MonoBitmap): Uint8Array {
  const head = [0x1d, 0x76, 0x30, 0x00, bmp.widthBytes & 0xff, (bmp.widthBytes >> 8) & 0xff, bmp.height & 0xff, (bmp.height >> 8) & 0xff]
  const out = new Uint8Array(head.length + bmp.data.length)
  out.set(head, 0)
  out.set(bmp.data, head.length)
  return out
}

/** Logo untuk struk ini — null bila tak ada logo atau dimatikan di Pengaturan → Printer. */
export async function receiptLogoFor(data: ReceiptData): Promise<MonoBitmap | null> {
  if (!data.logoDataUrl) return null
  const { printerConfig } = await getSettings()
  if (printerConfig.printLogo === false) return null
  return logoBitmapFor(data.logoDataUrl, data.paperSize)
}

const cache = new Map<string, Promise<MonoBitmap | null>>()

/**
 * Bitmap logo siap cetak, di-cache per (logo, ukuran kertas) supaya tiap struk
 * tak men-decode ulang gambar. `null` bila gambar tak bisa dibaca (mis. di luar
 * browser) — struk tetap tercetak tanpa logo.
 */
export function logoBitmapFor(dataUrl: string, paperSize: '58mm' | '80mm'): Promise<MonoBitmap | null> {
  const key = `${paperSize}|${dataUrl}`
  let hit = cache.get(key)
  if (!hit) {
    hit = decodeLogo(dataUrl, paperSize).catch(() => null)
    if (cache.size > 4) cache.clear()
    cache.set(key, hit)
  }
  return hit
}

async function decodeLogo(dataUrl: string, paperSize: '58mm' | '80mm'): Promise<MonoBitmap | null> {
  if (typeof createImageBitmap !== 'function') return null
  const img = await createImageBitmap(await (await fetch(dataUrl)).blob())
  const max = MAX_DOTS[paperSize]
  const scale = Math.min(max.w / img.width, max.h / img.height, 1)
  const w = Math.max(8, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h })
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, w, h)
  img.close?.()
  return rgbaToMonoBitmap(ctx.getImageData(0, 0, w, h).data, w, h)
}
