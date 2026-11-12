import { useEffect, useState } from 'react'
import { useToastStore, visibleToasts, type Toast, type ToastTone } from '@/state/toastStore'
import { Icon, type IconName } from '@/components/ui/Icon'
import { tapHaptic } from '@/native/haptics'

/** Warna + ikon per jenis — ikon membuat jenisnya tetap jelas bagi yang buta warna. */
const TONE: Record<ToastTone, { box: string; icon: IconName; iconClass: string; label: string }> = {
  success: { box: 'border-success-600/40', icon: 'checkCircle', iconClass: 'bg-success-600 text-white', label: 'Berhasil' },
  info: { box: 'border-brand-500/40', icon: 'bell', iconClass: 'bg-brand-600 text-white', label: 'Info' },
  warning: { box: 'border-accent-600/60', icon: 'alertTriangle', iconClass: 'bg-accent-600 text-ink-50', label: 'Peringatan' },
  error: { box: 'border-red-600/50', icon: 'alertTriangle', iconClass: 'bg-red-600 text-white', label: 'Error' },
}

/** Lama animasi keluar sebelum toast benar-benar dihapus. */
const EXIT_MS = 180

/**
 * Satu tempat render semua toast. Pojok kanan atas di bawah header: tak menutupi total,
 * tombol Bayar, nominal kembalian, maupun keypad (semuanya di bawah). Maks. 3 tampil,
 * sisanya antre (lihat toastStore). Dipasang sekali di root.
 */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  return (
    <div className="pointer-events-none fixed right-4 top-[calc(4.75rem+var(--kione-banner-offset,0px))] z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {visibleToasts(toasts).map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  )
}

function ToastItem({ toast: t, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [leaving, setLeaving] = useState(false)
  const style = TONE[t.tone]
  const urgent = t.tone === 'error' || t.tone === 'warning'

  const close = () => {
    if (leaving) return
    setLeaving(true)
    setTimeout(onDismiss, EXIT_MS)
  }

  // Timer baru jalan saat toast benar-benar tampil (yang antre belum dihitung).
  useEffect(() => {
    if (urgent) tapHaptic()
    if (t.duration <= 0) return
    const timer = setTimeout(close, t.duration)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sekali per toast
  }, [t.id])

  return (
    <div
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
      className={`kione-toast pointer-events-auto flex items-start gap-3 rounded-2xl border bg-ink-900 p-3 shadow-pop ${style.box} ${leaving ? 'kione-toast--leaving' : ''}`}
    >
      <span className={`flex h-7 w-7 flex-none items-center justify-center rounded-full ${style.iconClass}`} aria-hidden="true">
        <Icon name={style.icon} size={16} />
      </span>
      <button
        type="button"
        className="min-w-0 flex-1 py-1 text-left text-sm font-medium text-ink-50"
        onClick={() => {
          t.onTap?.()
          if (t.onTap) close()
        }}
        tabIndex={t.onTap ? 0 : -1}
      >
        <span className="sr-only">{style.label}: </span>
        {t.message}
      </button>
      {t.action && (
        <button
          type="button"
          className="flex-none rounded-lg px-2 py-1.5 text-sm font-semibold text-brand-400 hover:bg-brand-600/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          onClick={() => {
            t.action!.onAction()
            close()
          }}
        >
          {t.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Abaikan notifikasi"
        className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-ink-300 hover:bg-ink-800 hover:text-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        onClick={close}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  )
}
