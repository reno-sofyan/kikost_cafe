import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'

interface Props {
  title: string
  description?: string
  confirmLabel?: string
  onCancel: () => void
  onConfirm: (reason: string) => void
}

export function ReasonPromptModal({ title, description, confirmLabel = 'Konfirmasi', onCancel, onConfirm }: Props) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <Modal onClose={onCancel}>
        <h2 className="mb-1 text-lg font-bold text-ink-50">{title}</h2>
        {description && <p className="mb-3 text-sm text-ink-400">{description}</p>}
        <textarea
          className="input-field mb-2"
          rows={3}
          placeholder="Tulis alasan..."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />
        {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
        <div className="flex gap-3">
          <button className="btn-ghost flex-1" onClick={onCancel}>
            Batal
          </button>
          <button
            className="btn-danger flex-[2]"
            onClick={() => {
              if (!reason.trim()) {
                setError('Alasan wajib diisi')
                return
              }
              onConfirm(reason.trim())
            }}
          >
            {confirmLabel}
          </button>
        </div>
    </Modal>
  )
}
