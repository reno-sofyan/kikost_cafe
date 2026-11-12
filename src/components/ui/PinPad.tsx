import { useEffect, useRef } from 'react'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'

/** Panjang PIN akun (lihat pengaturan pengguna: 4–8 digit). */
export const PIN_MIN_LENGTH = 4
export const PIN_MAX_LENGTH = 8
/** Tahan tombol hapus selama ini untuk mengosongkan seluruh PIN. */
export const PIN_CLEAR_HOLD_MS = 500

export interface PinPadProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  /** Esc di keyboard fisik (mis. kembali ke pilihan akun). */
  onCancel?: () => void
  maxLength?: number
  /** Panjang minimum sebelum tombol kirim aktif (default 4 — PIN login). */
  minLength?: number
  submitLabel?: string
  disabled?: boolean
  /** Sedang memverifikasi: tombol kirim menampilkan loading & menolak klik ganda. */
  loading?: boolean
  /** Tangkap keyboard fisik (angka, Backspace, Enter, Esc). Matikan bila ada dua PinPad sekaligus. */
  keyboard?: boolean
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'del'] as const

/**
 * Keypad PIN untuk layar sentuh: tombol 64 px, tekan = mengecil & sedikit gelap. Slot kiri
 * bawah = "Hapus semua" (tak ada slot kosong yang tampak rusak); tahan tombol hapus juga
 * mengosongkan PIN. PIN tak pernah ditampilkan sebagai teks dan tak ditaruh di <input>
 * (di tablet, input memunculkan keyboard virtual yang menutupi keypad).
 */
export function PinPad({
  value,
  onChange,
  onSubmit,
  onCancel,
  maxLength = PIN_MAX_LENGTH,
  minLength = PIN_MIN_LENGTH,
  submitLabel = 'Masuk',
  disabled,
  loading = false,
  keyboard = true,
}: PinPadProps) {
  const inactive = disabled || loading
  const ready = value.length >= minLength
  // Nilai terbaru untuk pendengar keyboard tanpa memasang ulang tiap ketikan.
  const latest = useRef({ value, onChange, onSubmit, onCancel, inactive, ready, maxLength })
  latest.current = { value, onChange, onSubmit, onCancel, inactive, ready, maxLength }
  const holdTimer = useRef<ReturnType<typeof setTimeout>>()
  const heldClear = useRef(false)

  function pressKey(key: (typeof KEYS)[number]) {
    if (inactive) return
    if (key === 'del') return onChange(value.slice(0, -1))
    if (key === 'clear') return onChange('')
    if (value.length >= maxLength) return
    onChange(value + key)
  }

  useEffect(() => {
    if (!keyboard) return
    function onKeyDown(e: KeyboardEvent) {
      const s = latest.current
      // Abaikan saat mengetik di kolom lain (mis. alasan di dialog yang sama).
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.key === 'Escape' && s.onCancel) {
        e.preventDefault()
        return s.onCancel()
      }
      if (s.inactive) return
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault()
        if (s.value.length < s.maxLength) s.onChange(s.value + e.key)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        s.onChange(s.value.slice(0, -1))
      } else if (e.key === 'Enter' && s.ready) {
        e.preventDefault()
        s.onSubmit()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [keyboard])

  useEffect(() => () => clearTimeout(holdTimer.current), [])

  const remaining = Math.max(0, minLength - value.length)

  return (
    <div className="mx-auto grid w-full max-w-[20rem] grid-cols-3 gap-3">
      {KEYS.map((key) => {
        if (key === 'clear') {
          return (
            <button key={key} type="button" className="kione-key kione-key--util" disabled={inactive || !value} onClick={() => pressKey('clear')} aria-label="Hapus semua digit">
              <span className="text-sm font-semibold">Hapus</span>
            </button>
          )
        }
        if (key === 'del') {
          return (
            <button
              key={key}
              type="button"
              className="kione-key kione-key--util"
              disabled={inactive || !value}
              aria-label="Hapus digit terakhir (tahan untuk menghapus semua)"
              onPointerDown={() => {
                heldClear.current = false
                clearTimeout(holdTimer.current)
                holdTimer.current = setTimeout(() => {
                  heldClear.current = true
                  if (!latest.current.inactive) latest.current.onChange('')
                }, PIN_CLEAR_HOLD_MS)
              }}
              onPointerUp={() => clearTimeout(holdTimer.current)}
              onPointerLeave={() => clearTimeout(holdTimer.current)}
              onClick={() => {
                // Klik yang mengakhiri tahanan panjang tak menghapus satu digit lagi.
                if (heldClear.current) {
                  heldClear.current = false
                  return
                }
                pressKey('del')
              }}
            >
              <Icon name="backspace" size={26} />
            </button>
          )
        }
        return (
          <button key={key} type="button" className="kione-key" disabled={inactive} onClick={() => pressKey(key)}>
            {key}
          </button>
        )
      })}
      <div className="col-span-3 mt-2">
        <Button
          size="lg"
          fullWidth
          className="pin-submit"
          disabled={disabled || !ready}
          loading={loading}
          onClick={onSubmit}
        >
          {ready || loading ? submitLabel : `Masukkan ${remaining} digit lagi`}
        </Button>
      </div>
    </div>
  )
}

export interface PinDotsProps {
  length: number
  /** Jumlah dot minimum (panjang PIN terpendek); bertambah mengikuti ketikan. */
  minDots?: number
  /** PIN salah: dot merah & bergetar sebentar. */
  error?: boolean
}

/** Indikator PIN besar & kontras. Jumlah terisi diumumkan ke pembaca layar. */
export function PinDots({ length, minDots = PIN_MIN_LENGTH, error = false }: PinDotsProps) {
  const total = Math.max(length, minDots)
  return (
    <div className={`flex h-6 items-center justify-center gap-4 ${error ? 'kione-pin-dots--error' : ''}`}>
      <span className="sr-only" aria-live="polite">
        {error ? 'PIN salah' : `PIN ${length} dari minimal ${minDots} digit`}
      </span>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} aria-hidden="true" className={`kione-pin-dot ${i < length ? 'kione-pin-dot--filled' : ''}`} />
      ))}
    </div>
  )
}
