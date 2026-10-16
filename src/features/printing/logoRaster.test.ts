import { describe, expect, it } from 'vitest'
import { escPosRasterCommand, rgbaToMonoBitmap } from '@/features/printing/logoRaster'
import { buildEscPosReceipt } from '@/features/printing/escpos'
import { buildSampleReceiptData } from '@/features/printing/receiptData'
import { DEFAULT_SETTINGS } from '@/db/repositories/settings'

function solid(w: number, h: number, rgba: [number, number, number, number]) {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i += 1) px.set(rgba, i * 4)
  return px
}

describe('logo struk thermal', () => {
  it('hitam → bit 1, putih & transparan → bit 0, lebar dibulatkan ke byte', () => {
    expect(rgbaToMonoBitmap(solid(10, 2, [0, 0, 0, 255]), 10, 2)).toEqual({ widthBytes: 2, height: 2, data: new Uint8Array([0xff, 0xc0, 0xff, 0xc0]) })
    expect(rgbaToMonoBitmap(solid(8, 1, [255, 255, 255, 255]), 8, 1).data).toEqual(new Uint8Array([0]))
    expect(rgbaToMonoBitmap(solid(8, 1, [0, 0, 0, 0]), 8, 1).data).toEqual(new Uint8Array([0]))
  })

  it('abu-abu 50% di-dither jadi kira-kira separuh titik hitam', () => {
    const bmp = rgbaToMonoBitmap(solid(16, 16, [128, 128, 128, 255]), 16, 16)
    const black = [...bmp.data].reduce((n, b) => n + b.toString(2).split('1').length - 1, 0)
    expect(black).toBeGreaterThan(100)
    expect(black).toBeLessThan(156)
  })

  it('perintah GS v 0 berisi ukuran little-endian lalu data, dan masuk di kepala struk', () => {
    const bmp = { widthBytes: 2, height: 300, data: new Uint8Array(600).fill(0xaa) }
    const cmd = escPosRasterCommand(bmp)
    expect([...cmd.slice(0, 8)]).toEqual([0x1d, 0x76, 0x30, 0x00, 2, 0, 300 & 0xff, 1])
    expect(cmd.length).toBe(608)

    const data = buildSampleReceiptData({ ...DEFAULT_SETTINGS, businessName: 'Kinara' })
    const withLogo = buildEscPosReceipt(data, bmp)
    const without = buildEscPosReceipt(data)
    expect(withLogo.length).toBe(without.length + 608 + 3)
    // init (ESC @) + rata tengah (ESC a 1), lalu raster logo.
    expect([...withLogo.slice(5, 9)]).toEqual([0x1d, 0x76, 0x30, 0x00])
  })
})
