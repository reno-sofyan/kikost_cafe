import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listUsers, verifyUserPin } from '@/db/repositories/users'
import { getSettings } from '@/db/repositories/settings'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { useSessionStore } from '@/state/sessionStore'
import { PinPad } from '@/components/ui/PinPad'
import { Icon } from '@/components/ui/Icon'
import { ROLE_LABELS } from '@/lib/permissions'
import { attemptsRemaining, getLockoutRemainingMs, recordFailedAttempt, recordSuccessfulAttempt } from '@/lib/loginRateLimit'
import type { User } from '@/types/domain'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
}

export function LoginScreen() {
  const users = useLiveQuery(() => listUsers(), []) ?? []
  const activeUsers = users.filter((u) => u.active)
  const settings = useLiveQuery(() => getSettings(), [])
  const [selectedUser, setSelectedUser] = useState<User | null>(null)

  const header = (
    <div className="text-center">
      {settings?.logoDataUrl ? (
        <img src={settings.logoDataUrl} alt="Logo" className="mx-auto mb-4 h-16 w-16 rounded-full object-cover" />
      ) : (
        <img src="/brand/logo-full.png" alt="Kinara Coffee" className="mx-auto mb-4 h-20 w-auto" />
      )}
      <h1 className="text-2xl font-bold text-ink-50">{settings?.cafeName ?? 'Kinara Coffee'}</h1>
    </div>
  )

  if (!selectedUser) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto bg-ink-950 p-6">
        <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-3xl border border-ink-700 bg-ink-900 p-8 shadow-card">
          {header}
          <p className="-mt-2 text-sm text-ink-300">Pilih akun untuk masuk</p>

          {activeUsers.length === 0 ? (
            <p className="text-center text-sm text-ink-400">
              Belum ada pengguna aktif. Hubungi administrator untuk mengaktifkan akun.
            </p>
          ) : (
            <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
              {activeUsers.map((u) => (
                <button
                  key={u.id}
                  onClick={() => setSelectedUser(u)}
                  className="flex w-full flex-col items-center gap-2 rounded-2xl border border-ink-700 bg-ink-800 p-4 transition-colors hover:border-brew-500 hover:bg-ink-700"
                >
                  <span className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-brew-600/15 text-lg font-bold text-brew-600">
                    {initials(u.name)}
                  </span>
                  <span className="line-clamp-2 w-full text-center text-sm font-semibold text-ink-50">{u.name}</span>
                  <span className="text-xs text-ink-400">{ROLE_LABELS[u.role]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return <PinStep user={selectedUser} onBack={() => setSelectedUser(null)} />
}

function PinStep({ user, onBack }: { user: User; onBack: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lockoutMs, setLockoutMs] = useState(() => getLockoutRemainingMs())
  const login = useSessionStore((s) => s.login)

  useEffect(() => {
    const timer = setInterval(() => setLockoutMs(getLockoutRemainingMs()), 1000)
    return () => clearInterval(timer)
  }, [])

  async function handleSubmit() {
    if (getLockoutRemainingMs() > 0) return
    setBusy(true)
    setError(null)
    try {
      const verified = await verifyUserPin(user.id, pin)
      if (!verified) {
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
        userId: verified.id,
        userName: verified.name,
        action: 'auth.login',
        entityType: 'user',
        entityId: verified.id,
        details: `${verified.name} masuk ke aplikasi`,
      })
      login(verified)
    } finally {
      setBusy(false)
    }
  }

  const isLocked = lockoutMs > 0

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-ink-950 p-6">
      <div className="relative flex w-full max-w-sm flex-col items-center gap-6 rounded-3xl border border-ink-700 bg-ink-900 p-8 shadow-card">
        <button onClick={onBack} className="btn-ghost absolute left-4 top-4 !min-h-0 !p-2" title="Pilih akun lain">
          <Icon name="arrowLeft" size={18} />
        </button>

        <div className="text-center">
          <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brew-600/15 text-lg font-bold text-brew-600">
            {initials(user.name)}
          </span>
          <h1 className="text-xl font-bold text-ink-50">{user.name}</h1>
          <p className="mt-1 text-sm text-ink-300">Masukkan PIN untuk masuk</p>
        </div>

        <div className="flex h-4 w-full max-w-xs justify-center gap-3">
          {Array.from({ length: Math.max(pin.length, 4) }).map((_, i) => (
            <span
              key={i}
              className={`h-3.5 w-3.5 rounded-full border-2 transition-colors ${
                i < pin.length ? 'border-brew-600 bg-brew-600' : 'border-ink-600'
              }`}
            />
          ))}
        </div>

        {error && <p className="text-center text-sm font-medium text-red-500">{error}</p>}
        {isLocked && (
          <p className="text-center text-sm font-medium text-red-500">Coba lagi dalam {Math.ceil(lockoutMs / 1000)} detik</p>
        )}

        <PinPad value={pin} onChange={setPin} onSubmit={() => void handleSubmit()} disabled={busy || isLocked} />
      </div>
    </div>
  )
}
