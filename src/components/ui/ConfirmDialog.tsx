import { Modal } from '@/components/ui/Modal'
import { Icon } from '@/components/ui/Icon'

export interface ConfirmDialogProps {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 'danger' dipakai untuk aksi merusak/tak bisa dibatalkan (hapus, arsip, dst). */
  tone?: 'default' | 'danger'
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Dialog konfirmasi bergaya aplikasi — pengganti `confirm()` bawaan browser
 * yang tampilannya lepas dari tema. Biasanya dipakai lewat `useConfirmDialog`.
 */
export function ConfirmDialog({ title, description, confirmLabel = 'Konfirmasi', cancelLabel = 'Batal', tone = 'default', onCancel, onConfirm }: ConfirmDialogProps) {
  return (
    <Modal onClose={onCancel} className="w-full max-w-sm rounded-2xl bg-ink-900 p-6 text-center">
      {tone === 'danger' && <Icon name="alertTriangle" size={32} className="mx-auto mb-3 text-red-500" />}
      <h2 className="mb-2 text-lg font-bold text-ink-50">{title}</h2>
      {description && <p className="mb-4 text-sm text-ink-400">{description}</p>}
      <div className="flex gap-3">
        <button className="btn-ghost flex-1" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button className={tone === 'danger' ? 'btn-danger flex-[2]' : 'btn-primary flex-[2]'} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
