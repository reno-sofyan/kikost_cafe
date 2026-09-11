import { useEffect, type ReactNode } from 'react'

interface ModalProps {
  onClose: () => void
  children: ReactNode
  /** Class untuk panel konten (ukuran, padding, dst). */
  className?: string
  /** 'center' = dialog di tengah layar; 'end' = drawer menempel di kanan (penuh tinggi);
   *  'bottom' = bottom-sheet di layar kecil, otomatis ke tengah di layar ≥sm. */
  align?: 'center' | 'end' | 'bottom'
  /** Set false untuk dialog yang wajib dijawab lewat tombol (tak bisa ditutup asal tap). */
  closeOnBackdrop?: boolean
}

/**
 * Wrapper modal bersama — dipakai semua dialog/drawer di aplikasi supaya
 * perilakunya konsisten: backdrop gelap, tutup dengan tombol Esc, dan tutup
 * saat tap di luar panel (opsional). Sebelumnya tiap modal menulis ulang
 * markup backdrop sendiri-sendiri tanpa dukungan Esc.
 */
export function Modal({ onClose, children, className = 'w-full max-w-sm rounded-2xl bg-ink-900 p-6', align = 'center', closeOnBackdrop = true }: ModalProps) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const alignClass =
    align === 'end' ? 'justify-end' : align === 'bottom' ? 'items-end justify-center sm:items-center' : 'items-center justify-center'

  return (
    <div className={`fixed inset-0 z-50 flex bg-black/60 ${alignClass}`} onClick={closeOnBackdrop ? onClose : undefined}>
      <div className={className} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
