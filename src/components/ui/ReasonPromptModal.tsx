import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'

interface Props {
  title: string
  description?: string
  confirmLabel?: string
  /** Alasan umum yang bisa diketuk sekali (tetap bisa diubah/ditulis sendiri). */
  presets?: string[]
  onCancel: () => void
  onConfirm: (reason: string) => void
}

export function ReasonPromptModal({ title, description, confirmLabel = 'Konfirmasi', presets, onCancel, onConfirm }: Props) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <Modal onClose={onCancel}>
        <h2 className="mb-1 text-lg font-bold text-ink-50">{title}</h2>
        {description && <p className="mb-3 text-sm text-ink-400">{description}</p>}
        {presets && presets.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                className={`btn btn-compact !px-3 text-sm ${reason === p ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => {
                  setReason(p)
                  setError(null)
                }}
              >
                {p}
              </button>
            ))}
          </div>
        )}
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
