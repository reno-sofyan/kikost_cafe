import { useState } from 'react'
import { formatRupiah, parseRupiahInput } from '@/lib/currency'
import type { PaymentMethod } from '@/types/domain'

interface Props {
  method: Extract<PaymentMethod, 'transfer' | 'card'>
  remaining: number
  onCancel: () => void
  onConfirm: (params: { amount: number; reference: string }) => void
}

const METHOD_LABEL: Record<Props['method'], string> = {
  transfer: 'Transfer Bank',
  card: 'Kartu Debit/Kredit',
}

export function ReferencePaymentModal({ method, remaining, onCancel, onConfirm }: Props) {
  const [amount, setAmount] = useState(remaining)
  const [reference, setReference] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl bg-ink-900 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-ink-50">{METHOD_LABEL[method]}</h2>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-ink-300">Jumlah</span>
          <input
            className="input-field"
            inputMode="numeric"
            value={formatRupiah(amount)}
            onChange={(e) => setAmount(Math.min(remaining, parseRupiahInput(e.target.value)))}
          />
          <p className="mt-1 text-xs text-ink-500">Sisa tagihan: {formatRupiah(remaining)}</p>
        </label>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-ink-300">
            {method === 'transfer' ? 'Referensi/No. Rekening Pengirim (opsional)' : 'No. Kartu (4 digit terakhir, opsional)'}
          </span>
          <input className="input-field" value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        <div className="flex gap-3">
          <button className="btn-ghost flex-1" onClick={onCancel}>
            Batal
          </button>
          <button
            className="btn-primary flex-[2]"
            onClick={() => {
              if (amount <= 0) {
                setError('Jumlah tidak valid')
                return
              }
              onConfirm({ amount, reference })
            }}
          >
            Konfirmasi
          </button>
        </div>
      </div>
    </div>
  )
}
