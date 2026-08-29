import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { findUserByPin } from '@/db/repositories/users'
import { getSettings } from '@/db/repositories/settings'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { useSessionStore } from '@/state/sessionStore'
import { PinPad } from '@/components/ui/PinPad'
import { attemptsRemaining, getLockoutRemainingMs, recordFailedAttempt, recordSuccessfulAttempt } from '@/lib/loginRateLimit'

export function LoginScreen() {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lockoutMs, setLockoutMs] = useState(() => getLockoutRemainingMs())
  const login = useSessionStore((s) => s.login)
  const settings = useLiveQuery(() => getSettings(), [])

  useEffect(() => {
    const timer = setInterval(() => setLockoutMs(getLockoutRemainingMs()), 1000)
    return () => clearInterval(timer)
  }, [])

  async function handleSubmit() {
    if (getLockoutRemainingMs() > 0) return
    setBusy(true)
    setError(null)
    try {
      const user = await findUserByPin(pin)
      if (!user) {
        recordFailedAttempt()
        const remaining = getLockoutRemainingMs()
        if (remaining > 0) {
          setLockoutMs(remaining)
          setError('Terlalu banyak percobaan gagal. Coba lagi sebentar.')
        } else {
          setError(`PIN salah. Sisa percobaan: ${attemptsRemaining()}.`)
        }
        setPin('')
        return
      }
      recordSuccessfulAttempt()
      await recordAuditLog({
        userId: user.id,
        userName: user.name,
        action: 'auth.login',
        entityType: 'user',
        entityId: user.id,
        details: `${user.name} masuk ke aplikasi`,
      })
      login(user)
    } finally {
      setBusy(false)
    }
  }

  const isLocked = lockoutMs > 0

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-ink-950 p-6">
      <div className="text-center">
        {settings?.logoDataUrl && (
          <img src={settings.logoDataUrl} alt="Logo" className="mx-auto mb-3 h-16 w-16 rounded-full object-cover" />
        )}
        <h1 className="text-2xl font-bold text-ink-50">{settings?.cafeName ?? 'Kikost Cafe POS'}</h1>
        <p className="mt-1 text-sm text-ink-400">Masukkan PIN untuk masuk</p>
      </div>

      <div className="flex h-4 w-full max-w-xs justify-center gap-3">
        {Array.from({ length: Math.max(pin.length, 4) }).map((_, i) => (
          <span
            key={i}
            className={`h-4 w-4 rounded-full border-2 ${
              i < pin.length ? 'border-brew-500 bg-brew-500' : 'border-ink-700'
            }`}
          />
        ))}
      </div>

      {error && <p className="text-sm font-medium text-red-400">{error}</p>}
      {isLocked && (
        <p className="text-sm font-medium text-red-400">Coba lagi dalam {Math.ceil(lockoutMs / 1000)} detik</p>
      )}

      <PinPad value={pin} onChange={setPin} onSubmit={() => void handleSubmit()} disabled={busy || isLocked} />
    </div>
  )
}
