import { describe, expect, it } from 'vitest'
import { buildEscPosReceipt } from './escpos'
import { buildSampleReceiptData, type ReceiptData } from './receiptData'
import { MockPrinterDriver } from './printerDrivers'
import { DEFAULT_SETTINGS } from '@/db/repositories/settings'

const sample: ReceiptData = buildSampleReceiptData({
  ...DEFAULT_SETTINGS,
  cafeName: 'Kikost Cafe',
  address: 'Jl. Contoh 1',
  phone: '0812',
  taxPercent: 11,
  serviceChargePercent: 5,
})

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

describe('buildEscPosReceipt', () => {
  it('diawali ESC @ (init) dan diakhiri perintah potong kertas', () => {
    const bytes = buildEscPosReceipt(sample)
    expect(bytes[0]).toBe(0x1b)
    expect(bytes[1]).toBe(0x40)
    // GS V 0 = full cut
    const tail = Array.from(bytes.slice(-3))
    expect(tail).toEqual([0x1d, 0x56, 0x00])
  })

  it('memuat identitas kafe, nomor order, item, total, dan pembayaran', () => {
    const text = decode(buildEscPosReceipt(sample))
    expect(text).toContain('Kikost Cafe')
    expect(text).toContain(sample.orderNumber)
    expect(text).toContain('Kopi Susu Gula Aren')
    expect(text).toContain('TOTAL')
    expect(text).toContain('Tunai')
    expect(text).toContain('Kembali')
  })

  it('lebar baris 58mm = 32 kolom, 80mm = 48 kolom (garis pemisah)', () => {
    const t58 = decode(buildEscPosReceipt({ ...sample, paperSize: '58mm' }))
    const t80 = decode(buildEscPosReceipt({ ...sample, paperSize: '80mm' }))
    expect(t58).toContain('-'.repeat(32))
    expect(t58).not.toContain('-'.repeat(33))
    expect(t80).toContain('-'.repeat(48))
  })

  it('menandai transaksi dibatalkan', () => {
    const text = decode(buildEscPosReceipt({ ...sample, isVoided: true }))
    expect(text).toContain('TRANSAKSI DIBATALKAN')
  })
})

describe('MockPrinterDriver', () => {
  it('merekam struk & byte ESC/POS tanpa hardware', async () => {
    const driver = new MockPrinterDriver()
    await driver.print(sample)
    await driver.print({ ...sample, orderNumber: 'KKP-00002' })
    expect(driver.printedReceipts).toHaveLength(2)
    expect(driver.printedBytes[0][0]).toBe(0x1b)
    expect(driver.printedReceipts[1].orderNumber).toBe('KKP-00002')
  })
})
