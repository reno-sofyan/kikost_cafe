import { beforeEach, describe, expect, it } from 'vitest'
import { buildEscPosReceipt } from './escpos'
import { buildSampleReceiptData, type ReceiptData } from './receiptData'
import { MockPrinterDriver, PrinterNotConfiguredError } from './printerDrivers'
import { printReceiptData } from './printReceipt'
import { savePrinter } from '@/db/repositories/printers'
import { DEFAULT_SETTINGS } from '@/db/repositories/settings'
import { resetLocalDb } from '@/test/db'

const sample: ReceiptData = buildSampleReceiptData({
  ...DEFAULT_SETTINGS,
  businessName: 'Kopi Senja',
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
    expect(text).toContain('Kopi Senja')
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

const actor = { userId: 'u1', userName: 'Admin' }

describe('printReceiptData (regresi: harus resolve printer dari tabel `printers`, bukan settings.printerConfig lawas)', () => {
  beforeEach(() => resetLocalDb())

  it('gagal jelas kalau belum ada printer kasir aktif', async () => {
    await expect(printReceiptData(sample)).rejects.toThrow(PrinterNotConfiguredError)
  })

  it('berhasil begitu printer kasir dikonfigurasi lewat Pengaturan > Printer (tabel `printers`)', async () => {
    await savePrinter(
      { name: 'Kasir', station: 'cashier', connectionType: 'browser', bluetoothAddress: null, bluetoothName: null, networkHost: null, networkPort: null, paperSize: '58mm', active: true, fallbackPrinterId: null },
      actor,
    )
    await expect(printReceiptData(sample)).resolves.not.toThrow()
  })
})

describe('MockPrinterDriver', () => {
  it('merekam struk & byte ESC/POS tanpa hardware', async () => {
    const driver = new MockPrinterDriver()
    await driver.print(sample)
    await driver.print({ ...sample, orderNumber: 'TRX-00002' })
    expect(driver.printedReceipts).toHaveLength(2)
    expect(driver.printedBytes[0][0]).toBe(0x1b)
    expect(driver.printedReceipts[1].orderNumber).toBe('TRX-00002')
  })
})

describe('QR ulasan di struk', () => {
  const url = 'https://pos.kikost.com/ulasan/3f2b8c1e-9a4d-4e2f-8b1a-0c9d8e7f6a5b'

  it('ESC/POS: judul + perintah QR berisi URL; tanpa reviewUrl tak ada QR', () => {
    const bytes = buildEscPosReceipt({ ...sample, reviewUrl: url })
    expect(decode(bytes)).toContain('Beri ulasan untuk kami')
    expect(decode(bytes)).toContain(url)
    const hasQr = (b: Uint8Array) => b.some((v, i) => v === 0x1d && b[i + 1] === 0x28 && b[i + 2] === 0x6b && b[i + 5] === 0x31 && b[i + 6] === 0x50)
    expect(hasQr(bytes)).toBe(true)
    expect(hasQr(buildEscPosReceipt(sample))).toBe(false)
  })

  it('HTML pratinjau memuat QR SVG; teks WhatsApp memuat tautan', async () => {
    const { renderReceiptBodyHtml } = await import('./renderReceiptHtml')
    const { receiptToText } = await import('@/lib/receiptText')
    expect(renderReceiptBodyHtml({ ...sample, reviewUrl: url })).toMatch(/<svg class="qr"[^>]*>.*<path d="M/)
    expect(receiptToText({ ...sample, reviewUrl: url })).toContain(`Beri ulasan untuk kami: ${url}`)
  })

  it('reviewUrlFor: pakai alamat server sinkronisasi; tanpa alamat publik → null', async () => {
    const { reviewUrlFor } = await import('./receiptData')
    localStorage.setItem('kione.sync.apiBaseUrl', 'https://pos.kikost.com/')
    expect(reviewUrlFor('abc', { qrOrderBaseUrl: '' })).toBe('https://pos.kikost.com/ulasan/abc')
    localStorage.removeItem('kione.sync.apiBaseUrl')
    expect(reviewUrlFor('abc', { qrOrderBaseUrl: 'https://pesan.kinara.id' })).toBe('https://pesan.kinara.id/ulasan/abc')
    // jsdom: origin http://localhost → bukan alamat publik
    expect(reviewUrlFor('abc', { qrOrderBaseUrl: '' })).toBeNull()
  })
})
