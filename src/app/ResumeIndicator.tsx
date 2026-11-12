import { useEffect, useState } from 'react'
import { useSyncStore } from '@/state/syncStore'
import { RESUME_SHOW_MS, shouldShowResume } from '@/lib/bootSplash'

/**
 * Indikator kecil saat aplikasi kembali dari background — pengganti splash penuh, yang
 * hanya tampil saat cold start. Data lokal sudah ada, jadi kasir tak perlu menunggu;
 * pil ini hanya memberi tahu bahwa status online & sinkronisasi sedang diperbarui.
 */
export function ResumeIndicator() {
  const [visible, setVisible] = useState(false)
  const isOnline = useSyncStore((s) => s.isOnline)

  useEffect(() => {
    let hiddenAt: number | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const onChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
        return
      }
      if (shouldShowResume(hiddenAt, Date.now())) {
        setVisible(true)
        clearTimeout(timer)
        timer = setTimeout(() => setVisible(false), RESUME_SHOW_MS)
      }
      hiddenAt = null
    }
    document.addEventListener('visibilitychange', onChange)
    return () => {
      document.removeEventListener('visibilitychange', onChange)
      clearTimeout(timer)
    }
  }, [])

  if (!visible) return null
  return (
    <div className="pointer-events-none fixed left-1/2 top-3 z-[90] -translate-x-1/2" role="status" aria-live="polite">
      <div className="kione-resume flex items-center gap-2 rounded-full bg-ink-900 px-4 py-1.5 text-sm font-medium text-ink-200 shadow-pop">
        <span className={`h-2 w-2 rounded-full ${isOnline ? 'animate-pulse bg-brand-500 motion-reduce:animate-none' : 'bg-accent-500'}`} />
        {isOnline ? 'Memperbarui status…' : 'Offline — data lokal siap dipakai'}
      </div>
    </div>
  )
}
