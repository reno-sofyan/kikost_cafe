import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useSessionStore } from '@/state/sessionStore'
import { useSyncStore } from '@/state/syncStore'
import { triggerManualSync } from '@/sync/engine'
import { getOpenShift } from '@/db/repositories/shifts'
import { roleHasPermission } from '@/lib/permissions'
import { formatRupiah } from '@/lib/currency'
import { backupIsStale, lastBackupLabel } from '@/lib/backupReminder'
import { isSystemClockBehindTrusted } from '@/lib/clockGuard'
import { isBackendConfigured } from '@/sync/deviceConfig'
import { countActivePrintFailures } from '@/db/repositories/printQueue'
import { countPendingQrOrders } from '@/db/repositories/qrOrders'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { db } from '@/db/schema'
import { Icon } from '@/components/ui/Icon'
import { useConfirmDialog } from '@/components/ui/useConfirmDialog'
import { BusinessLogo } from '@/components/BusinessBrand'
import { getSettings, businessDisplayName } from '@/db/repositories/settings'
import { featuresForBusinessType } from '@/lib/businessType'
import { ShiftReminder } from '@/features/shifts/ShiftReminder'
import { formatTime, startOfJakartaDay } from '@/lib/datetime'
import { listLateKitchenOrders } from '@/db/repositories/serviceInsights'
import { countDuePreOrders } from '@/db/repositories/preOrders'
import { NAV_ITEM_DEFS, resolveNavItems, SHIFT_ROLES, visibleNavItems } from '@/lib/navAccess'
import { ROLE_LABELS } from '@/lib/permissions'

