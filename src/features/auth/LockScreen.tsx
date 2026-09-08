import { useEffect, useState } from 'react'
import { findUserByPin } from '@/db/repositories/users'
import { useSessionStore } from '@/state/sessionStore'
import { PinPad } from '@/components/ui/PinPad'
import { Icon } from '@/components/ui/Icon'
import { attemptsRemaining, getLockoutRemainingMs, recordFailedAttempt, recordSuccessfulAttempt } from '@/lib/loginRateLimit'

export function LockScreen() {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lockoutMs, setLockoutMs] = useState(() => getLockoutRemainingMs())
  const currentUser = useSessionStore((s) => s.currentUser)
  const unlock = useSessionStore((s) => s.unlock)
  const login = useSessionStore((s) => s.login)
  const logout = useSessionStore((s) => s.logout)

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
      if (user.id === currentUser?.id) {
        unlock()
      } else {
        login(user)
      }
    } finally {
      setBusy(false)
    }
  }

  const isLocked = lockoutMs > 0

  return (
    <div className="flex h-full items-center justify-center bg-ink-950 p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-3xl border border-ink-700 bg-ink-900 p-8 shadow-card">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brew-600/12 text-brew-600">
            <Icon name="lock" size={24} />
          </div>
          <h1 className="text-xl font-bold text-ink-50">Layar Terkunci</h1>
          <p className="mt-1 text-sm text-ink-300">
            {currentUser ? `Masukkan PIN untuk melanjutkan sebagai ${currentUser.name}` : 'Masukkan PIN'}
          </p>
        </div>

        {error && <p className="text-center text-sm font-medium text-red-500">{error}</p>}
        {isLocked && (
          <p className="text-center text-sm font-medium text-red-500">Coba lagi dalam {Math.ceil(lockoutMs / 1000)} detik</p>
        )}

        <PinPad value={pin} onChange={setPin} onSubmit={() => void handleSubmit()} disabled={busy || isLocked} />

        <button onClick={logout} className="btn-ghost text-sm text-ink-300">
          Keluar dari akun ini
        </button>
      </div>
    </div>
  )
}
