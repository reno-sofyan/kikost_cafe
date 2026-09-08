import { Capacitor } from '@capacitor/core'
import { UsbSerial } from '@/native/usbSerialPlugin'
import { buildPagerFrame, bytesToHex } from '@/features/pager/pagerProtocol'
import type { PagerConfig } from '@/types/domain'

export interface PagerDriver {
  /** Membunyikan coaster pager bernomor `pagerNumber`. */
  call(pagerNumber: number): Promise<void>
}

export class PagerNotConfiguredError extends Error {
  constructor(message = 'Pager Retekess belum dikonfigurasi. Atur di menu Pengaturan → Pager.') {
    super(message)
    this.name = 'PagerNotConfiguredError'
  }
}

export class PagerUnavailableOnPlatformError extends Error {
  constructor() {
    super('Integrasi pager USB hanya tersedia pada aplikasi Android (APK), bukan di web/PWA.')
    this.name = 'PagerUnavailableOnPlatformError'
  }
}

/** Perangkat ini bukan jembatan pager — panggilan diabaikan (tidak melempar). */
export class NoopPagerDriver implements PagerDriver {
  async call(_pagerNumber: number): Promise<void> {
    await Promise.resolve()
  }
}

/** Kirim frame perintah ke base station Retekess lewat plugin native UsbSerial (hanya APK). */
export class NativeUsbSerialPagerDriver implements PagerDriver {
  constructor(private readonly config: PagerConfig) {}

  async call(pagerNumber: number): Promise<void> {
    if (!this.config.commandTemplateHex.trim()) throw new PagerNotConfiguredError()

    const frame = buildPagerFrame(this.config.commandTemplateHex, pagerNumber)
    await sendPagerFrame(
      {
        baudRate: this.config.baudRate,
        deviceId: this.config.usbDeviceId,
        interCharDelayMs: this.config.interCharDelayMs,
      },
      frame,
    )
  }
}

/** Driver rekam-saja untuk automated test tanpa hardware. */
export class MockPagerDriver implements PagerDriver {
  public readonly calledNumbers: number[] = []

  async call(pagerNumber: number): Promise<void> {
    this.calledNumbers.push(pagerNumber)
    await Promise.resolve()
  }
}

export function resolvePagerDriver(config: PagerConfig): PagerDriver {
  switch (config.connectionType) {
    case 'usb-serial':
      return new NativeUsbSerialPagerDriver(config)
    case 'none':
    default:
      return new NoopPagerDriver()
  }
}

// ---- Transport tingkat rendah (bisa di-mock untuk test) ----

export interface PagerSerialTarget {
  baudRate: number
  deviceId: number | null
  interCharDelayMs: number
}

export type PagerSender = (target: PagerSerialTarget, frame: Uint8Array) => Promise<void>

async function defaultSender(target: PagerSerialTarget, frame: Uint8Array): Promise<void> {
  if (!Capacitor.isNativePlatform()) throw new PagerUnavailableOnPlatformError()
  await UsbSerial.open({
    baudRate: target.baudRate,
    ...(target.deviceId != null ? { deviceId: target.deviceId } : {}),
  })
  try {
    await UsbSerial.writeHex({ hex: bytesToHex(frame), interCharDelayMs: target.interCharDelayMs })
  } finally {
    await UsbSerial.close().catch(() => undefined)
  }
}

let sender: PagerSender = defaultSender

/** Untuk pengujian: ganti transport nyata dengan mock. */
export function setPagerSender(next: PagerSender): void {
  sender = next
}
export function resetPagerSender(): void {
  sender = defaultSender
}

export function sendPagerFrame(target: PagerSerialTarget, frame: Uint8Array): Promise<void> {
  return sender(target, frame)
}
