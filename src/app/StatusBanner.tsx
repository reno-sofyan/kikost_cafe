import { useEffect, useState } from 'react'
import { Icon, type IconName } from '@/components/ui/Icon'
import type { BannerCondition, BannerTone } from '@/lib/statusBanner'


const TONE: Record<BannerTone, { box: string; icon: IconName }> = {
  warning: { box: 'border-accent-600/50 bg-accent-600/15 text-accent-700', icon: 'wifiOff' },
  error: { box: 'border-red-600/40 bg-red-600/10 text-red-700', icon: 'alertTriangle' },
  info: { box: 'border-brand-500/40 bg-brand-600/10 text-brand-700', icon: 'bell' },
}

/**
 * Banner untuk kondisi yang sedang berlangsung (offline, sinkron gagal, printer
 * bermasalah) — di bawah header, hilang sendiri saat kondisinya pulih. Hanya MEMBACA
 * status; cara sinkronisasi/pencetakan bekerja tak diubah. Kondisi paling penting dulu.
 */
export function StatusBanner({ conditions }: { conditions: BannerCondition[] }) {
  const [dismissed, setDismissed] = useState<string[]>([])
  const current = conditions.find((c) => !dismissed.includes(c.key))
  // Toast (ToastHost) turun ke bawah banner supaya tak menutupi tombol di ujung kanannya.
  useEffect(() => {
    const root = document.documentElement
    if (current) root.style.setProperty('--kione-banner-offset', '2.75rem')
    else root.style.removeProperty('--kione-banner-offset')
    return () => {
      root.style.removeProperty('--kione-banner-offset')
    }
  }, [current])
  if (!current) return null
  const t = TONE[current.tone]
  return (
    <div
      key={current.key}
      role={current.tone === 'info' ? 'status' : 'alert'}
      className={`kione-banner flex flex-none items-center gap-3 border-b px-5 py-2 text-sm font-medium ${t.box}`}
    >
      <Icon name={current.tone === 'warning' && !current.key.startsWith('offline') ? 'alertTriangle' : t.icon} size={16} className="flex-none" />
      <span className="min-w-0 flex-1">{current.message}</span>
      {current.action && (
        <button type="button" className="flex-none rounded-lg px-2 py-1 font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" onClick={current.action.onAction}>
          {current.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Abaikan pemberitahuan"
        className="flex h-8 w-8 flex-none items-center justify-center rounded-lg hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        onClick={() => setDismissed((d) => [...d, current.key])}
      >
        <Icon name="close" size={15} />
      </button>
    </div>
  )
}
