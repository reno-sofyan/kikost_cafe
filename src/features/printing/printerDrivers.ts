import { Capacitor } from '@capacitor/core'
import { buildEscPosReceipt } from '@/features/printing/escpos'
import { renderReceiptDocument } from '@/features/printing/renderReceiptHtml'
import { EscPosPrinter } from '@/native/escPosPrinterPlugin'
import type { ReceiptData } from '@/features/printing/receiptData'
import type { PrinterConnectionSettings } from '@/types/domain'

export interface PrinterDriver {
  print(data: ReceiptData): Promise<void>
}

export class PrinterNotConfiguredError extends Error {
  constructor() {
    super('Printer belum dikonfigurasi. Atur printer terlebih dahulu di menu Pengaturan.')
    this.name = 'PrinterNotConfiguredError'
  }
}

export class PrinterUnavailableOnPlatformError extends Error {
  constructor() {
    super('Printer Bluetooth/WiFi hanya tersedia pada aplikasi Android (APK), bukan di web/PWA.')
    this.name = 'PrinterUnavailableOnPlatformError'
  }
}

export class PrinterTimeoutError extends Error {
  constructor() {
    super('Printer tidak merespons (mati atau di luar jangkauan). Periksa printer lalu coba cetak ulang.')
    this.name = 'PrinterTimeoutError'
  }
}

/** Batas waktu satu operasi cetak (sambung + kirim) — plugin native Android bisa
 *  menggantung tanpa batas saat printer mati/di luar jangkauan (mis. Bluetooth SPP
 *  menunggu ACK yang tak pernah datang); tanpa ini kasir terjebak di layar "Mencetak…".
 *  Dulu 3 detik: terlalu pendek untuk menyambung Bluetooth (sering 2-5 detik, plus
 *  satu cara cadangan), sehingga cetak dianggap gagal lalu diulang dari awal.
 *  Harus LEBIH PANJANG dari kasus terburuk di native (pemanasan yang sedang
 *  berjalan ≤16 dtk + sambung ulang 2 cara × 8 dtk, lihat BT_CONNECT_TIMEOUT_MS
 *  di EscPosPrinterPlugin.java): bila JS menyerah lebih dulu sementara native
 *  akhirnya berhasil, job dicoba ulang dan struk tercetak dobel. */
const PRINTER_OP_TIMEOUT_MS = 40_000

function withPrinterTimeout<T>(op: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new PrinterTimeoutError()), PRINTER_OP_TIMEOUT_MS)
    op.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/** Mencetak lewat dialog print bawaan browser/sistem operasi (tersedia di PWA maupun APK). */
export class BrowserPrintDriver implements PrinterDriver {
  async print(data: ReceiptData): Promise<void> {
    const html = renderReceiptDocument(data)
    const printFrame = document.createElement('iframe')
    printFrame.style.position = 'fixed'
    printFrame.style.right = '0'
    printFrame.style.bottom = '0'
    printFrame.style.width = '0'
    printFrame.style.height = '0'
    printFrame.style.border = '0'
    document.body.appendChild(printFrame)

    const doc = printFrame.contentWindow?.document
    if (!doc) throw new Error('Gagal menyiapkan halaman cetak')
    doc.open()
    doc.write(html)
    doc.close()

    await new Promise((resolve) => setTimeout(resolve, 200))
    printFrame.contentWindow?.focus()
    printFrame.contentWindow?.print()

    setTimeout(() => document.body.removeChild(printFrame), 2000)
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Mencetak lewat printer Bluetooth atau WiFi/LAN memakai plugin native Capacitor (hanya di APK). */
export class NativeEscPosDriver implements PrinterDriver {
  constructor(private readonly config: PrinterConnectionSettings) {}

  async print(data: ReceiptData): Promise<void> {
    if (!Capacitor.isNativePlatform()) throw new PrinterUnavailableOnPlatformError()

    if (this.config.connectionType !== 'bluetooth' && this.config.connectionType !== 'network') {
      throw new PrinterNotConfiguredError()
    }
    await nativePrint(this.config.connectionType, this.config, toBase64(buildEscPosReceipt(data)))
  }
}

/** Driver rekam-saja untuk automated test (Vitest/Playwright) tanpa perangkat printer fisik. */
export class MockPrinterDriver implements PrinterDriver {
  public readonly printedReceipts: ReceiptData[] = []
  public readonly printedBytes: Uint8Array[] = []

  async print(data: ReceiptData): Promise<void> {
    this.printedReceipts.push(data)
    this.printedBytes.push(buildEscPosReceipt(data))
    await Promise.resolve()
  }
}

export function resolvePrinterDriver(config: PrinterConnectionSettings): PrinterDriver {
  switch (config.connectionType) {
    case 'browser':
      return new BrowserPrintDriver()
    case 'bluetooth':
    case 'network':
      return new NativeEscPosDriver(config)
    case 'none':
      throw new PrinterNotConfiguredError()
  }
}

// ---- Transport tingkat rendah untuk antrean cetak (kirim byte ESC/POS ke satu printer) ----

interface EscPosTransportTarget {
  connectionType: 'bluetooth' | 'network' | 'browser'
  bluetoothAddress: string | null
  networkHost: string | null
  networkPort: number | null
}

export type EscPosSender = (target: EscPosTransportTarget, bytes: Uint8Array) => Promise<void>

let sender: EscPosSender = defaultSender

/** Untuk pengujian: ganti transport nyata dengan mock. */
export function setEscPosSender(next: EscPosSender): void {
  sender = next
}
export function resetEscPosSender(): void {
  sender = defaultSender
}

async function defaultSender(target: EscPosTransportTarget, bytes: Uint8Array): Promise<void> {
  if (target.connectionType === 'browser') {
    throw new PrinterNotConfiguredError()
  }
  if (!Capacitor.isNativePlatform()) throw new PrinterUnavailableOnPlatformError()
  await nativePrint(target.connectionType, target, toBase64(bytes))
}

/**
 * Satu panggilan native: plugin memakai ulang koneksi yang masih terbuka ke printer
 * ini (atau menyambung), lalu mengirim byte — tanpa sambung-ulang tiap struk.
 */
async function nativePrint(
  connectionType: 'bluetooth' | 'network',
  target: Pick<EscPosTransportTarget, 'bluetoothAddress' | 'networkHost' | 'networkPort'>,
  base64: string,
): Promise<void> {
  if (connectionType === 'bluetooth') {
    if (!target.bluetoothAddress) throw new PrinterNotConfiguredError()
    await withPrinterTimeout(EscPosPrinter.print({ type: 'bluetooth', address: target.bluetoothAddress, base64 }))
  } else {
    if (!target.networkHost || !target.networkPort) throw new PrinterNotConfiguredError()
    await withPrinterTimeout(EscPosPrinter.print({ type: 'network', host: target.networkHost, port: target.networkPort, base64 }))
  }
}

/**
 * Sambungkan printer lebih awal (mis. saat layar Pembayaran dibuka) supaya struk
 * langsung tercetak tanpa menunggu Bluetooth menyambung. Gagal = diam saja;
 * cetak sungguhan nanti tetap mencoba lagi.
 */
export function warmUpPrinter(target: EscPosTransportTarget): void {
  if (target.connectionType === 'browser' || !Capacitor.isNativePlatform()) return
  void nativePrint(target.connectionType, target, '').catch(() => {})
}

export function sendEscPosBytes(target: EscPosTransportTarget, bytes: Uint8Array): Promise<void> {
  return sender(target, bytes)
}
