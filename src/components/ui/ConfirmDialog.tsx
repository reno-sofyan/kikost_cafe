import { useEffect, useId, useRef, type KeyboardEvent } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'

export interface ConfirmDialogProps {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 'danger' dipakai untuk aksi merusak/tak bisa dibatalkan (void, refund, hapus, tutup shift). */
  tone?: 'default' | 'danger'
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Dialog konfirmasi (pola alertdialog): fokus masuk ke dialog & jatuh ke tombol Batal —
 * tombol berbahaya tak pernah jadi fokus bawaan, jadi Enter tak sengaja tak menjalankan
 * aksi merusak. Tab berputar di dalam dialog, Esc menutup (lewat Modal), dan fokus kembali
 * ke elemen pemicu setelah ditutup. Dipakai lewat `notify.confirm` atau `useConfirmDialog`.
 */
export function ConfirmDialog({ title, description, confirmLabel = 'Konfirmasi', cancelLabel = 'Batal', tone = 'default', onCancel, onConfirm }: ConfirmDialogProps) {
  const titleId = useId()
  const descId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    return () => {
      if (trigger && document.contains(trigger)) trigger.focus()
    }
  }, [])

  function trapTab(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab' || !panelRef.current) return
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'))
    if (items.length === 0) return
    const first = items[0]!
    const last = items[items.length - 1]!
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <Modal onClose={onCancel} className="w-full max-w-sm rounded-2xl bg-ink-900 p-6 text-center">
      <div ref={panelRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descId : undefined} onKeyDown={trapTab}>
        {tone === 'danger' && <Icon name="alertTriangle" size={32} className="mx-auto mb-3 text-red-600" />}
        <h2 id={titleId} className="mb-2 text-lg font-bold text-ink-50">
          {title}
        </h2>
        {description && (
          <p id={descId} className="mb-4 text-sm text-ink-200">
            {description}
          </p>
        )}
        <div className="flex gap-3">
          <Button ref={cancelRef} variant="secondary" className="flex-1" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} className="flex-[2]" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
