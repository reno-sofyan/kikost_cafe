import { useState } from 'react'
import { findGiftCard, type GiftCard } from '@/db/repositories/deposits'
import { formatRupiah } from '@/lib/currency'
import { Modal } from '@/components/ui/Modal'

interface Props {
  remaining: number
  /** Nilai tiap kode yang sudah dialokasikan di layar ini (belum tersimpan). */
  alreadyUsed: Record<string, number>
  onCancel: () => void
  onConfirm: (params: { amount: number; code: string }) => void
}

/** Bayar dengan voucher hadiah: masukkan kode → cek sisa nilai → pakai sebesar tagihan atau sisa voucher. */
export function GiftCardPaymentModal({ remaining, alreadyUsed, onCancel, onConfirm }: Props) {
  const [code, setCode] = useState('')
  const [card, setCard] = useState<GiftCard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const left = card ? Math.max(0, card.balance - (alreadyUsed[card.code] ?? 0)) : 0
  const amount = Math.min(remaining, left)

  async function check() {
    setError(null)
    const found = await findGiftCard(code)
    setCard(found)
    if (!found) setError('Kode voucher hadiah tidak dikenal.')
  }

  return (
    <Modal onClose={onCancel}>
      <h2 className="mb-1 text-lg font-bold text-ink-50">Voucher Hadiah</h2>
      <p className="mb-3 text-sm text-ink-400">Masukkan kode yang tertera di voucher tamu.</p>
      <div className="mb-2 flex gap-2">
        <input
          className="input-field flex-1 font-mono uppercase tracking-wider"
          autoFocus
          aria-label="Kode voucher hadiah"
          placeholder="GC-XXXX-XXXX"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase())
            setCard(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && code.trim()) void check()
          }}
        />
        <button className="btn-secondary" disabled={!code.trim()} onClick={() => void check()}>
          Cek
        </button>
      </div>
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      {card && (
        <div className="mb-3 rounded-xl bg-ink-800 p-3 text-sm">
          <p className="font-mono font-semibold tracking-wider text-ink-50">{card.code}</p>
          <p className="text-ink-300">
            Sisa nilai {formatRupiah(left)}
            {card.recipient ? ` • untuk ${card.recipient}` : ''}
          </p>
          {left <= 0 ? (
            <p className="mt-1 font-semibold text-red-400">Voucher ini sudah habis terpakai.</p>
          ) : (
            <p className="mt-1 font-semibold text-ink-50">
              Dipakai {formatRupiah(amount)}
              {left > amount ? ` • sisa setelahnya ${formatRupiah(left - amount)}` : remaining > amount ? ` • kekurangan ${formatRupiah(remaining - amount)} dibayar dengan cara lain` : ''}
            </p>
          )}
        </div>
      )}
      <div className="flex gap-3">
        <button className="btn-ghost flex-1" onClick={onCancel}>
          Batal
        </button>
        <button className="btn-primary flex-[2]" disabled={!card || amount <= 0} onClick={() => card && onConfirm({ amount, code: card.code })}>
          Pakai Voucher
        </button>
      </div>
    </Modal>
  )
}
