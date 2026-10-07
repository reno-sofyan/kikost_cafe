import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { generateCancelCode, getActiveCancelCode, revokeCancelCode } from '@/db/repositories/cancelCodes'
import { useSessionStore } from '@/state/sessionStore'
import { verifyPin } from '@/lib/pinHash'
import { formatDateTime } from '@/lib/datetime'
import { PinPad } from '@/components/ui/PinPad'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/state/toastStore'

/**
 * Pengaturan → Kode Pembatalan (kantin, khusus Pemilik). Pemilik membuat kode
 * sekali pakai lalu menyebutkannya ke kasir untuk SATU pembatalan. Membuat kode
 * meminta PIN Pemilik lagi, supaya tablet yang ditinggal dalam keadaan login
 * tak bisa dipakai kasir untuk membuat kode sendiri.
 */
export function CancelCodePanel() {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const active = useLiveQuery(() => getActiveCancelCode(), [])
  const [askPin, setAskPin] = useState(false)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [shownCode, setShownCode] = useState<string | null>(null)

  async function handlePinSubmit() {
    setBusy(true)
    setPinError(null)
    try {
      const me = await db.users.get(currentUser.id)
      if (!me || !(await verifyPin(pin, me.pinSalt, me.pinHash))) {
        setPinError('PIN Pemilik salah')
        setPin('')
        return
      }
      const code = await generateCancelCode(me)
      setAskPin(false)
      setPin('')
      setShownCode(code)
    } catch (e) {
      setPinError(e instanceof Error ? e.message : 'Gagal membuat kode')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <div className="card p-5">
        <h2 className="mb-1 text-lg font-bold text-ink-50">Kode Pembatalan</h2>
        <p className="mb-4 text-sm text-ink-400">
          Setiap pembatalan pesanan butuh kode dari Pemilik. Kode hanya tampil sekali saat dibuat dan langsung hangus setelah dipakai
          untuk satu pembatalan — kasir yang pernah melihatnya tak bisa memakainya lagi. Membuat kode baru membatalkan kode lama yang belum terpakai.
        </p>

        <div className="mb-4 rounded-xl bg-ink-800 px-4 py-3 text-sm">
          {active === undefined ? (
            <span className="text-ink-400">Memuat…</span>
          ) : active ? (
            <span className="text-ink-200">
              Ada 1 kode aktif, dibuat {formatDateTime(active.createdAt)} oleh {active.createdByName}. Belum terpakai.
            </span>
          ) : (
            <span className="text-ink-400">Tidak ada kode aktif — kasir belum bisa membatalkan pesanan.</span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => setAskPin(true)}>
            {active ? 'Buat Kode Baru' : 'Buat Kode'}
          </button>
          {active && (
            <button
              className="btn-ghost !text-red-400"
              onClick={() =>
                void revokeCancelCode(currentUser).then(
                  () => toast.success('Kode pembatalan dihapus.'),
                  (e) => toast.error(e instanceof Error ? e.message : 'Gagal menghapus kode'),
                )
              }
            >
              Hapus Kode Aktif
            </button>
          )}
        </div>
      </div>

      {askPin && (
        <Modal
          onClose={() => {
            setAskPin(false)
            setPin('')
            setPinError(null)
          }}
          className="w-full max-w-xs rounded-2xl bg-ink-900 p-6 text-center"
        >
          <h2 className="mb-1 text-lg font-bold text-ink-50">Konfirmasi PIN Pemilik</h2>
          <p className="mb-3 text-sm text-ink-400">Masukkan PIN Anda untuk membuat kode pembatalan.</p>
          {pinError && <p className="mb-2 text-sm text-red-400">{pinError}</p>}
          <PinPad value={pin} onChange={setPin} onSubmit={() => void handlePinSubmit()} submitLabel="Buat Kode" disabled={busy} />
        </Modal>
      )}

      {shownCode && (
        <Modal onClose={() => setShownCode(null)} className="w-full max-w-sm rounded-2xl bg-ink-900 p-6 text-center">
          <h2 className="mb-2 text-lg font-bold text-ink-50">Kode Pembatalan</h2>
          <p className="mb-4 font-mono text-5xl font-bold tracking-[0.3em] text-brand-400">{shownCode}</p>
          <p className="mb-4 text-sm text-ink-400">
            Sebutkan kode ini ke kasir untuk satu pembatalan. Kode tidak akan ditampilkan lagi setelah jendela ini ditutup.
          </p>
          <button className="btn-primary w-full" onClick={() => setShownCode(null)}>
            Tutup & Sembunyikan
          </button>
        </Modal>
      )}
    </div>
  )
}
