import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSampleReceiptData } from '@/features/printing/receiptData'
import { DEFAULT_SETTINGS } from '@/db/repositories/settings'

const isNative = vi.fn(() => true)
const print = vi.fn()
const connectBluetooth = vi.fn()
const printBytes = vi.fn()

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => isNative() } }))
vi.mock('@/native/escPosPrinterPlugin', () => ({
  EscPosPrinter: {
    print: (opts: Record<string, unknown>) => print(opts),
    connectBluetooth: (opts: Record<string, unknown>) => connectBluetooth(opts),
    printBytes: (opts: Record<string, unknown>) => printBytes(opts),
  },
}))

const sample = buildSampleReceiptData(DEFAULT_SETTINGS)
const btConfig = { connectionType: 'bluetooth' as const, bluetoothAddress: 'AA:BB:CC', networkHost: null, networkPort: null }

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('NativeEscPosDriver — cetak lewat satu panggilan native', () => {
  it('memakai metode print (sambung-pakai-ulang di native), bukan connect + printBytes terpisah', async () => {
    print.mockResolvedValue({ success: true })
    const { NativeEscPosDriver } = await import('./printerDrivers')

    await expect(new NativeEscPosDriver(btConfig).print(sample)).resolves.toBeUndefined()

    expect(print).toHaveBeenCalledOnce()
    expect(print.mock.calls[0][0]).toMatchObject({ type: 'bluetooth', address: 'AA:BB:CC' })
    expect((print.mock.calls[0][0] as { base64: string }).base64.length).toBeGreaterThan(0)
    expect(connectBluetooth).not.toHaveBeenCalled()
    expect(printBytes).not.toHaveBeenCalled()
  })

  it('tidak menyerah di 3 detik: Bluetooth yang lambat menyambung (5 dtk) tetap berhasil', async () => {
    vi.useFakeTimers()
    print.mockReturnValue(new Promise((resolve) => setTimeout(() => resolve({ success: true }), 5000)))
    const { NativeEscPosDriver } = await import('./printerDrivers')

    const assertion = expect(new NativeEscPosDriver(btConfig).print(sample)).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(5000)
    await assertion
  })

  it('tak menyerah sebelum native selesai menyambung ulang (≈32 dtk) — menyerah duluan = struk dobel saat dicoba ulang', async () => {
    vi.useFakeTimers()
    let finish: (v: { success: boolean }) => void = () => {}
    print.mockReturnValue(new Promise((r) => (finish = r)))
    const { NativeEscPosDriver } = await import('./printerDrivers')
    const assertion = expect(new NativeEscPosDriver(btConfig).print(sample)).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(32_000)
    finish({ success: true })
    await assertion
  })

  it('gagal dengan PrinterTimeoutError setelah 40 detik bila printer tak merespons sama sekali (mis. mati)', async () => {
    vi.useFakeTimers()
    print.mockReturnValue(new Promise(() => {}))
    const { NativeEscPosDriver, PrinterTimeoutError } = await import('./printerDrivers')

    // Pasang assertion (dan handler rejection-nya) SEBELUM memajukan waktu, supaya
    // vitest tidak melaporkan "Unhandled Rejection" saat timer menembak lebih dulu.
    const assertion = expect(new NativeEscPosDriver(btConfig).print(sample)).rejects.toThrow(PrinterTimeoutError)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(40_000)
    await assertion
  })
})

describe('sendEscPosBytes (antrean cetak)', () => {
  it('printer WiFi: kirim host/port ke metode print', async () => {
    print.mockResolvedValue({ success: true })
    const { sendEscPosBytes } = await import('./printerDrivers')
    await sendEscPosBytes(
      { connectionType: 'network', bluetoothAddress: null, networkHost: '192.168.1.50', networkPort: 9100 },
      new Uint8Array([0x1b, 0x40]),
    )
    expect(print).toHaveBeenCalledWith({ type: 'network', host: '192.168.1.50', port: 9100, base64: 'G0A=' })
  })

  it('koneksi yang menggantung ditolak setelah 40 detik', async () => {
    vi.useFakeTimers()
    print.mockReturnValue(new Promise(() => {}))
    const { sendEscPosBytes, PrinterTimeoutError } = await import('./printerDrivers')
    const assertion = expect(
      sendEscPosBytes(
        { connectionType: 'network', bluetoothAddress: null, networkHost: '192.168.1.50', networkPort: 9100 },
        new Uint8Array([0x1b, 0x40]),
      ),
    ).rejects.toThrow(PrinterTimeoutError)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(40_000)
    await assertion
  })
})

describe('warmUpPrinter', () => {
  it('menyambung lebih awal dengan data kosong; kegagalan diabaikan', async () => {
    print.mockRejectedValue(new Error('printer mati'))
    const { warmUpPrinter } = await import('./printerDrivers')
    expect(() => warmUpPrinter(btConfig)).not.toThrow()
    expect(print).toHaveBeenCalledWith({ type: 'bluetooth', address: 'AA:BB:CC', base64: '' })
    await Promise.resolve()
  })

  it('tidak melakukan apa-apa untuk printer browser atau di web/PWA', async () => {
    const { warmUpPrinter } = await import('./printerDrivers')
    warmUpPrinter({ ...btConfig, connectionType: 'browser' })
    isNative.mockReturnValueOnce(false)
    warmUpPrinter(btConfig)
    expect(print).not.toHaveBeenCalled()
  })
})
