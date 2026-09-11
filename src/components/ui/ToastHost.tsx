import { useEffect } from 'react'
import { useToastStore, type Toast } from '@/state/toastStore'
import { Icon, type IconName } from '@/components/ui/Icon'

const TONE_STYLE: Record<Toast['tone'], string> = {
  info: 'border-ink-600 bg-ink-800 text-ink-100',
  success: 'border-sage-500/30 bg-sage-600/90 text-white',
  error: 'border-red-300/40 bg-red-800/95 text-red-50',
}

const TONE_ICON: Record<Toast['tone'], IconName> = {
  info: 'bell',
  success: 'checkCircle',
  error: 'alertTriangle',
}

/**
 * Satu tempat render untuk semua notifikasi transien di aplikasi — pengganti
 * `alert()` bawaan browser & toast ad-hoc yang dulu tersebar di tiap layar.
 * Dipasang sekali di AppShell.
 */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  )
}

function ToastItem({ toast: t, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    if (t.duration <= 0) return
    const timer = setTimeout(onDismiss, t.duration)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.id, t.duration])

  return (
    <button
      onClick={onDismiss}
      className={`pointer-events-auto flex max-w-md items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium shadow-pop ${TONE_STYLE[t.tone]}`}
    >
      <Icon name={TONE_ICON[t.tone]} size={16} className="flex-none" />
      <span className="text-left">{t.message}</span>
    </button>
  )
}
