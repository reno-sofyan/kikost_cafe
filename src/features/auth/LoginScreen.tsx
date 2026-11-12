import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listUsers, verifyUserPin } from '@/db/repositories/users'
import { lastLoginByUser, recordAuditLog } from '@/db/repositories/auditLog'
import { getSettings, businessDisplayName } from '@/db/repositories/settings'
import { useSessionStore } from '@/state/sessionStore'
import { PinDots, PinPad } from '@/components/ui/PinPad'
import { Icon } from '@/components/ui/Icon'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { BusinessLogo } from '@/components/BusinessBrand'
import { PoweredByKione } from '@/components/PoweredByKione'
import { ROLE_LABELS } from '@/lib/permissions'
import { EASING, MOTION, prefersReducedMotion, routeKeyframes } from '@/lib/motion'
import { attemptsRemaining, getLockoutRemainingMs, recordFailedAttempt, recordSuccessfulAttempt } from '@/lib/loginRateLimit'
import { lastLoginLabel } from '@/features/auth/avatarColors'
import { AccountAvatar } from '@/features/auth/AccountAvatar'
import type { User } from '@/types/domain'

/** Lama dot merah bergetar sebelum PIN yang salah dikosongkan. */
const PIN_ERROR_FLASH_MS = 450

export function LoginScreen() {
  const users = useLiveQuery(() => listUsers(), [])
  const [selectedUser, setSelectedUser] = useState<User | null>(null)

  // Pilih akun → PIN masuk dari kanan; kembali → daftar akun masuk dari kiri.
  const stepRef = useRef<HTMLDivElement>(null)
  const firstRender = useRef(true)
  useLayoutEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    const frames = routeKeyframes(selectedUser ? 'forward' : 'back', prefersReducedMotion())
    if (stepRef.current && typeof stepRef.current.animate === 'function') stepRef.current.animate(frames, { duration: MOTION.route, easing: EASING.out })
  }, [selectedUser])

  return (
    <div className="kione-auth-bg flex h-full flex-col overflow-y-auto">
      <div ref={stepRef} className="flex flex-1 flex-col items-center justify-center px-6 py-8">
        {selectedUser ? <PinStep user={selectedUser} onBack={() => setSelectedUser(null)} /> : <AccountPicker users={users} onSelect={setSelectedUser} />}
      </div>
      <footer className="flex-none pb-4">
        <PoweredByKione showVersion />
      </footer>
    </div>
  )
}

/** Identitas toko dari Pengaturan → Profil Usaha (logo, nama, alamat). */
function StoreHeader() {
  const settings = useLiveQuery(() => getSettings(), [])
  return (
    <header className="flex flex-col items-center text-center">
      <BusinessLogo size="lg" className="shadow-card" />
      <h1 className="mt-4 text-[1.75rem] font-bold leading-tight text-ink-50">{businessDisplayName(settings)}</h1>
      {settings?.address ? (
        <p className="mt-1 flex max-w-md items-center gap-1.5 text-sm text-ink-200">
          <Icon name="mapPin" size={15} className="flex-none text-brand-400" />
          <span className="line-clamp-1">{settings.address}</span>
        </p>
      ) : null}
    </header>
  )
}

export interface AccountPickerProps {
  /** `undefined` = masih memuat (kerangka), `[]` = belum ada akun. */
  users: User[] | undefined
  onSelect: (user: User) => void
}

