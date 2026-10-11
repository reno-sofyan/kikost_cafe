import { useState } from 'react'
import { formatRupiah, parseRupiahInput } from '@/lib/currency'
import { Modal } from '@/components/ui/Modal'

interface Props {
  methodLabel: string
  /** Nominal tagihan yang dibayar lewat metode ini — dasar tombol persen. */
  baseAmount: number
  initial: number
  /** Tunai dengan uang diterima: sisa kembalian setelah tagihan (sebelum tip). */
  cashChange?: number | null
  onCancel: () => void
  onConfirm: (tipAmount: number) => void
}

const PRESETS = [5000, 10000, 20000, 50000]
const PERCENTS = [5, 10, 15]

/** Tip/gratuity untuk satu baris pembayaran. Dicatat terpisah — bukan omzet. */
export function TipModal({ methodLabel, baseAmount, initial, cashChange, onCancel, onConfirm }: Props) {
  const [amount, setAmount] = useState(initial)

  return (
    <Modal onClose={onCancel}>
      <h2 className="mb-1 text-lg font-bold text-ink-50">Tip • {methodLabel}</h2>
      <p className="mb-4 text-sm text-ink-400">Tip dicatat terpisah dari omzet dan muncul di laporan shift.</p>

      <label className="mb-3 block">
        <span className="mb-1 block text-sm text-ink-300">Jumlah Tip</span>
        <input
          className="input-field"
          inputMode="numeric"
          autoFocus
          value={formatRupiah(amount)}
          onChange={(e) => setAmount(Math.max(0, parseRupiahInput(e.target.value)))}
        />
      </label>

      <div className="mb-2 grid grid-cols-4 gap-2">
        {PRESETS.map((v) => (
          <button key={v} className="btn-secondary btn-compact text-sm" onClick={() => setAmount(v)}>
            {v / 1000}rb
          </button>
        ))}
      </div>
      <div className="mb-4 grid grid-cols-4 gap-2">
        {PERCENTS.map((p) => (
          <button key={p} className="btn-secondary btn-compact text-sm" onClick={() => setAmount(Math.round((baseAmount * p) / 100 / 500) * 500)}>
            {p}%
          </button>
        ))}
        {cashChange != null && cashChange > 0 ? (
          <button className="btn-secondary btn-compact text-sm" title="Seluruh kembalian dijadikan tip" onClick={() => setAmount(cashChange)}>
            Kembalian
          </button>
        ) : (
          <span />
        )}
      </div>

      {cashChange != null && amount > cashChange && (
        <p className="mb-3 text-xs text-yellow-400">
          Tip melebihi kembalian ({formatRupiah(cashChange)}) — pastikan tamu menyerahkan tambahan {formatRupiah(amount - cashChange)} tunai.
        </p>
      )}

      <div className="flex gap-3">
        <button className="btn-ghost flex-1" onClick={onCancel}>
          Batal
        </button>
        {initial > 0 && (
          <button className="btn-secondary flex-1" onClick={() => onConfirm(0)}>
            Hapus Tip
          </button>
        )}
        <button className="btn-primary flex-[2]" onClick={() => onConfirm(amount)}>
          Simpan
        </button>
      </div>
    </Modal>
  )
}
