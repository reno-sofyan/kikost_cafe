import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { MOTION } from '@/lib/motion'
import { isTopModal, pushModal } from '@/components/ui/modalStack'

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
  /** Animasi masuk panel: `sheet` = naik dari bawah (bawaan), `pop` = pudar + membesar singkat. */
  motion?: 'sheet' | 'pop'
}

/**
 * Wrapper modal bersama — dipakai semua dialog/drawer di aplikasi supaya perilakunya
 * konsisten: latar meredup, panel naik dari bawah (drawer: masuk dari kanan), tutup
 * dengan Esc / back Android / tap di luar panel (opsional), dan turun-memudar saat
 * ditutup lewat jalur itu. Saat menutup, lapisan tak menangkap ketukan lagi, jadi kasir
 * bisa langsung menekan tombol di belakangnya.
 */
export function Modal({ onClose, children, className = 'w-full max-w-sm rounded-2xl bg-ink-900 p-6', align = 'center', closeOnBackdrop = true, motion = 'sheet' }: ModalProps) {
  const [closing, setClosing] = useState(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const closingRef = useRef(false)

  const requestClose = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)
    setTimeout(() => onCloseRef.current(), MOTION.sheetOut)
  }, [])

  useEffect(() => {
    const entry = { close: requestClose }
    const pop = pushModal(entry)
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isTopModal(entry)) requestClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      pop()
    }
  }, [requestClose])

  const alignClass =
    align === 'end' ? 'justify-end' : align === 'bottom' ? 'items-end justify-center sm:items-center' : 'items-center justify-center'
  const panelMotion = align === 'end' ? 'kione-modal__panel--side' : motion === 'pop' ? 'kione-modal__panel--pop' : 'kione-modal__panel--up'

  return (
    // `data-modal`: penanda dialog terbuka (pemindai barcode halaman di belakangnya diam).
    <div
      data-modal
      className={`kione-modal fixed inset-0 z-50 flex bg-black/50 ${alignClass} ${closing ? 'kione-modal--closing pointer-events-none' : ''}`}
      onClick={closeOnBackdrop ? requestClose : undefined}
    >
      <div className={`${panelMotion} ${className}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
