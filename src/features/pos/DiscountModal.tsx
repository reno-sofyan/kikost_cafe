import { useState } from 'react'
import type { DiscountType } from '@/types/domain'

interface Props {
  initialType: DiscountType | null
  initialValue: number
  onCancel: () => void
  onConfirm: (type: DiscountType | null, value: number) => void
}

export function DiscountModal({ initialType, initialValue, onCancel, onConfirm }: Props) {
  const [type, setType] = useState<DiscountType>(initialType ?? 'percent')
  const [value, setValue] = useState(initialValue || 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl bg-ink-900 p-6" onClick={(e) => e.stopPropagation()}>
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
          className="input-field mb-4"
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          autoFocus
        />
        <div className="flex gap-3">
          <button
            className="btn-ghost flex-1"
            onClick={() => {
              onConfirm(null, 0)
            }}
          >
            Hapus Diskon
          </button>
          <button className="btn-primary flex-[2]" onClick={() => onConfirm(type, value)}>
            Simpan
          </button>
        </div>
      </div>
    </div>
  )
}
