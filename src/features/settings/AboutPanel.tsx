import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings, businessDisplayName } from '@/db/repositories/settings'
import { getDeviceId, getDeviceLabel } from '@/sync/device'
import { getApiBaseUrl } from '@/sync/deviceConfig'
import { ensurePersistentStorage, getStoragePersistStatus } from '@/lib/persistentStorage'
import { Icon } from '@/components/ui/Icon'
import { PRODUCT_LOGO, PRODUCT_NAME, PRODUCT_TAGLINE, PRODUCT_VERSION } from '@/lib/brand'

/**
 * Panel "Tentang". Selain identitas produk, panel ini adalah tempat pertama
 * yang dibuka saat meminta bantuan — jadi ia menampilkan data yang biasanya
 * ditanyakan lebih dulu (versi, id perangkat, alamat server) dalam bentuk yang
 * gampang dibacakan lewat telepon.
 */
export function AboutPanel() {
  const settings = useLiveQuery(() => getSettings(), [])
  const apiBaseUrl = getApiBaseUrl()
  const [storageStatus, setStorageStatus] = useState(getStoragePersistStatus())

  useEffect(() => {
    // ensurePersistentStorage() sudah dipanggil sekali di main.tsx; panggilan di sini
    // aman diulang (browser yang sudah mengizinkan langsung menjawab `true` lagi) dan
    // memastikan panel ini menunjukkan status terkini saat dibuka, bukan status basi
    // dari sebelum izin diberikan/ditolak oleh OS.
    let alive = true
    void ensurePersistentStorage().then((r) => alive && setStorageStatus(r))
    return () => {
      alive = false
    }
  }, [])

  const storageLabel = !storageStatus.supported
    ? 'Tidak didukung perangkat ini'
    : storageStatus.persisted
      ? 'Terkunci (aman dari penghapusan otomatis)'
      : 'Belum terkunci — cadangkan data secara berkala'

  const rows: { label: string; value: string }[] = [
    { label: 'Versi aplikasi', value: PRODUCT_VERSION },
    { label: 'Usaha terdaftar', value: businessDisplayName(settings) },
    { label: 'Perangkat', value: getDeviceLabel() || '—' },
    { label: 'ID perangkat', value: getDeviceId() },
    { label: 'Server sinkronisasi', value: apiBaseUrl || 'Belum diatur (mode offline penuh)' },
    { label: 'Zona waktu', value: settings?.timezone ?? '—' },
    { label: 'Penyimpanan data', value: storageLabel },
  ]

  return (
    <div className="max-w-xl space-y-6">
      <div className="card flex items-center gap-4 p-5">
        <img src={PRODUCT_LOGO} alt={PRODUCT_NAME} className="h-9 w-auto" />
        <div className="min-w-0">
          <p className="text-sm text-ink-200">{PRODUCT_TAGLINE}</p>
        </div>
      </div>

      <div className="card divide-y divide-ink-700 overflow-hidden">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start justify-between gap-4 px-5 py-3">
            <span className="flex-none text-sm text-ink-300">{r.label}</span>
            <span className="min-w-0 break-all text-right text-sm font-medium text-ink-50">{r.value}</span>
          </div>
        ))}
      </div>

      <div className="card flex items-start gap-3 p-5 text-sm text-ink-200">
        <span className="mt-0.5 flex-none text-brand-400">
          <Icon name="alertTriangle" size={18} />
        </span>
        <p>
          Data transaksi tersimpan di perangkat ini. Bila sinkronisasi server belum diatur, buat backup berkala lewat
          tab <span className="font-semibold text-ink-50">Backup</span> — tanpa itu, kerusakan perangkat berarti data hilang.
        </p>
      </div>
    </div>
  )
}