export function AppShell({ children }: { children: ReactNode }) {
  const currentUser = useSessionStore((s) => s.currentUser)
  const lock = useSessionStore((s) => s.lock)
  const logout = useSessionStore((s) => s.logout)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const { confirm, dialog: confirmDialog } = useConfirmDialog()
  const sync = useSyncStore()
  const openShift = useLiveQuery(() => getOpenShift(), [])
  // "Shift 2" = shift ke-berapa yang dibuka hari ini di perangkat ini.
  const shiftNumber = useLiveQuery(
    async () => (openShift ? db.shifts.filter((s) => s.deviceId === openShift.deviceId && s.openedAt >= startOfJakartaDay(0) && s.openedAt <= openShift.openedAt).count() : null),
    [openShift?.id],
  )
  const printAlerts =
    useLiveQuery(async () => {
      const failed = await countActivePrintFailures()
      const retrying = await db.printJobs.where('status').equals('RETRYING').count()
      return failed + retrying
    }, []) ?? 0
  const pendingQr = useLiveQuery(() => countPendingQrOrders(), []) ?? 0
  const settings = useLiveQuery(() => getSettings(), [])
  // Lencana menu: pesanan dapur yang lewat batas & pesanan terjadwal yang perlu disiapkan.
  const proTools = featuresForBusinessType(settings?.businessType ?? 'lainnya').proTools
  const [alertTick, setAlertTick] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setAlertTick(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const lateKitchen = useLiveQuery(async () => (proTools ? (await listLateKitchenOrders(alertTick)).length : 0), [proTools, alertTick]) ?? 0
  const duePreOrders = useLiveQuery(() => (proTools ? countDuePreOrders(alertTick, startOfJakartaDay(0)) : 0), [proTools, alertTick]) ?? 0
  const navBadges: Record<string, { count: number; title: string }> = {
    '/dapur': { count: lateKitchen, title: 'pesanan melewati batas waktu dapur' },
    '/meja': { count: duePreOrders, title: 'pesanan terjadwal perlu disiapkan' },
  }
  const businessName = businessDisplayName(settings)

  // Pengingat backup (hanya relevan bila TIDAK pakai sinkronisasi server sebagai backup).
  // `now` di-refresh berkala supaya labelnya ikut menua tanpa perlu reload.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10 * 60 * 1000)
    return () => clearInterval(t)
  }, [])
  const showBackupWarning =
    !!currentUser &&
    roleHasPermission(currentUser.role, 'users.manage') &&
    !isBackendConfigured() &&
    backupIsStale(now)

  // Jam sistem tampak dimundurkan sejak terakhir aplikasi mengamati waktu yang lebih
  // maju (lihat clockGuard.ts). Re-render `now` di atas (setiap 10 menit) membuat ini
  // ikut dievaluasi ulang berkala tanpa listener terpisah. Ditujukan untuk peran yang
  // bisa menindaklanjuti (cek tanggal/waktu Android), bukan kasir yang tak bisa berbuat apa-apa.
  const showClockWarning = !!currentUser && roleHasPermission(currentUser.role, 'settings.manage') && isSystemClockBehindTrusted()

  if (!currentUser) return null

  async function handleLogout() {
    const ok = await confirm({
      title: 'Ganti akun?',
      description: `Anda akan keluar dari akun ${currentUser!.name}. Masuk kembali dengan PIN untuk melanjutkan.`,
      confirmLabel: 'Keluar',
    })
    if (!ok) return
    await recordAuditLog({
      userId: currentUser!.id,
      userName: currentUser!.name,
      action: 'auth.logout',
      entityType: 'user',
      entityId: currentUser!.id,
      details: `${currentUser!.name} keluar dari aplikasi`,
    })
    logout()
    navigate('/')
  }

  // Sebelum `settings` termuat, anggap semua fitur relevan — lebih baik sekejap
  // menampilkan item ekstra daripada nav "berkedip" hilang-lalu-muncul.
  const businessFeatures = featuresForBusinessType(settings?.businessType ?? 'lainnya')
  const visibleItems = visibleNavItems(resolveNavItems(settings, businessFeatures), currentUser.role)

  const pageTitle = visibleItems.find((i) => pathname === i.to || pathname.startsWith(`${i.to}/`))?.label ?? NAV_ITEM_DEFS.find((d) => pathname.startsWith(d.to))?.label ?? ''
  const syncPill = !isBackendConfigured()
    ? { label: 'Mode Lokal', tone: 'bg-ink-700 text-ink-200', dot: 'bg-ink-400' }
    : sync.isSyncing
      ? { label: 'Menyinkronkan…', tone: 'bg-brand-600/12 text-brand-400', dot: 'bg-brand-500 animate-pulse' }
      : sync.failedCount > 0
        ? { label: 'Gagal Sinkron', tone: 'bg-red-900 text-red-400', dot: 'bg-red-500' }
        : !sync.isOnline
          ? { label: 'Offline', tone: 'bg-accent-600/15 text-accent-700', dot: 'bg-accent-500' }
          : sync.pendingCount > 0
            ? { label: `Menunggu sinkron (${sync.pendingCount})`, tone: 'bg-brand-600/12 text-brand-400', dot: 'bg-brand-500' }
            : { label: 'Tersinkron', tone: 'bg-success-600/15 text-success-500', dot: 'bg-success-500' }

  return (
    <div className="flex h-full w-full overflow-hidden bg-ink-950">
      {/* flex-none pada anak nav: tanpa itu, di layar pendek (mis. Galaxy Tab A8
          landscape ≈ 1280×728 CSS px) item ikut menyusut & blok nama usaha
          terpotong alih-alih nav bisa di-scroll. */}
      <nav className="flex w-24 flex-none flex-col items-stretch gap-0.5 overflow-y-auto border-r border-ink-700 bg-ink-900 py-3">
        <div className="mb-2 flex flex-none flex-col items-center gap-1.5 px-2 pb-3 [@media(max-height:800px)]:mb-1 [@media(max-height:800px)]:pb-2" title={businessName}>
          <BusinessLogo size="sm" />
          <span className="line-clamp-2 text-center text-[0.65rem] font-semibold leading-tight text-ink-300">
            {businessName}
          </span>
        </div>
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `group relative mx-2 flex flex-none flex-col items-center gap-1 rounded-xl py-2.5 text-[0.7rem] [@media(max-height:800px)]:py-1.5 font-medium transition-colors ${
                isActive ? 'bg-brand-600 text-white shadow-sm' : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100'
              }`
            }
          >
            <Icon name={item.icon} size={21} />
            <span className="leading-none">{item.label}</span>
            {(navBadges[item.to]?.count ?? 0) > 0 && (
              <span
                className="absolute right-1.5 top-1 min-w-[1.1rem] rounded-full bg-red-600 px-1 text-center text-[0.65rem] font-bold leading-[1.1rem] text-white"
                title={`${navBadges[item.to].count} ${navBadges[item.to].title}`}
                aria-label={`${navBadges[item.to].count} ${navBadges[item.to].title}`}
              >
                {navBadges[item.to].count}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-[4.25rem] flex-none items-center gap-3 border-b border-ink-700 bg-ink-900 px-5 py-2.5">
          <h1 className="mr-auto truncate text-xl font-bold text-ink-50">{pageTitle}</h1>
          {showBackupWarning && (
            <button
              onClick={() => navigate('/pengaturan?tab=backup')}
              className="flex items-center gap-1.5 rounded-full bg-accent-600/20 px-3 py-1.5 text-xs font-medium text-accent-400 hover:bg-accent-600/30"
              title="Buka Pengaturan → Backup"
            >
              <Icon name="alertTriangle" size={14} />
              Backup: {lastBackupLabel(now)}
            </button>
          )}
          {showClockWarning && (
            <span
              className="flex items-center gap-1.5 rounded-full bg-red-900/30 px-3 py-1.5 text-xs font-medium text-red-400"
              title="Jam/tanggal perangkat ini tampak mundur dari waktu yang pernah tercatat — periksa Pengaturan tanggal & waktu Android. Transaksi & laporan bisa salah urutan/tanggal sampai ini diperbaiki."
            >
              <Icon name="alertTriangle" size={14} />
              Jam perangkat mundur
            </span>
          )}
          {pendingQr > 0 && (
            <button
              onClick={() => navigate('/pesanan-qr')}
              className="flex items-center gap-1.5 rounded-full border border-brand-500/30 bg-brand-600/12 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-600/20"
              title="Buka Pesanan QR"
            >
              <Icon name="bell" size={14} />
              {pendingQr} pesanan QR menunggu
            </button>
          )}
          {printAlerts > 0 && (
            <button
              onClick={() => navigate('/cetak')}
              className="flex items-center gap-1.5 rounded-full bg-red-900/30 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-900/40"
              title="Buka Antrean Cetak"
            >
              <Icon name="printer" size={14} />
              {printAlerts} cetak bermasalah
            </button>
          )}
          <button
            onClick={() => void triggerManualSync()}
            className={`flex min-h-[2.75rem] items-center gap-2 rounded-full px-4 text-sm font-medium ${syncPill.tone}`}
            title="Sinkronisasi sekarang"
          >
            <span className={`h-2.5 w-2.5 rounded-full ${syncPill.dot}`} />
            {syncPill.label}
          </button>
          <div className="relative">
            <button
              onClick={() => setShowUserMenu((v) => !v)}
              aria-haspopup="menu"
              aria-label="Menu akun"
              aria-expanded={showUserMenu}
              className="flex min-h-[2.75rem] items-center rounded-full border border-ink-600 bg-ink-900 py-1 pl-1 pr-3 text-sm font-medium text-ink-100 hover:bg-ink-800"
              title={`${currentUser.name} • ${ROLE_LABELS[currentUser.role]}`}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">{currentUser.name.trim()[0]?.toUpperCase() ?? '?'}</span>
              <span className="ml-2 max-w-[8rem] truncate">{currentUser.name}</span>
              <span className="mx-2 h-6 w-px bg-ink-600" />
              <span className={openShift ? '' : 'text-red-500'}>{openShift ? `Shift ${shiftNumber ?? ''}`.trim() : 'Belum Shift'}</span>
            </button>
            {showUserMenu && (
              <>
                <button className="fixed inset-0 z-40 cursor-default" aria-label="Tutup menu akun" onClick={() => setShowUserMenu(false)} />
                <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-ink-600 bg-ink-900 shadow-pop">
                  <div className="border-b border-ink-700 px-4 py-3 text-sm">
                    <p className="font-semibold text-ink-50">{currentUser.name}</p>
                    <p className="text-ink-300">{ROLE_LABELS[currentUser.role]}</p>
                    <p className="mt-1 text-xs text-ink-300">
                      {openShift ? `Shift aktif sejak ${formatTime(openShift.openedAt)} • Kas ${formatRupiah(openShift.expectedCash)}` : 'Belum ada shift'}
                    </p>
                  </div>
                  <button role="menuitem" className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-ink-100 hover:bg-ink-800" onClick={() => { setShowUserMenu(false); lock() }}>
                    <Icon name="lock" size={18} /> Kunci layar
                  </button>
                  <button role="menuitem" className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-ink-100 hover:bg-ink-800" onClick={() => { setShowUserMenu(false); void handleLogout() }}>
                    <Icon name="power" size={18} /> Ganti akun / keluar
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
      {confirmDialog}
      {businessFeatures.shiftReminder && openShift && SHIFT_ROLES.includes(currentUser.role) && <ShiftReminder shift={openShift} />}
    </div>
  )
}
