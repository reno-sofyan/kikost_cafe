import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import { SplashScreen } from '@/app/SplashScreen'
import {
  bootErrorMessage,
  prefersReducedMotion,
  readBootBrand,
  remainingSplashMs,
  splashStyleFor,
  SPLASH_FADE_MS,
  SPLASH_MIN_MS,
  SPLASH_REDUCED_MIN_MS,
  SPLASH_SLOW_HINT_MS,
  SPLASH_TIMEOUT_MS,
  withBootTimeout,
} from '@/lib/bootSplash'
import { hideNativeSplash } from '@/native/splashScreen'

type Phase = 'loading' | 'error' | 'leaving' | 'done'

/**
 * Cold start aplikasi kasir: tampilkan splash sambil menyiapkan database lokal
 * (`load`), lalu render aplikasi di belakang splash dan pudarkan splash-nya.
 * Tak menunggu internet. Gagal/tak merespons → pesan + "Coba lagi", bukan animasi
 * berputar terus. Splash ini hanya ada saat aplikasi dimuat; kembali dari background
 * tak memuat ulang aplikasi, jadi tak memunculkannya lagi.
 */
export function AppBoot({ load }: { load: () => Promise<ComponentType> }) {
  const [style] = useState(() => splashStyleFor(readBootBrand()))
  const [phase, setPhase] = useState<Phase>('loading')
  const [App, setApp] = useState<ComponentType | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [slow, setSlow] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const startedAt = useRef(Date.now())

  // Splash native ditutup segera: splash in-app yang sama-sama berlogo menggantikannya.
  useEffect(() => hideNativeSplash(), [])

  useEffect(() => {
    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []
    const minMs = prefersReducedMotion() ? SPLASH_REDUCED_MIN_MS : SPLASH_MIN_MS
    timers.push(setTimeout(() => !cancelled && setSlow(true), SPLASH_SLOW_HINT_MS))
    withBootTimeout(load(), SPLASH_TIMEOUT_MS).then(
      (Loaded) => {
        if (cancelled) return
        // Fungsi komponen disimpan lewat updater supaya React tak memanggilnya sebagai updater.
        setApp(() => Loaded)
        timers.push(
          setTimeout(() => {
            if (cancelled) return
            setPhase('leaving')
            timers.push(setTimeout(() => !cancelled && setPhase('done'), SPLASH_FADE_MS))
          }, remainingSplashMs(startedAt.current, Date.now(), minMs)),
        )
      },
      (e: unknown) => {
        if (cancelled) return
        console.error('[boot] inisialisasi gagal', e)
        setError(e)
        setPhase('error')
      },
    )
    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
  }, [load, attempt])

  const retry = useCallback(() => {
    if (bootErrorMessage(error).reload) return window.location.reload()
    startedAt.current = Date.now()
    setError(null)
    setSlow(false)
    setPhase('loading')
    setAttempt((n) => n + 1)
  }, [error])

  return (
    <>
      {App && <App />}
      {phase !== 'done' && (
        <SplashScreen style={style} leaving={phase === 'leaving'} slow={slow} error={phase === 'error' ? bootErrorMessage(error) : null} onRetry={retry} />
      )}
    </>
  )
}
