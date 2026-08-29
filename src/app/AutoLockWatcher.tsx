import { useEffect } from 'react'
import { useSessionStore } from '@/state/sessionStore'

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const

export function AutoLockWatcher({ autoLockMinutes }: { autoLockMinutes: number }) {
  const touchActivity = useSessionStore((s) => s.touchActivity)
  const lock = useSessionStore((s) => s.lock)
  const isLocked = useSessionStore((s) => s.isLocked)

  useEffect(() => {
    const handler = () => touchActivity()
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, handler))
    return () => ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, handler))
  }, [touchActivity])

  useEffect(() => {
    if (autoLockMinutes <= 0 || isLocked) return
    const intervalMs = 15_000
    const timer = setInterval(() => {
      const lastActivityAt = useSessionStore.getState().lastActivityAt
      if (Date.now() - lastActivityAt >= autoLockMinutes * 60_000) {
        lock()
      }
    }, intervalMs)
    return () => clearInterval(timer)
  }, [autoLockMinutes, isLocked, lock])

  return null
}