/** Daftar akun aktif. Kartu lebar tetap & ditengahkan, jadi 1, 3, atau 6 akun tetap seimbang. */
export function AccountPicker({ users, onSelect }: AccountPickerProps) {
  const lastLogins = useLiveQuery(() => lastLoginByUser(), [])
  const active = users?.filter((u) => u.active)
  const now = Date.now()

  return (
    <div className="flex w-full max-w-4xl flex-col items-center gap-8">
      <StoreHeader />
      <section className="w-full" aria-labelledby="pilih-akun">
        <h2 id="pilih-akun" className="eyebrow mb-4 text-center">
          Pilih akun untuk masuk
        </h2>
        {active === undefined ? (
          <div className="flex flex-wrap justify-center gap-4" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex w-52 flex-col items-center gap-3 rounded-2xl border border-ink-600 bg-ink-900 p-5">
                <Skeleton className="h-16 w-16 rounded-full" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
            ))}
          </div>
        ) : active.length === 0 ? (
          <div className="card mx-auto flex max-w-md flex-col items-center gap-3 p-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-600/15 text-brand-400">
              <Icon name="user" size={24} />
            </span>
            <p className="font-semibold text-ink-50">Belum ada akun aktif di perangkat ini</p>
            <p className="text-sm text-ink-200">
              Akun kasir disimpan per perangkat. Minta Pemilik/Administrator mengaktifkan akun, atau pulihkan data perangkat ini dari backup.
            </p>
            <Button variant="secondary" size="sm" leftIcon={<Icon name="refresh" size={16} />} onClick={() => window.location.reload()}>
              Muat ulang
            </Button>
          </div>
        ) : (
          <ul className="flex flex-wrap justify-center gap-4">
            {active.map((u, i) => {
              const role = ROLE_LABELS[u.role]
              const last = lastLoginLabel(lastLogins?.get(u.id), now)
              return (
                <li key={u.id} className="w-52">
                  <button
                    type="button"
                    className="kione-account-card"
                    style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                    aria-label={`Masuk sebagai ${u.name}, ${role}`}
                    onClick={() => onSelect(u)}
                  >
                    <AccountAvatar name={u.name} photoDataUrl={u.photoDataUrl} />
                    <span className="line-clamp-2 w-full text-base font-bold leading-snug text-ink-50">{u.name}</span>
                    <span className="badge bg-brand-600/15 text-brand-400">{role}</span>
                    {last && <span className="text-xs text-ink-300">{last}</span>}
                    <span className="mt-1 flex items-center gap-1 text-sm font-semibold text-brand-400" aria-hidden="true">
                      Masuk <Icon name="chevronRight" size={16} />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

function PinStep({ user, onBack }: { user: User; onBack: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [wrongFlash, setWrongFlash] = useState(false)
  const [busy, setBusy] = useState(false)
  const [lockoutMs, setLockoutMs] = useState(() => getLockoutRemainingMs(user.id))
  const login = useSessionStore((s) => s.login)
  const flashTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    const timer = setInterval(() => setLockoutMs(getLockoutRemainingMs(user.id)), 1000)
    return () => {
      clearInterval(timer)
      clearTimeout(flashTimer.current)
    }
  }, [user.id])

  /** Dot merah bergetar sebentar, lalu PIN dikosongkan (tak disimpan lebih lama). */
  function flashWrong() {
    setWrongFlash(true)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => {
      setPin('')
      setWrongFlash(false)
    }, PIN_ERROR_FLASH_MS)
  }

  async function handleSubmit() {
    if (getLockoutRemainingMs(user.id) > 0) return
    setBusy(true)
    setError(null)
    try {
      const verified = await verifyUserPin(user.id, pin)
      if (!verified) {
        recordFailedAttempt(user.id)
        const remaining = getLockoutRemainingMs(user.id)
        if (remaining > 0) {
          setLockoutMs(remaining)
          setError('Terlalu banyak percobaan gagal. Coba lagi sebentar.')
        } else {
          setError(`PIN salah. Sisa percobaan: ${attemptsRemaining(user.id)}.`)
        }
        flashWrong()
        return
      }
      recordSuccessfulAttempt(user.id)
      await recordAuditLog({
        userId: verified.id,
        userName: verified.name,
        action: 'auth.login',
        entityType: 'user',
        entityId: verified.id,
        details: `${verified.name} masuk ke aplikasi`,
      })
      setPin('')
      login(verified)
    } finally {
      setBusy(false)
    }
  }

  const isLocked = lockoutMs > 0

  return (
    <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl border border-ink-600 bg-ink-900 shadow-card md:grid-cols-2">
      {/* Kiri: siapa yang masuk + jalan kembali yang jelas. */}
      <div className="flex flex-col items-center justify-center gap-3 bg-brand-600/[0.06] p-8 text-center md:border-r md:border-ink-600">
        <AccountAvatar name={user.name} photoDataUrl={user.photoDataUrl} size="lg" className="shadow-card" />
        <h1 className="text-2xl font-bold text-ink-50">{user.name}</h1>
        <span className="badge bg-brand-600/15 text-brand-400">{ROLE_LABELS[user.role]}</span>
        <Button variant="secondary" className="mt-4" leftIcon={<Icon name="arrowLeft" size={18} />} onClick={onBack}>
          Pilih akun lain
        </Button>
      </div>

      {/* Kanan: PIN & keypad. */}
      <div className="flex flex-col items-center gap-5 p-8">
        <p className="text-base font-semibold text-ink-100">Masukkan PIN untuk masuk</p>
        <PinDots length={pin.length} error={wrongFlash} />
        <div className="min-h-[1.25rem] text-center text-sm font-medium text-red-600" role="alert">
          {isLocked ? `Coba lagi dalam ${Math.ceil(lockoutMs / 1000)} detik` : error}
        </div>
        <PinPad value={pin} onChange={setPin} onSubmit={() => void handleSubmit()} onCancel={onBack} disabled={isLocked || wrongFlash} loading={busy} />
      </div>
    </div>
  )
}
