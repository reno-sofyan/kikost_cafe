import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { DEPOSIT_TOPUP_METHODS, listGiftCards, sellGiftCard, type GiftCard } from '@/db/repositories/deposits'
import { formatNumber, formatRupiah, parseRupiahInput } from '@/lib/currency'
import { formatDateTime } from '@/lib/datetime'
import { Modal } from '@/components/ui/Modal'
import { useSessionStore } from '@/state/sessionStore'
import type { PaymentMethod } from '@/types/domain'

const METHOD_LABELS: Partial<Record<PaymentMethod, string>> = { cash: 'Tunai', qris: 'QRIS', transfer: 'Transfer', card: 'Kartu' }

/** Voucher hadiah (gift card): jual bernilai rupiah, ditukar dengan kodenya di kasir. */
export function GiftCardTab() {
  const user = useSessionStore((s) => s.currentUser)!
  const actor = { userId: user.id, userName: user.name }
  const cards = useLiveQuery(() => listGiftCards(), []) ?? []
  const [selling, setSelling] = useState(false)
  const [sold, setSold] = useState<GiftCard | null>(null)
  const outstanding = cards.reduce((s, c) => s + c.balance, 0)

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="mr-auto max-w-2xl text-sm text-ink-300">
          Voucher hadiah dijual bernilai rupiah lalu ditukar tamu dengan kodenya di kasir (metode bayar "Voucher Hadiah"), boleh dipakai beberapa kali sampai nilainya habis. Uang
          penjualannya dicatat sebagai titipan, baru menjadi omzet saat voucher ditukar.
        </p>
        <button className="btn-primary" onClick={() => setSelling(true)}>
          + Jual Voucher Hadiah
        </button>
      </div>
      {cards.length > 0 && (
        <p className="mb-3 text-sm text-ink-300">
          {formatNumber(cards.length)} voucher terjual • nilai belum ditukar <span className="font-semibold text-ink-50">{formatRupiah(outstanding)}</span>
        </p>
      )}
      {cards.length === 0 ? (
        <p className="card p-6 text-center text-ink-400">Belum ada voucher hadiah terjual.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-ink-800 text-left text-ink-300">
              <tr>
                <th className="px-4 py-2">Kode</th>
                <th className="px-4 py-2">Untuk</th>
                <th className="px-4 py-2">Dijual</th>
                <th className="px-4 py-2 text-right">Nilai</th>
                <th className="px-4 py-2 text-right">Sisa</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.id} className={`border-t border-ink-800 ${c.balance <= 0 ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-3 font-mono font-semibold tracking-wider text-ink-50">{c.code}</td>
                  <td className="px-4 py-3 text-ink-200">{c.recipient || '—'}</td>
                  <td className="px-4 py-3 text-ink-300">
                    {formatDateTime(c.soldAt)} • {c.soldBy}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-100">{formatRupiah(c.initialAmount)}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-ink-50">{c.balance <= 0 ? 'Habis' : formatRupiah(c.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selling && (
        <SellGiftCardModal
          onClose={() => setSelling(false)}
          onSubmit={async (amount, method, recipient) => {
            const card = await sellGiftCard({ amount, method, recipient, actor })
            setSelling(false)
            setSold(card)
          }}
        />
      )}
      {sold && (
        <Modal onClose={() => setSold(null)}>
          <h2 className="mb-1 text-lg font-bold text-ink-50">Voucher Hadiah Terjual</h2>
          <p className="mb-3 text-sm text-ink-400">Tuliskan atau kirimkan kode ini ke pembeli. Kode juga tersimpan di daftar voucher.</p>
          <p className="mb-1 rounded-xl bg-ink-800 py-4 text-center font-mono text-2xl font-bold tracking-widest text-ink-50" aria-label="Kode voucher hadiah baru">
            {sold.code}
          </p>
          <p className="mb-4 text-center text-sm text-ink-300">Nilai {formatRupiah(sold.initialAmount)}</p>
          <button className="btn-primary w-full" onClick={() => setSold(null)}>
            Selesai
          </button>
        </Modal>
      )}
    </div>
  )
}

function SellGiftCardModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (amount: number, method: PaymentMethod, recipient: string) => Promise<void> }) {
  const [amount, setAmount] = useState(0)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [recipient, setRecipient] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await onSubmit(amount, method, recipient)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menjual voucher.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-3 text-lg font-bold text-ink-50">Jual Voucher Hadiah</h2>
      <label className="mb-2 block">
        <span className="mb-1 block text-sm text-ink-300">Nilai voucher</span>
        <input className="input-field" inputMode="numeric" autoFocus aria-label="Nilai voucher hadiah" value={amount ? formatRupiah(amount) : ''} placeholder="Rp0" onChange={(e) => setAmount(parseRupiahInput(e.target.value))} />
      </label>
      <div className="mb-3 flex gap-2">
        {[50_000, 100_000, 200_000, 500_000].map((v) => (
          <button key={v} className="btn-secondary btn-compact flex-1 !px-1 text-sm" onClick={() => setAmount(v)}>
            {formatNumber(v / 1000)}rb
          </button>
        ))}
      </div>
      <span className="mb-1 block text-sm text-ink-300">Dibayar dengan</span>
      <div className="mb-3 grid grid-cols-4 gap-2">
        {DEPOSIT_TOPUP_METHODS.map((m) => (
          <button key={m} className={`btn btn-compact !px-1 text-sm ${method === m ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMethod(m)}>
            {METHOD_LABELS[m]}
          </button>
        ))}
      </div>
      <label className="mb-3 block">
        <span className="mb-1 block text-sm text-ink-300">Untuk siapa (opsional)</span>
        <input className="input-field" maxLength={60} aria-label="Penerima voucher hadiah" placeholder='mis. "Hadiah ulang tahun Rina"' value={recipient} onChange={(e) => setRecipient(e.target.value)} />
      </label>
      <p className="mb-3 text-xs text-ink-400">Kode voucher dibuat otomatis. Pembayaran tunai tercatat sebagai Kas Masuk di shift yang sedang buka.</p>
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      <div className="flex gap-3">
        <button className="btn-ghost flex-1" onClick={onClose}>
          Batal
        </button>
        <button className="btn-primary flex-[2]" disabled={busy || !(amount > 0)} onClick={() => void submit()}>
          Jual Voucher
        </button>
      </div>
    </Modal>
  )
}
