import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSampleReceiptData } from '@/features/printing/receiptData'
import { DEFAULT_SETTINGS } from '@/db/repositories/settings'

const isNative = vi.fn(() => true)
const connectBluetooth = vi.fn()
const connectNetwork = vi.fn()
const printBytes = vi.fn()

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => isNative() } }))
vi.mock('@/native/escPosPrinterPlugin', () => ({
  EscPosPrinter: {
    connectBluetooth: (opts: Record<string, unknown>) => connectBluetooth(opts),
    connectNetwork: (opts: Record<string, unknown>) => connectNetwork(opts),
    printBytes: (opts: Record<string, unknown>) => printBytes(opts),
  },
}))

const sample = buildSampleReceiptData(DEFAULT_SETTINGS)

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('NativeEscPosDriver — batas waktu printer fisik', () => {
  it('gagal dengan PrinterTimeoutError setelah 3 detik bila printer tidak merespons (mis. mati)', async () => {
    vi.useFakeTimers()
    // Printer mati: promise connect tidak pernah resolve/reject.
    connectBluetooth.mockReturnValue(new Promise(() => {}))

    const { NativeEscPosDriver, PrinterTimeoutError } = await import('./printerDrivers')
    const driver = new NativeEscPosDriver({
      connectionType: 'bluetooth',
      bluetoothAddress: 'AA:BB:CC',
      networkHost: null,
      networkPort: null,
    })

    // Pasang assertion (dan handler rejection-nya) SEBELUM memajukan waktu, supaya
    // vitest tidak melaporkan "Unhandled Rejection" saat timer menembak lebih dulu.
    const assertion = expect(driver.print(sample)).rejects.toThrow(PrinterTimeoutError)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(3000)

    await assertion
    expect(printBytes).not.toHaveBeenCalled()
  })

  it('tidak menunggu 3 detik bila printer merespons normal', async () => {
    connectBluetooth.mockResolvedValue({ connected: true })
    printBytes.mockResolvedValue({ success: true })

    const { NativeEscPosDriver } = await import('./printerDrivers')
    const driver = new NativeEscPosDriver({
      connectionType: 'bluetooth',
      bluetoothAddress: 'AA:BB:CC',
      networkHost: null,
      networkPort: null,
    })

    await expect(driver.print(sample)).resolves.toBeUndefined()
    expect(connectBluetooth).toHaveBeenCalledOnce()
    expect(printBytes).toHaveBeenCalledOnce()
  })
})

describe('sendEscPosBytes (antrean cetak) — batas waktu yang sama', () => {
  it('koneksi jaringan yang menggantung (printer WiFi mati) ditolak setelah 3 detik', async () => {
    vi.useFakeTimers()
    connectNetwork.mockReturnValue(new Promise(() => {}))

    const { sendEscPosBytes, PrinterTimeoutError } = await import('./printerDrivers')
    const assertion = expect(
      sendEscPosBytes(
        { connectionType: 'network', bluetoothAddress: null, networkHost: '192.168.1.50', networkPort: 9100 },
        new Uint8Array([0x1b, 0x40]),
      ),
    ).rejects.toThrow(PrinterTimeoutError)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(3000)

    await assertion
  })
})
