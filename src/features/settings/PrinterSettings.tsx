import { useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings, updateSettings } from '@/db/repositories/settings'
import { buildSampleReceiptData } from '@/features/printing/receiptData'
import { resolvePrinterDriver } from '@/features/printing/printerDrivers'
import { EscPosPrinter, type BluetoothPrinterDevice } from '@/native/escPosPrinterPlugin'
import { Icon } from '@/components/ui/Icon'
import type { PrinterConnectionType, ReceiptPaperSize } from '@/types/domain'

const isNative = Capacitor.isNativePlatform()

export function PrinterSettings() {
  const settings = useLiveQuery(() => getSettings(), [])
  const [testMessage, setTestMessage] = useState<string | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pairedDevices, setPairedDevices] = useState<BluetoothPrinterDevice[]>([])

  if (!settings) return null
  const config = settings.printerConfig

  async function patchConfig(patch: Partial<typeof config>) {
    await updateSettings({ printerConfig: { ...config, ...patch } })
  }

  async function handleTestPrint() {
    setBusy(true)
    setTestMessage(null)
    setTestError(null)
    try {
      const driver = resolvePrinterDriver(config)
      await driver.print(buildSampleReceiptData(settings!))
      setTestMessage('Perintah cetak berhasil dikirim ke printer.')
    } catch (e) {
      setTestError(e instanceof Error ? e.message : 'Gagal mencetak')
    } finally {
      setBusy(false)
    }
  }

  async function handleScanBluetooth() {
    try {
      const result = await EscPosPrinter.listPairedDevices()
      setPairedDevices(result.devices)
    } catch {
      setTestError('Tidak dapat mengambil daftar perangkat Bluetooth. Pastikan Bluetooth aktif dan izin diberikan.')
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="card p-5">
        <h3 className="mb-3 font-semibold text-ink-100">Koneksi Printer</h3>
        <div className="mb-4 grid grid-cols-2 gap-2">
          <ConnectionOption label="Browser/Sistem" value="browser" current={config.connectionType} onSelect={patchConfig} />
          <ConnectionOption label="Bluetooth" value="bluetooth" current={config.connectionType} onSelect={patchConfig} disabled={!isNative} />
          <ConnectionOption label="WiFi/LAN" value="network" current={config.connectionType} onSelect={patchConfig} disabled={!isNative} />
          <ConnectionOption label="Belum Ada" value="none" current={config.connectionType} onSelect={patchConfig} />
        </div>
        {!isNative && (
          <p className="mb-4 text-xs text-ink-500">
            Printer Bluetooth dan WiFi/LAN hanya tersedia pada aplikasi Android (APK). Pada PWA/browser, gunakan opsi
            Browser/Sistem.
          </p>
        )}

        {config.connectionType === 'bluetooth' && (
          <div className="mb-4">
            <button className="btn-secondary mb-2 w-full" onClick={() => void handleScanBluetooth()}>
              Cari Perangkat Bluetooth Terpasang
            </button>
            <div className="space-y-1">
              {pairedDevices.map((d) => (
                <button
                  key={d.address}
                  className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${
                    config.bluetoothAddress === d.address ? 'bg-brew-600 text-white' : 'bg-ink-800 text-ink-200'
                  }`}
                  onClick={() => void patchConfig({ bluetoothAddress: d.address, bluetoothName: d.name })}
                >
                  {d.name} ({d.address})
                </button>
              ))}
            </div>
            {config.bluetoothName && <p className="mt-2 text-xs text-ink-400">Terpilih: {config.bluetoothName}</p>}
          </div>
        )}

        {config.connectionType === 'network' && (
          <div className="mb-4 grid grid-cols-2 gap-3">
            <label>
              <span className="mb-1 block text-sm text-ink-300">Alamat IP</span>
              <input
                className="input-field"
                value={config.networkHost ?? ''}
                onChange={(e) => void patchConfig({ networkHost: e.target.value })}
                placeholder="192.168.1.50"
              />
            </label>
            <label>
              <span className="mb-1 block text-sm text-ink-300">Port</span>
              <input
                type="number"
                className="input-field"
                value={config.networkPort ?? 9100}
                onChange={(e) => void patchConfig({ networkPort: Number(e.target.value) })}
              />
            </label>
          </div>
        )}

        <label className="mb-2 block">
          <span className="mb-1 block text-sm text-ink-300">Ukuran Kertas</span>
          <div className="flex gap-2">
            {(['58mm', '80mm'] as ReceiptPaperSize[]).map((size) => (
              <button
                key={size}
                className={`btn flex-1 ${config.paperSize === size ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => void patchConfig({ paperSize: size })}
              >
                {size}
              </button>
            ))}
          </div>
        </label>

        <label className="mt-3 flex items-center gap-2 text-sm text-ink-300">
          <input type="checkbox" checked={config.autoPrintOnPayment} onChange={(e) => void patchConfig({ autoPrintOnPayment: e.target.checked })} />
          Cetak struk otomatis setelah pembayaran
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm text-ink-300">
          <input
            type="checkbox"
            checked={config.autoPrintKitchenOrder}
            onChange={(e) => void patchConfig({ autoPrintKitchenOrder: e.target.checked })}
          />
          Cetak order dapur otomatis saat pesanan baru
        </label>

        <button className="btn-primary mt-4 flex w-full items-center justify-center gap-2" disabled={busy || config.connectionType === 'none'} onClick={() => void handleTestPrint()}>
          <Icon name="printer" size={18} />
          {busy ? 'Mencetak...' : 'Test Print'}
        </button>
        {testMessage && <p className="mt-2 text-sm text-sage-500">{testMessage}</p>}
        {testError && <p className="mt-2 text-sm text-red-400">{testError}</p>}
      </div>
    </div>
  )
}

function ConnectionOption({
  label,
  value,
  current,
  disabled,
  onSelect,
}: {
  label: string
  value: PrinterConnectionType
  current: PrinterConnectionType
  disabled?: boolean
  onSelect: (patch: { connectionType: PrinterConnectionType }) => void
}) {
  return (
    <button
      disabled={disabled}
      onClick={() => onSelect({ connectionType: value })}
      className={`btn !py-2.5 text-sm ${current === value ? 'btn-primary' : 'btn-secondary'} disabled:opacity-30`}
    >
      {label}
    </button>
  )
}
