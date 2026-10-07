import { useRef, useState } from 'react'
import { readFileAsResizedDataUrl } from '@/lib/image'
import { Icon } from '@/components/ui/Icon'
import type { PaymentProofDraft } from '@/features/payments/paymentProofDraft'

const MAX_PHOTOS = 3

/**
 * Ambil foto bukti pembayaran (layar QRIS sukses di HP pembeli, uang tunai, dsb.)
 * lewat kamera tablet. `capture="environment"` membuka kamera belakang langsung;
 * foto dikecilkan dulu supaya ringan disimpan & disinkronkan. Untuk metode wajib
 * (QRIS kantin) foto tidak bisa dilewati; untuk tunai foto opsional.
 */
export function PaymentProofCapture({
  draft,
  onChange,
  required,
}: {
  draft: PaymentProofDraft
  onChange: (draft: PaymentProofDraft) => void
  required: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const { photos } = draft

  return (
    <div className="mb-4 rounded-xl bg-ink-900 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink-200">
          Foto Bukti Pembayaran{' '}
          {required ? <span className="text-red-400">*wajib</span> : <span className="text-ink-500">(opsional)</span>}
        </span>
        {photos.length < MAX_PHOTOS && (
          <button type="button" className="btn-secondary !min-h-[2.75rem] !px-3 !py-2 text-sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Icon name="image" size={16} className="mr-1 inline" /> {busy ? 'Memproses…' : photos.length ? 'Tambah Foto' : 'Ambil Foto'}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          setBusy(true)
          try {
            onChange({ photos: [...photos, await readFileAsResizedDataUrl(file, 1024, 0.7)] })
          } finally {
            setBusy(false)
          }
        }}
      />

      {photos.length > 0 ? (
        <div className="flex gap-2">
          {photos.map((src, i) => (
            <div key={i} className="relative">
              <img src={src} alt={`Bukti pembayaran ${i + 1}`} className="h-20 w-20 rounded-lg object-cover" />
              <button
                type="button"
                aria-label="Hapus foto"
                className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white"
                onClick={() => onChange({ photos: photos.filter((_, j) => j !== i) })}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-ink-500">
          {required ? 'Foto layar QRIS berhasil di HP pembeli — pembayaran QRIS tidak bisa diselesaikan tanpa foto.' : 'Boleh dilewati untuk pembayaran tunai.'}
        </p>
      )}
    </div>
  )
}
