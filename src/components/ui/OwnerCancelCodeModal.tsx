import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CANCEL_CODE_LENGTH, getActiveCancelCode, hasActiveOwner, verifyCancelCode, type OwnerApproval } from '@/db/repositories/cancelCodes'
import { PinPad } from '@/components/ui/PinPad'
import { Modal } from '@/components/ui/Modal'
import { isBackendConfigured } from '@/sync/client'

interface Props {
  title: string
  description?: string
  onCancel: () => void
  /** Kode cocok — teruskan `approval` ke `cancelUnsentOrder`/`voidOrder`, yang menghanguskannya. */
  onApproved: (approval: OwnerApproval) => void
}

/**
 * Persetujuan pembatalan (kantin): kasir memasukkan kode sekali pakai yang
 * dibuat Pemilik di Pengaturan → Kode Pembatalan. Berbeda dengan
 * `SupervisorPinModal`, tak pernah menyetujui otomatis atas nama pengguna yang
 * sedang login — Pemilik pun harus membuat kode, supaya PIN-nya tak perlu
 * diketik di depan kasir. Kode juga bisa dibuat Pemilik dari konsol online
 * (/ops) — dicocokkan ke server, jadi tetap bisa dimasukkan walau tablet ini
 * tak punya kode lokal aktif.
 */
export function OwnerCancelCodeModal({ title, description, onCancel, onApproved }: Props) {
  const ownerExists = useLiveQuery(() => hasActiveOwner(), [])
  const activeCode = useLiveQuery(() => getActiveCancelCode(), [])
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit() {
    setBusy(true)
    setError(null)
    try {
      const res = await verifyCancelCode(code)
      if (res.ok) return onApproved(res.approval)
      setCode('')
      if (res.reason === 'locked') setError(`Terlalu banyak percobaan salah. Coba lagi dalam ${Math.ceil(res.retryInMs / 1000)} detik.`)
      else if (res.reason === 'no_code') setError('Kode sudah terpakai. Minta kode baru ke Pemilik.')
      else if (res.reason === 'owner_inactive') setError('Akun Pemilik pembuat kode sudah nonaktif. Minta Pemilik membuat kode baru.')
      else if (res.reason === 'offline')
        setError('Kode tidak cocok dengan kode di tablet, dan server tak terjangkau untuk mengecek kode online. Periksa internet lalu coba lagi.')
      else setError('Kode pembatalan salah.')
    } finally {
      setBusy(false)
    }
  }

  const loading = ownerExists === undefined || activeCode === undefined
  const blocker = loading
    ? null
    : !ownerExists
      ? 'Belum ada akun berperan Pemilik. Administrator perlu menambahkannya di Pengaturan → Pengguna.'
      : !activeCode && !isBackendConfigured()
        ? 'Belum ada kode pembatalan aktif. Minta Pemilik membuat kode di Pengaturan → Kode Pembatalan.'
        : null

  return (
    <Modal onClose={onCancel} className="w-full max-w-xs rounded-2xl bg-ink-900 p-6 text-center">
      <h2 className="mb-1 text-lg font-bold text-ink-50">{title}</h2>
      {description && <p className="mb-3 text-sm text-ink-400">{description}</p>}
      {blocker ? (
        <p className="mb-3 rounded-lg bg-yellow-900/20 p-3 text-sm text-yellow-300">{blocker}</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-ink-500">Masukkan kode pembatalan {CANCEL_CODE_LENGTH} digit dari Pemilik (sekali pakai)</p>
          <div className="mb-3 flex justify-center gap-2" aria-label={`${code.length} dari ${CANCEL_CODE_LENGTH} digit`}>
            {Array.from({ length: CANCEL_CODE_LENGTH }, (_, i) => (
              <span key={i} className={`h-3 w-3 rounded-full ${i < code.length ? 'bg-brand-500' : 'bg-ink-700'}`} />
            ))}
          </div>
          {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
          <PinPad
            value={code}
            onChange={setCode}
            onSubmit={() => void handleSubmit()}
            maxLength={CANCEL_CODE_LENGTH}
            minLength={CANCEL_CODE_LENGTH}
            submitLabel="Setujui Pembatalan"
            disabled={busy || loading}
          />
        </>
      )}
      <button className="btn-ghost mt-3 text-sm" onClick={onCancel}>
        Batal
      </button>
    </Modal>
  )
}
