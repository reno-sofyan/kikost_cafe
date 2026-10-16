import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'

export interface PromptDialogProps {
  title: string
  description?: string
  initialValue?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
  inputMode?: 'text' | 'numeric'
  /** Izinkan konfirmasi dengan isian kosong (mis. untuk menghapus nilai). */
  allowEmpty?: boolean
  onCancel: () => void
  onConfirm: (value: string) => void
}

/**
 * Dialog input teks satu baris — pengganti `prompt()` bawaan browser.
 * Biasanya dipakai lewat `usePromptDialog`.
 */
export function PromptDialog({ title, description, initialValue = '', placeholder, confirmLabel = 'Simpan', cancelLabel = 'Batal', inputMode, allowEmpty = false, onCancel, onConfirm }: PromptDialogProps) {
  const [value, setValue] = useState(initialValue)

  return (
    <Modal onClose={onCancel}>
      <h2 className="mb-1 text-lg font-bold text-ink-50">{title}</h2>
      {description && <p className="mb-3 text-sm text-ink-400">{description}</p>}
      <input
        className="input-field mb-4"
        value={value}
        placeholder={placeholder}
        aria-label={title}
        inputMode={inputMode}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (allowEmpty || value.trim())) onConfirm(value.trim())
        }}
      />
      <div className="flex gap-3">
        <button className="btn-ghost flex-1" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button className="btn-primary flex-[2]" disabled={!allowEmpty && !value.trim()} onClick={() => onConfirm(value.trim())}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
