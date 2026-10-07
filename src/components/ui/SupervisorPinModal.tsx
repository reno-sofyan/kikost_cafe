import { useEffect, useRef, useState } from 'react'
import { verifySupervisorPin } from '@/db/repositories/users'
import { PinPad } from '@/components/ui/PinPad'
import { Modal } from '@/components/ui/Modal'
import { useSessionStore } from '@/state/sessionStore'
import { roleHasPermission } from '@/lib/permissions'
import type { Permission, User } from '@/types/domain'

interface Props {
  title: string
  description?: string
  /**
   * Izin yang dimintakan persetujuannya. Bila pengguna yang sedang login sudah
   * memilikinya (supervisor/administrator/pemilik), persetujuan langsung atas
   * namanya tanpa PIN ulang — PIN hanya diminta saat kasir butuh atasan.
   */
  permission?: Permission
  onCancel: () => void
  onApproved: (approver: User) => void
}

export function SupervisorPinModal({ title, description, permission, onCancel, onApproved }: Props) {
  const currentUser = useSessionStore((s) => s.currentUser)
  const selfApproved = !!permission && !!currentUser && roleHasPermission(currentUser.role, permission)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const approvedRef = useRef(false)

  useEffect(() => {
    if (selfApproved && currentUser && !approvedRef.current) {
      approvedRef.current = true
      onApproved(currentUser)
    }
  }, [selfApproved, currentUser, onApproved])

  if (selfApproved) return null

  async function handleSubmit() {
    setBusy(true)
    setError(null)
    try {
      const approver = await verifySupervisorPin(pin)
      if (!approver) {
        setError('PIN supervisor/administrator tidak valid')
        setPin('')
        return
      }
      onApproved(approver)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onCancel} className="w-full max-w-xs rounded-2xl bg-ink-900 p-6 text-center">
        <h2 className="mb-1 text-lg font-bold text-ink-50">{title}</h2>
        {description && <p className="mb-3 text-sm text-ink-400">{description}</p>}
        <p className="mb-3 text-xs text-ink-500">Perlu PIN Supervisor/Administrator</p>
        {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
        <PinPad value={pin} onChange={setPin} onSubmit={() => void handleSubmit()} disabled={busy} />
        <button className="btn-ghost mt-3 text-sm" onClick={onCancel}>
          Batal
        </button>
    </Modal>
  )
}
