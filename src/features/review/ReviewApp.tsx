import { useEffect, useState } from 'react'

/**
 * Halaman ulasan tamu dari QR di struk: `/ulasan/<orderId>`. Publik, tanpa login,
 * tanpa Dexie/sync — data lewat `/api/ulasan/:id` (backend). Bintang 4–5 diajak
 * menulis ulasan di Google Maps bila tautannya diisi di Pengaturan.
 */

interface ReviewPage {
  business: { name: string; logoDataUrl: string | null }
  orderNumber: string
  paidAt: number | null
  review: { rating: number; comment: string } | null
  googleReviewUrl: string | null
}

const RATING_LABELS = ['', 'Sangat kurang', 'Kurang', 'Cukup', 'Bagus', 'Sangat bagus']

function formatDate(ms: number): string {
  return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric' }).format(ms)
}

export function ReviewApp({ orderId }: { orderId: string }) {
  const [page, setPage] = useState<ReviewPage | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`/api/ulasan/${encodeURIComponent(orderId)}`)
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body.error || 'Halaman ulasan tidak dapat dimuat.')
        setPage(body as ReviewPage)
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : 'Halaman ulasan tidak dapat dimuat.')
      }
    })()
  }, [orderId])

  async function submit() {
    setBusy(true)
    setSubmitError(null)
    try {
      const r = await fetch(`/api/ulasan/${encodeURIComponent(orderId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rating, comment }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error || 'Ulasan gagal dikirim. Coba lagi.')
      setPage(body as ReviewPage)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Ulasan gagal dikirim. Coba lagi.')
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <Shell><p className="mt-24 text-center text-ink-200">{loadError}</p></Shell>
  if (!page) return <Shell><p className="mt-24 text-center text-ink-400">Memuat…</p></Shell>

  return (
    <Shell>
      <header className="flex flex-col items-center pt-6 text-center">
        {page.business.logoDataUrl && <img src={page.business.logoDataUrl} alt="" className="mb-3 h-14 w-14 rounded-2xl object-cover" />}
        <h1 className="text-xl font-bold text-ink-50">{page.business.name}</h1>
        <p className="mt-1 text-sm text-ink-400">
          Struk {page.orderNumber}
          {page.paidAt ? ` • ${formatDate(page.paidAt)}` : ''}
        </p>
      </header>

      {page.review ? (
        <ThankYou review={page.review} googleReviewUrl={page.googleReviewUrl} />
      ) : (
        <section className="card mt-6 p-5">
          <h2 className="text-center text-lg font-semibold text-ink-50">Bagaimana kunjungan Anda?</h2>
          <div className="mt-4 flex justify-center gap-1" role="radiogroup" aria-label="Penilaian">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} bintang`}
                className={`h-12 w-11 text-[2.4rem] leading-none transition-colors ${n <= rating ? 'text-accent-500' : 'text-ink-700'}`}
                onClick={() => setRating(n)}
              >
                ★
              </button>
            ))}
          </div>
          <p className="mt-1 h-5 text-center text-sm text-ink-300">{RATING_LABELS[rating]}</p>

          {rating > 0 && (
            <>
              <label className="mt-4 block">
                <span className="mb-1 block text-sm text-ink-300">
                  {rating <= 3 ? 'Apa yang bisa kami perbaiki?' : 'Ceritakan pengalaman Anda'} (opsional)
                </span>
                <textarea
                  className="input-field min-h-[6rem]"
                  maxLength={300}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={rating <= 3 ? 'mis. pesanan lama datang, kopi terlalu manis…' : 'mis. kopinya enak, pelayanan ramah…'}
                />
              </label>
              {submitError && <p className="mt-2 text-sm text-red-500">{submitError}</p>}
              <button className="btn-primary mt-4 w-full" disabled={busy} onClick={() => void submit()}>
                {busy ? 'Mengirim…' : 'Kirim Ulasan'}
              </button>
            </>
          )}
        </section>
      )}

      <p className="mt-8 text-center text-xs text-ink-500">Ulasan Anda hanya dibaca oleh pengelola {page.business.name}.</p>
    </Shell>
  )
}

function ThankYou({ review, googleReviewUrl }: { review: { rating: number; comment: string }; googleReviewUrl: string | null }) {
  const happy = review.rating >= 4
  return (
    <section className="card mt-6 p-5 text-center">
      <p className="text-[2rem] leading-none text-accent-500" aria-label={`${review.rating} dari 5 bintang`}>
        {'★'.repeat(review.rating)}
        <span className="text-ink-700">{'★'.repeat(5 - review.rating)}</span>
      </p>
      <h2 className="mt-3 text-lg font-semibold text-ink-50">Terima kasih atas ulasannya!</h2>
      <p className="mt-1 text-sm text-ink-300">
        {happy ? 'Senang Anda menikmati kunjungannya.' : 'Masukan Anda akan kami tindak lanjuti.'}
      </p>
      {happy && googleReviewUrl && (
        <>
          <p className="mt-5 text-sm text-ink-300">Bantu orang lain menemukan kami dengan berbagi ulasan di Google Maps.</p>
          <a className="btn-primary mt-3 flex w-full items-center justify-center" href={googleReviewUrl} target="_blank" rel="noopener noreferrer">
            Tulis ulasan di Google Maps
          </a>
        </>
      )}
    </section>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-white text-ink-50">
      <div className="mx-auto max-w-md px-4 pb-12">{children}</div>
    </div>
  )
}
