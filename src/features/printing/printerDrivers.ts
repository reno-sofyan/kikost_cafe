import { Capacitor } from '@capacitor/core'
import { buildEscPosReceipt } from '@/features/printing/escpos'
import { renderReceiptDocument } from '@/features/printing/renderReceiptHtml'
import { EscPosPrinter } from '@/native/escPosPrinterPlugin'
import type { ReceiptData } from '@/features/printing/receiptData'
import type { PrinterConfig } from '@/types/domain'

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
  constructor(private readonly config: PrinterConfig) {}

  async print(data: ReceiptData): Promise<void> {
    if (!Capacitor.isNativePlatform()) throw new PrinterUnavailableOnPlatformError()

    if (this.config.connectionType === 'bluetooth') {
      if (!this.config.bluetoothAddress) throw new PrinterNotConfiguredError()
      await EscPosPrinter.connectBluetooth({ address: this.config.bluetoothAddress })
    } else if (this.config.connectionType === 'network') {
      if (!this.config.networkHost || !this.config.networkPort) throw new PrinterNotConfiguredError()
      await EscPosPrinter.connectNetwork({ host: this.config.networkHost, port: this.config.networkPort })
    } else {
      throw new PrinterNotConfiguredError()
    }

    const bytes = buildEscPosReceipt(data)
    await EscPosPrinter.printBytes({ base64: toBase64(bytes) })
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

export function resolvePrinterDriver(config: PrinterConfig): PrinterDriver {
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
  if (target.connectionType === 'bluetooth') {
    if (!target.bluetoothAddress) throw new PrinterNotConfiguredError()
    await EscPosPrinter.connectBluetooth({ address: target.bluetoothAddress })
  } else {
    if (!target.networkHost || !target.networkPort) throw new PrinterNotConfiguredError()
    await EscPosPrinter.connectNetwork({ host: target.networkHost, port: target.networkPort })
  }
  await EscPosPrinter.printBytes({ base64: toBase64(bytes) })
}

export function sendEscPosBytes(target: EscPosTransportTarget, bytes: Uint8Array): Promise<void> {
  return sender(target, bytes)
}
