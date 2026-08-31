import { useState } from 'react'
import { verifySupervisorPin } from '@/db/repositories/users'
import { PinPad } from '@/components/ui/PinPad'
import type { User } from '@/types/domain'

interface Props {
  title: string
  description?: string
  onCancel: () => void
  onApproved: (approver: User) => void
}

export function SupervisorPinModal({ title, description, onCancel, onApproved }: Props) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div className="w-full max-w-xs rounded-2xl bg-ink-900 p-6 text-center" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-lg font-bold text-ink-50">{title}</h2>
        {description && <p className="mb-3 text-sm text-ink-400">{description}</p>}
        <p className="mb-3 text-xs text-ink-500">Perlu PIN Supervisor/Administrator</p>
        {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
        <PinPad value={pin} onChange={setPin} onSubmit={() => void handleSubmit()} disabled={busy} />
        <button className="btn-ghost mt-3 text-sm" onClick={onCancel}>
          Batal
        </button>
      </div>
    </div>
  )
}
