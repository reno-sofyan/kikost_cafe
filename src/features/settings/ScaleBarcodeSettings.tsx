import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings, updateSettings } from '@/db/repositories/settings'
import { DEFAULT_SCALE_BARCODE, ean13CheckDigit, parseScaleBarcode } from '@/lib/retailPricing'
import { toast } from '@/state/toastStore'
import type { ScaleBarcodeConfig } from '@/types/domain'

/**
 * Minimarket: format barcode label timbangan (EAN-13 berawalan 2). Produk timbang
 * dicocokkan lewat "Kode PLU timbangan" di form produk.
 */
export function ScaleBarcodeSettings() {
  const settings = useLiveQuery(() => getSettings(), [])
  const [config, setConfig] = useState<ScaleBarcodeConfig>(DEFAULT_SCALE_BARCODE)
  const [sample, setSample] = useState('')

  useEffect(() => {
    if (settings) setConfig({ ...DEFAULT_SCALE_BARCODE, ...settings.scaleBarcode })
  }, [settings])

  const valueDigits = 12 - config.flagLength - config.pluLength
  // Contoh barcode dari format saat ini: PLU 123, 0,5 kg (atau Rp5.000).
  const example = (() => {
    if (valueDigits < 3) return null
    const flag = config.prefix.padEnd(config.flagLength, '0').slice(0, config.flagLength)
    const first12 = flag + '123'.padStart(config.pluLength, '0') + String(config.valueKind === 'weight' ? 500 : 5000).padStart(valueDigits, '0')
    return first12.length === 12 ? first12 + ean13CheckDigit(first12) : null
  })()
  const parsed = sample.trim() ? parseScaleBarcode(sample, { ...config, enabled: true }) : null

  async function save() {
    if (!/^\d{1,3}$/.test(config.prefix) || config.prefix.length > config.flagLength) return toast.warning('Awalan harus 1–3 digit dan tak lebih panjang dari digit penanda.')
    if (valueDigits < 3) return toast.warning('Digit nilai terlalu sedikit — kurangi panjang PLU.')
    await updateSettings({ scaleBarcode: config })
    toast.success('Format barcode timbangan disimpan.')
  }

  const num = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Math.floor(Number(v) || min)))

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h2 className="text-lg font-bold text-ink-50">Barcode Timbangan</h2>
        <p className="text-sm text-ink-400">
          Label dari timbangan digital berisi kode barang (PLU) dan berat/harga. Saat dipindai di kasir, produk dengan PLU yang sama otomatis masuk dengan beratnya.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-200">
        <input type="checkbox" checked={config.enabled} onChange={(e) => setConfig({ ...config, enabled: e.target.checked })} /> Aktifkan barcode timbangan
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Awalan barcode</span>
          <input className="input-field" inputMode="numeric" value={config.prefix} onChange={(e) => setConfig({ ...config, prefix: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Digit penanda</span>
          <input type="number" min={1} max={3} className="input-field" value={config.flagLength} onChange={(e) => setConfig({ ...config, flagLength: num(e.target.value, 1, 3) })} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Panjang PLU</span>
          <input type="number" min={3} max={7} className="input-field" value={config.pluLength} onChange={(e) => setConfig({ ...config, pluLength: num(e.target.value, 3, 7) })} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Isi nilai</span>
          <select className="input-field" value={config.valueKind} onChange={(e) => setConfig({ ...config, valueKind: e.target.value as ScaleBarcodeConfig['valueKind'] })}>
            <option value="weight">Berat (gram)</option>
            <option value="price">Harga (rupiah)</option>
          </select>
        </label>
      </div>
      <p className="rounded-xl bg-ink-800 p-3 font-mono text-sm text-ink-200">
        [{'P'.repeat(config.flagLength)}][{'K'.repeat(config.pluLength)}][{'N'.repeat(Math.max(0, valueDigits))}][C]
        {example && (
          <span className="mt-1 block font-sans text-xs text-ink-300">
            Contoh: {example} = PLU 123, {config.valueKind === 'weight' ? '500 gram' : 'Rp5.000'}
          </span>
        )}
      </p>
      <label className="block">
        <span className="mb-1 block text-sm text-ink-300">Uji barcode dari label timbangan</span>
        <input className="input-field font-mono" inputMode="numeric" placeholder="Pindai/ketik 13 digit" value={sample} onChange={(e) => setSample(e.target.value)} />
        {sample.trim() && (
          <span className={`mt-1 block text-sm ${parsed ? 'text-success-500' : 'text-red-500'}`}>
            {parsed ? `PLU ${parsed.plu} · ${config.valueKind === 'weight' ? `${parsed.value} gram` : `Rp${parsed.value.toLocaleString('id-ID')}`}` : 'Tidak cocok dengan format ini (atau digit cek salah).'}
          </span>
        )}
      </label>
      <button className="btn-primary" onClick={() => void save()}>
        Simpan
      </button>
    </div>
  )
}
