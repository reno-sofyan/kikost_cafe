import { useMemo, useState } from 'react'
import { formatRupiah, parseRupiahInput } from '@/lib/currency'

const QUICK_DENOMINATIONS = [5000, 10000, 20000, 50000, 100000]

interface Props {
  remaining: number
  onCancel: () => void
  onConfirm: (params: { amount: number; receivedAmount: number }) => void
}

export function CashPaymentModal({ remaining, onCancel, onConfirm }: Props) {
  const [amount, setAmount] = useState(remaining)
  const [received, setReceived] = useState(remaining)
  const [error, setError] = useState<string | null>(null)

  const willSettleFully = amount >= remaining
  const change = useMemo(() => Math.max(0, received - amount), [received, amount])

  function handleConfirm() {
    if (amount <= 0 || amount > remaining) {
      setError('Jumlah tidak valid')
      return
    }
    if (received < amount) {
      setError('Uang diterima kurang dari jumlah tagihan')
      return
    }
    onConfirm({ amount, receivedAmount: received })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl bg-ink-900 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-ink-50">Pembayaran Tunai</h2>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-ink-300">Jumlah untuk tagihan ini</span>
          <input
            className="input-field"
            inputMode="numeric"
            value={formatRupiah(amount)}
            onChange={(e) => {
              const next = Math.min(remaining, parseRupiahInput(e.target.value))
              setAmount(next)
              setReceived(next)
            }}
          />
          <p className="mt-1 text-xs text-ink-500">Sisa tagihan: {formatRupiah(remaining)}</p>
        </label>

        {willSettleFully && (
          <>
            <label className="mb-3 block">
              <span className="mb-1 block text-sm text-ink-300">Uang diterima</span>
              <input
                className="input-field"
                inputMode="numeric"
                value={formatRupiah(received)}
                onChange={(e) => setReceived(parseRupiahInput(e.target.value))}
              />
            </label>
            <div className="mb-3 grid grid-cols-3 gap-2">
              <button className="btn-secondary !py-2 text-sm" onClick={() => setReceived(amount)}>
                Uang Pas
              </button>
              {QUICK_DENOMINATIONS.map((denom) => (
                <button key={denom} className="btn-secondary !py-2 text-sm" onClick={() => setReceived((r) => r + denom)}>
                  +{formatRupiah(denom)}
                </button>
              ))}
            </div>
            <div className="mb-4 flex items-center justify-between rounded-xl bg-ink-800 px-4 py-3">
              <span className="text-ink-300">Kembalian</span>
              <span className="text-lg font-bold text-sage-500">{formatRupiah(change)}</span>
            </div>
          </>
        )}

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        <div className="flex gap-3">
          <button className="btn-ghost flex-1" onClick={onCancel}>
            Batal
          </button>
          <button className="btn-primary flex-[2]" onClick={handleConfirm}>
            Konfirmasi
          </button>
        </div>
      </div>
    </div>
  )
}
