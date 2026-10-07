import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { effectiveDiscountPercent } from '@/db/repositories/orders'
import type { DiscountType } from '@/types/domain'

const DISCOUNT_REASONS = ['Pelanggan langganan', 'Karyawan', 'Promo', 'Kompensasi komplain']

interface Props {
  initialType: DiscountType | null
  initialValue: number
  /** Kantin: diskon wajib alasan; di atas `maxPercent` butuh kode Pemilik. */
  controlled?: boolean
  maxPercent?: number
  subtotal?: number
  onCancel: () => void
  onConfirm: (type: DiscountType | null, value: number, reason: string) => void
}

export function DiscountModal({ initialType, initialValue, controlled = false, maxPercent = 10, subtotal = 0, onCancel, onConfirm }: Props) {
  const [type, setType] = useState<DiscountType>(initialType ?? 'percent')
  const [value, setValue] = useState(initialValue || 0)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const percent = effectiveDiscountPercent(subtotal, type, value)
  const overLimit = controlled && percent > maxPercent + 1e-9

  function submit() {
    if (controlled && value > 0 && !reason.trim()) {
      setError('Alasan diskon wajib diisi')
      return
    }
    onConfirm(type, value, reason.trim())
  }

  return (
    <Modal onClose={onCancel}>
        <h2 className="mb-4 text-lg font-bold text-ink-50">Diskon Transaksi</h2>
        <div className="mb-4 grid grid-cols-2 gap-2">
          <button onClick={() => setType('percent')} className={`btn ${type === 'percent' ? 'btn-primary' : 'btn-secondary'}`}>
            Persen (%)
          </button>
          <button onClick={() => setType('amount')} className={`btn ${type === 'amount' ? 'btn-primary' : 'btn-secondary'}`}>
            Nominal (Rp)
          </button>
        </div>
        <input
          type="number"
          min={0}
          className="input-field mb-2"
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          autoFocus
        />
        {controlled && (
          <>
            <p className={`mb-3 text-xs ${overLimit ? 'text-yellow-300' : 'text-ink-500'}`}>
              {value > 0 ? `Setara ${percent.toFixed(1)}% dari subtotal. ` : ''}
              {overLimit ? `Melebihi batas ${maxPercent}% — butuh kode sekali pakai dari Pemilik.` : `Batas tanpa persetujuan: ${maxPercent}%.`}
            </p>
            <div className="mb-2 flex flex-wrap gap-2">
              {DISCOUNT_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`btn btn-compact !px-3 text-sm ${reason === r ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => {
                    setReason(r)
                    setError(null)
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
            <textarea className="input-field mb-2" rows={2} placeholder="Alasan diskon (wajib)…" value={reason} onChange={(e) => setReason(e.target.value)} />
          </>
        )}
        {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
        <div className="mt-2 flex gap-3">
          <button
            className="btn-ghost flex-1"
            onClick={() => {
              onConfirm(null, 0, '')
            }}
          >
            Hapus Diskon
          </button>
          <button className="btn-primary flex-[2]" onClick={submit}>
            {overLimit ? 'Lanjut ke Kode Pemilik' : 'Simpan'}
          </button>
        </div>
    </Modal>
  )
}
