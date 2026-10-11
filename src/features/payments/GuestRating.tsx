import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getOrderFeedback, recordOrderFeedback } from '@/db/repositories/feedback'
import { toast } from '@/state/toastStore'

/** Penilaian tamu di layar "Pembayaran Berhasil": tablet diarahkan ke tamu, 1–5 bintang + komentar opsional. */
export function GuestRating({ orderId, actor }: { orderId: string; actor: { userId: string; userName: string } }) {
  const saved = useLiveQuery(async () => (await getOrderFeedback(orderId)) ?? null, [orderId])
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  if (saved === undefined) return null

  if (saved) {
    return (
      <p className="text-sm text-ink-300" aria-label={`Penilaian tamu ${saved.rating} dari 5`}>
        Penilaian tamu: <span className="text-accent-500">{'★'.repeat(saved.rating)}</span>
        <span className="text-ink-600">{'★'.repeat(5 - saved.rating)}</span> — terima kasih!
      </p>
    )
  }

  async function submit() {
    setBusy(true)
    try {
      await recordOrderFeedback({ orderId, rating, comment, actor })
      toast.success('Penilaian tersimpan. Terima kasih!')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan penilaian')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full max-w-xs rounded-2xl border border-ink-800 p-3">
      <p className="mb-1 text-sm text-ink-300">Bagaimana pengalaman Anda? (opsional)</p>
      <div className="flex justify-center gap-1" role="radiogroup" aria-label="Penilaian tamu">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} bintang`}
            className={`h-11 w-11 text-3xl leading-none ${n <= rating ? 'text-accent-500' : 'text-ink-600'}`}
            onClick={() => setRating(n)}
          >
            ★
          </button>
        ))}
      </div>
      {rating > 0 && (
        <>
          <input className="input-field mt-2" maxLength={300} placeholder="Komentar (opsional)" aria-label="Komentar tamu" value={comment} onChange={(e) => setComment(e.target.value)} />
          <button className="btn-secondary mt-2 w-full" disabled={busy} onClick={() => void submit()}>
            Kirim Penilaian
          </button>
        </>
      )}
    </div>
  )
}
