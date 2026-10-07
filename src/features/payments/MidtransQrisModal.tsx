import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { cancelMidtransCharge, createMidtransCharge, getMidtransCharge, type MidtransCharge } from '@/sync/client'
import { formatRupiah } from '@/lib/currency'
import { Modal } from '@/components/ui/Modal'

interface Props {
  orderId: string
  billId: string
  amount: number
  onCancel: () => void
  /** Midtrans mengonfirmasi lunas — `reference` = transaction_id Midtrans. */
  onPaid: (paid: { amount: number; reference: string }) => void
  /** Pakai QRIS statis (internet/Midtrans bermasalah). */
  onUseStatic: () => void
}

const POLL_MS = 2500

/**
 * QRIS dinamis Midtrans di kasir: QR khusus transaksi ini (nominal terkunci),
 * tablet mengecek status ke server tiap 2,5 detik dan menutup sendiri begitu
 * Midtrans mengonfirmasi lunas — kasir tak perlu menekan apa pun, dan tak perlu
 * foto bukti (buktinya transaksi Midtrans).
 */
export function MidtransQrisModal({ orderId, billId, amount, onCancel, onPaid, onUseStatic }: Props) {
  const [charge, setCharge] = useState<MidtransCharge | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'creating' | 'waiting' | 'expired' | 'failed' | 'closing'>('creating')
  const [now, setNow] = useState(Date.now())
  const [attempt, setAttempt] = useState(0)
  const doneRef = useRef(false)
  // Ref, bukan dependensi efek: komponen render ulang tiap detik (hitung mundur) dan
  // callback induk berubah tiap render — tanpa ini interval cek status terus direset.
  const onPaidRef = useRef(onPaid)
  onPaidRef.current = onPaid

  // Buat QR (ulang bila kedaluwarsa / gagal → tombol "Buat QR Baru").
  useEffect(() => {
    let cancelled = false
    setStatus('creating')
    setError(null)
    setCharge(null)
    setQrDataUrl(null)
    createMidtransCharge({ orderId, billId, amount })
      .then(async (c) => {
        if (cancelled) return
        setCharge(c)
        setQrDataUrl(await QRCode.toDataURL(c.qrString, { width: 560, margin: 1, errorCorrectionLevel: 'M' }))
        setStatus('waiting')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Gagal membuat QRIS')
        setStatus('failed')
      })
    return () => {
      cancelled = true
    }
  }, [orderId, billId, amount, attempt])

  // Cek status berkala.
  useEffect(() => {
    if (!charge || status !== 'waiting') return
    const handle = setInterval(() => {
      void getMidtransCharge(charge.chargeId)
        .then((s) => {
          if (doneRef.current) return
          if (s.status === 'paid' && s.reference) {
            doneRef.current = true
            onPaidRef.current({ amount: s.amount ?? charge.grossAmount, reference: s.reference })
          } else if (s.status === 'expired' || s.status === 'cancelled') {
            setStatus('expired')
          } else if (s.status === 'failed') {
            setError('Pembayaran ditolak oleh penyedia. Minta pembeli mencoba lagi.')
            setStatus('failed')
          }
        })
        .catch(() => {
          /* jaringan sesaat — coba lagi di tik berikutnya */
        })
    }, POLL_MS)
    return () => clearInterval(handle)
  }, [charge, status])

  // Hitung mundur masa berlaku QR.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  // Format Midtrans: "YYYY-MM-DD HH:mm:ss" WIB.
  const expiresAt = charge?.expiryTime ? Date.parse(charge.expiryTime.replace(' ', 'T') + '+07:00') : NaN
  const secondsLeft = Number.isFinite(expiresAt) ? Math.max(0, Math.round((expiresAt - now) / 1000)) : null

  /** Tutup: batalkan QR di Midtrans dulu — bila ternyata sudah dibayar, catat sebagai lunas. */
  async function closeWith(next: () => void) {
    if (!charge) return next()
    setStatus('closing')
    try {
      const s = await cancelMidtransCharge(charge.chargeId)
      if (s.status === 'paid' && s.reference && !doneRef.current) {
        doneRef.current = true
        onPaid({ amount: s.amount ?? charge.grossAmount, reference: s.reference })
        return
      }
    } catch {
      /* gagal membatalkan (offline) — QR kedaluwarsa sendiri; bila terlanjur dibayar, sinkronisasi melunasinya */
    }
    next()
  }

  return (
    <Modal onClose={() => void closeWith(onCancel)} className="w-full max-w-sm rounded-2xl bg-ink-900 p-6 text-center">
      <div className="mb-1 flex items-center justify-center gap-2">
        <h2 className="text-lg font-bold text-ink-50">Pembayaran QRIS</h2>
        {charge && !charge.isProduction && (
          <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-yellow-300">Sandbox</span>
        )}
      </div>
      <p className="mb-3 text-2xl font-bold text-brand-400">{formatRupiah(amount)}</p>

      {status === 'creating' && <div className="mx-auto mb-4 flex h-64 w-64 items-center justify-center rounded-xl bg-ink-800 text-sm text-ink-400">Membuat QR…</div>}

      {(status === 'waiting' || status === 'closing') && qrDataUrl && (
        <>
          <img src={qrDataUrl} alt="QRIS pembayaran" className="mx-auto mb-3 h-64 w-64 rounded-xl bg-white p-2" />
          <p className="mb-1 text-sm text-ink-200">Minta pembeli scan dengan aplikasi e-wallet / m-banking.</p>
          <p className="mb-4 text-xs text-ink-500">
            Menunggu pembayaran… lunas otomatis begitu terkonfirmasi
            {secondsLeft != null ? ` • berlaku ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}` : ''}
          </p>
        </>
      )}

      {status === 'expired' && (
        <div className="mb-4 rounded-xl bg-ink-800 p-4 text-sm text-ink-300">
          QR sudah kedaluwarsa / dibatalkan.
          <button className="btn-primary mt-3 w-full" onClick={() => setAttempt((a) => a + 1)}>
            Buat QR Baru
          </button>
        </div>
      )}

      {status === 'failed' && (
        <div className="mb-4 rounded-xl bg-red-900/30 p-4 text-sm text-red-300">
          {error ?? 'Gagal membuat QRIS.'}
          <button className="btn-secondary mt-3 w-full" onClick={() => setAttempt((a) => a + 1)}>
            Coba Lagi
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <button className="btn-ghost text-sm" disabled={status === 'closing'} onClick={() => void closeWith(onUseStatic)}>
          Internet bermasalah? Pakai QRIS statis
        </button>
        <button className="btn-ghost" disabled={status === 'closing'} onClick={() => void closeWith(onCancel)}>
          {status === 'closing' ? 'Membatalkan…' : 'Batal'}
        </button>
      </div>
    </Modal>
  )
}
