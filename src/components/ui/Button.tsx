import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import { Icon } from '@/components/ui/Icon'
import { MOTION } from '@/lib/motion'
import { tapHaptic } from '@/native/haptics'

/** `outline` = garis warna merek (aksi sekunder yang tetap menonjol, mis. Pesanan Terbuka). */
export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'type'> {
  variant?: ButtonVariant
  /** sm = 44 px, md = 48 px, lg = 56 px (semua ramah-sentuh). */
  size?: ButtonSize
  fullWidth?: boolean
  leftIcon?: ReactNode
  rightIcon?: ReactNode
  /** Sedang memproses: label diganti spinner, lebar tetap, klik diabaikan. */
  loading?: boolean
  /** Tampilkan centang sebentar setelah aksi selesai (tak memblokir aksi berikutnya). */
  showSuccess?: boolean
  /**
   * Bila mengembalikan Promise, tombol otomatis dalam keadaan loading sampai selesai —
   * klik ganda selama itu diabaikan walau parent tak mengatur `disabled`/`loading`.
   */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => unknown
  type?: 'button' | 'submit' | 'reset'
}

// Ditulis utuh (bukan `kbtn-${variant}`) supaya Tailwind menemukannya — kelas yang
// dirangkai dinamis terbuang dari CSS produksi.
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'kbtn-primary',
  secondary: 'kbtn-secondary',
  outline: 'kbtn-outline',
  ghost: 'kbtn-ghost',
  danger: 'kbtn-danger',
  success: 'kbtn-success',
}
const SIZE_CLASS: Record<ButtonSize, string> = { sm: 'kbtn-sm', md: 'kbtn-md', lg: 'kbtn-lg' }

const isThenable = (v: unknown): v is PromiseLike<unknown> => !!v && typeof (v as PromiseLike<unknown>).then === 'function'

/**
 * Tombol standar Kione POS. Warna dari token merek (otomatis indigo atau biru ritel
 * Minimarket), tekan = mengecil + sedikit gelap (transform/opacity saja), fokus
 * keyboard lewat :focus-visible, getar ringan di Android bila diizinkan.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    leftIcon,
    rightIcon,
    loading = false,
    showSuccess = false,
    disabled = false,
    onClick,
    onPointerDown,
    type = 'button',
    className = '',
    children,
    ...rest
  },
  ref,
) {
  const [pending, setPending] = useState(false)
  const [success, setSuccess] = useState(false)
  // Penjaga sinkron: dua ketukan sangat cepat bisa terjadi sebelum React merender ulang.
  const busyRef = useRef(false)
  const mounted = useRef(true)
  const successTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(
    () => () => {
      mounted.current = false
      clearTimeout(successTimer.current)
    },
    [],
  )

  const busy = loading || pending

  if (import.meta.env.DEV && !children && !rest['aria-label']) console.warn('[Button] tombol ikon wajib punya aria-label')

  function flashSuccess() {
    if (!showSuccess || !mounted.current) return
    setSuccess(true)
    clearTimeout(successTimer.current)
    successTimer.current = setTimeout(() => mounted.current && setSuccess(false), MOTION.success)
  }

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (disabled || loading || busyRef.current) {
      event.preventDefault()
      return
    }
    const result = onClick?.(event)
    if (!isThenable(result)) {
      flashSuccess()
      return
    }
    busyRef.current = true
    setPending(true)
    Promise.resolve(result).then(
      () => {
        busyRef.current = false
        if (!mounted.current) return
        setPending(false)
        flashSuccess()
      },
      () => {
        busyRef.current = false
        if (mounted.current) setPending(false)
      },
    )
  }

  return (
    <button
      ref={ref}
      type={type}
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      data-busy={busy || undefined}
      className={`kbtn ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
      onPointerDown={(e) => {
        if (!disabled && !busy) tapHaptic()
        onPointerDown?.(e)
      }}
      onClick={handleClick}
    >
      {/* Label tetap di DOM (tak terlihat) saat loading/berhasil, supaya lebar tombol tak berubah. */}
      <span className={`inline-flex items-center justify-center gap-2 ${busy || success ? 'invisible' : ''}`}>
        {leftIcon}
        {children}
        {rightIcon}
      </span>
      {busy && (
        <span className="kbtn__overlay">
          <span className="kbtn__spinner" aria-hidden="true" />
          <span className="kbtn__busy-text">Memproses...</span>
        </span>
      )}
      {!busy && success && (
        <span className="kbtn__overlay kbtn__success" aria-live="polite">
          <Icon name="check" size={size === 'lg' ? 22 : 18} />
          <span className="sr-only">Berhasil</span>
        </span>
      )}
    </button>
  )
})
