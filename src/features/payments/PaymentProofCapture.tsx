import { useRef, useState } from 'react'
import { readFileAsResizedDataUrl } from '@/lib/image'
import { Icon } from '@/components/ui/Icon'
import { EMPTY_PROOF, type PaymentProofDraft } from '@/features/payments/paymentProofDraft'

const MAX_PHOTOS = 3

/**
 * Ambil foto bukti pembayaran (layar QRIS sukses di HP pembeli, uang tunai, dsb.)
 * lewat kamera tablet. `capture="environment"` membuka kamera belakang langsung;
 * foto dikecilkan dulu supaya ringan disimpan & disinkronkan. Bila tidak bisa
 * memotret, kasir wajib menulis alasannya (tercatat di riwayat & log aktivitas).
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
  const { photos, noPhotoReason } = draft
  const noPhotoMode = noPhotoReason !== null

  return (
    <div className="mb-4 rounded-xl bg-ink-900 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink-200">
          Foto Bukti Pembayaran {required && <span className="text-red-400">*wajib</span>}
        </span>
        {!noPhotoMode && photos.length < MAX_PHOTOS && (
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
            onChange({ photos: [...photos, await readFileAsResizedDataUrl(file, 1024, 0.7)], noPhotoReason: null })
          } finally {
            setBusy(false)
          }
        }}
      />

      {noPhotoMode ? (
        <div>
          <label className="block">
            <span className="mb-1 block text-xs text-ink-400">Alasan tidak ada foto (wajib, tercatat di riwayat)</span>
            <textarea
              className="input-field"
              rows={2}
              autoFocus
              placeholder="mis. kamera tablet rusak, pembeli sudah pergi sebelum difoto"
              value={noPhotoReason}
              onChange={(e) => onChange({ photos: [], noPhotoReason: e.target.value })}
            />
          </label>
          <button type="button" className="btn-ghost mt-1 !min-h-0 !px-0 !py-1 text-sm" onClick={() => onChange(EMPTY_PROOF)}>
            ← Kembali ambil foto
          </button>
        </div>
      ) : (
        <>
          {photos.length > 0 ? (
            <div className="flex gap-2">
              {photos.map((src, i) => (
                <div key={i} className="relative">
                  <img src={src} alt={`Bukti pembayaran ${i + 1}`} className="h-20 w-20 rounded-lg object-cover" />
                  <button
                    type="button"
                    aria-label="Hapus foto"
                    className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white"
                    onClick={() => onChange({ photos: photos.filter((_, j) => j !== i), noPhotoReason: null })}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-ink-500">Foto layar QRIS berhasil di HP pembeli, atau uang tunai yang diterima.</p>
          )}
          {photos.length === 0 && (
            <button
              type="button"
              className="btn-ghost mt-1 !min-h-0 !px-0 !py-1 text-sm text-ink-400"
              onClick={() => onChange({ photos: [], noPhotoReason: '' })}
            >
              Tidak bisa ambil foto?
            </button>
          )}
        </>
      )}
    </div>
  )
}
