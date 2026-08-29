import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings } from '@/db/repositories/settings'
import { formatRupiah } from '@/lib/currency'

interface Props {
  amount: number
  onCancel: () => void
  onConfirm: () => void
}

export function QrisPaymentModal({ amount, onCancel, onConfirm }: Props) {
  const settings = useLiveQuery(() => getSettings(), [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl bg-ink-900 p-6 text-center" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-lg font-bold text-ink-50">Pembayaran QRIS</h2>
        <p className="mb-4 text-2xl font-bold text-brew-400">{formatRupiah(amount)}</p>

        {settings?.qrisImageDataUrl ? (
          <img src={settings.qrisImageDataUrl} alt="QRIS" className="mx-auto mb-4 h-64 w-64 rounded-xl bg-white object-contain p-2" />
        ) : (
          <div className="mb-4 rounded-xl bg-red-900/30 p-6 text-sm text-red-300">
            Gambar QRIS belum diatur. Silakan unggah di menu Pengaturan &gt; QRIS.
          </div>
        )}
        {settings?.qrisMerchantName && <p className="mb-4 text-sm text-ink-400">{settings.qrisMerchantName}</p>}

        <p className="mb-4 text-xs text-ink-500">
          Periksa notifikasi pembayaran pada perangkat/aplikasi penerima QRIS kafe sebelum menekan tombol konfirmasi.
        </p>

        <div className="flex gap-3">
          <button className="btn-ghost flex-1" onClick={onCancel}>
            Batal
          </button>
          <button className="btn-primary flex-[2]" onClick={onConfirm}>
            Pembayaran Telah Diterima
          </button>
        </div>
      </div>
    </div>
  )
}
