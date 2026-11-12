import { useEffect, useRef, useState, type ReactNode } from 'react'
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
import { useSlidingIndicator } from '@/components/ui/useSlidingIndicator'
import { useConfirmDialog } from '@/components/ui/useConfirmDialog'
import { BusinessLogo } from '@/components/BusinessBrand'
import { getSettings, businessDisplayName } from '@/db/repositories/settings'
import { featuresForBusinessType } from '@/lib/businessType'
import { RETAIL_NAV_HIDDEN, RETAIL_NAV_ORDER, retailPageHeading } from '@/features/retail/retailNav'
import { ShiftReminder } from '@/features/shifts/ShiftReminder'
import { StatusBanner } from '@/app/StatusBanner'
import { SystemReminders } from '@/app/SystemReminders'
import { bannerConditions } from '@/lib/statusBanner'
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

  // Pil menu aktif bergeser mengikuti pilihan (transform saja). Diukur ulang tiap pindah
  // halaman & saat ukuran menu berubah (item muncul/hilang). Harus sebelum return di bawah.
  const navRef = useRef<HTMLElement>(null)
  const navIndicator = useSlidingIndicator(navRef, 'a[aria-current="page"]', [pathname, settings?.businessType, currentUser?.role], 'y')

  // Foto profil terbaru dari database (berubah di Pengaturan → Pengguna tanpa perlu masuk ulang).
  const userPhoto = useLiveQuery(async () => (currentUser ? ((await db.users.get(currentUser.id))?.photoDataUrl ?? null) : null), [currentUser?.id])

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
  const retail = businessFeatures.retailUi
  const navItems = visibleNavItems(resolveNavItems(settings, businessFeatures), currentUser.role)
  // Minimarket: urutan ritel, ikon barang (bukan cangkir), menu pendukung disembunyikan.
  const visibleItems = retail
    ? navItems
        .filter((i) => !RETAIL_NAV_HIDDEN.includes(i.key))
        .map((i) => (i.key === 'produk' ? { ...i, icon: 'barcode' as const } : i.key === 'promo' ? { ...i, label: 'Promo' } : i))
        .sort((a, b) => retailNavRank(a.key) - retailNavRank(b.key))
    : navItems

  const pageTitle = visibleItems.find((i) => pathname === i.to || pathname.startsWith(`${i.to}/`))?.label ?? NAV_ITEM_DEFS.find((d) => pathname.startsWith(d.to))?.label ?? ''
  const retailHeading = retail ? retailPageHeading(pathname, pageTitle, now) : null
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
    <div className={`flex h-full w-full overflow-hidden bg-ink-950 ${retail ? 'gap-1 p-3 pr-0' : ''}`}>
      {/* flex-none pada anak nav: tanpa itu, di layar pendek (mis. Galaxy Tab A8
          landscape ≈ 1280×728 CSS px) item ikut menyusut & blok nama usaha
          terpotong alih-alih nav bisa di-scroll. */}
      <nav
        ref={navRef}
        className={
          retail
            ? 'relative flex w-[6.25rem] flex-none flex-col items-stretch gap-0.5 overflow-y-auto rounded-[1.25rem] bg-brand-600 py-4 text-white shadow-card'
            : 'relative flex w-24 flex-none flex-col items-stretch gap-0.5 overflow-y-auto border-r border-ink-700 bg-ink-900 py-3'
        }
      >
        <span aria-hidden="true" className={`kione-indicator ${retail ? 'left-0 right-0 bg-white/25' : 'left-2 right-2 rounded-xl bg-brand-600 shadow-sm'}`} style={navIndicator} />
        <div className={`mb-2 flex flex-none flex-col items-center gap-1.5 px-2 pb-3 [@media(max-height:800px)]:mb-1 [@media(max-height:800px)]:pb-2 ${retail ? 'mb-4' : ''}`} title={businessName}>
          {retail ? (
            <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl bg-white">
              <BusinessLogo size="sm" />
            </span>
          ) : (
            <BusinessLogo size="sm" />
          )}
          <span className={`line-clamp-2 text-center text-[0.65rem] font-semibold leading-tight ${retail ? 'text-[0.72rem] text-white' : 'text-ink-300'}`}>
            {businessName}
          </span>
        </div>
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              retail
                ? `group relative flex flex-none flex-col items-center gap-1.5 py-3 text-[0.78rem] font-medium transition-colors [@media(max-height:800px)]:py-2 ${
                    isActive ? 'text-white' : 'text-white/90 hover:bg-white/10 hover:text-white'
                  }`
                : `group relative mx-2 flex flex-none flex-col items-center gap-1 rounded-xl py-2.5 text-[0.7rem] [@media(max-height:800px)]:py-1.5 font-medium transition-colors ${
                    isActive ? 'text-white' : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100'
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
        <header
          className={
            retail
              ? 'flex min-h-[4.75rem] flex-none items-center gap-3 px-5 pb-1 pt-3'
              : 'flex min-h-[4.25rem] flex-none items-center gap-3 border-b border-ink-700 bg-ink-900 px-5 py-2.5'
          }
        >
          {retailHeading ? (
            <div className="mr-auto min-w-0">
              <h1 className="truncate text-[1.6rem] font-bold leading-tight text-[#14306e]">{retailHeading.title}</h1>
              {retailHeading.subtitle && <p className="truncate text-sm text-ink-300">{retailHeading.subtitle}</p>}
            </div>
          ) : (
            <h1 className="mr-auto truncate text-xl font-bold text-ink-50">{pageTitle}</h1>
          )}
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
            className={`flex min-h-[2.75rem] items-center gap-2 rounded-full px-4 text-sm font-medium ${retail && syncPill.label === 'Tersinkron' ? 'border border-success-600 bg-white text-ink-200' : syncPill.tone}`}
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
              className={
                retail
                  ? 'flex min-h-[2.75rem] items-center rounded-full border border-brand-500/50 bg-brand-600/5 py-1 pl-1 pr-4 text-sm font-medium text-ink-100 hover:bg-brand-600/10'
                  : 'flex min-h-[2.75rem] items-center rounded-full border border-ink-600 bg-ink-900 py-1 pl-1 pr-3 text-sm font-medium text-ink-100 hover:bg-ink-800'
              }
              title={`${currentUser.name} • ${ROLE_LABELS[currentUser.role]}`}
            >
              {userPhoto ? (
                <img src={userPhoto} alt="" aria-hidden="true" className="h-8 w-8 flex-none rounded-full object-cover" />
              ) : (
                <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${retail ? 'bg-brand-600/15 text-brand-700' : 'bg-brand-600 text-white'}`}>
                  {currentUser.name.trim()[0]?.toUpperCase() ?? '?'}
                </span>
              )}
              <span className="ml-2 max-w-[8rem] truncate">{currentUser.name}</span>
              {retail ? <span className="mx-1.5 text-ink-300">·</span> : <span className="mx-2 h-6 w-px bg-ink-600" />}
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

        <StatusBanner
          conditions={bannerConditions({
            backendConfigured: isBackendConfigured(),
            isOnline: sync.isOnline,
            failedSync: sync.failedCount,
            printFailures: printAlerts,
            onRetrySync: () => void triggerManualSync(),
            onOpenPrintQueue: () => navigate('/cetak'),
          })}
        />

        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
        <SystemReminders pendingQr={pendingQr} />
      </div>
      {confirmDialog}
      {businessFeatures.shiftReminder && openShift && SHIFT_ROLES.includes(currentUser.role) && <ShiftReminder shift={openShift} />}
    </div>
  )
}

function retailNavRank(key: string): number {
  const i = RETAIL_NAV_ORDER.indexOf(key as (typeof RETAIL_NAV_ORDER)[number])
  // Pengaturan selalu paling bawah; menu lain di antara menu inti ritel dan Pengaturan.
  return key === 'pengaturan' ? 1000 : i >= 0 ? i : 100
}
