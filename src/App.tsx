import { lazy, Suspense, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings } from '@/db/repositories/settings'
import { useSessionStore } from '@/state/sessionStore'
import { startSyncEngine } from '@/sync/engine'
import { startEventStream } from '@/sync/events'
import { startPrintEngine } from '@/features/printing/printEngine'
import { startPagerEngine } from '@/features/pager/pagerEngine'
import { AppShell } from '@/app/AppShell'
import { AutoLockWatcher } from '@/app/AutoLockWatcher'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { OnboardingWizard } from '@/features/onboarding/OnboardingWizard'
import { LoginScreen } from '@/features/auth/LoginScreen'
import { LockScreen } from '@/features/auth/LockScreen'
import { CashierScreen } from '@/features/pos/CashierScreen'
import { featuresForBusinessType } from '@/lib/businessType'
import { canOpenPath, homePathFor, resolveNavItems } from '@/lib/navAccess'
import { rememberBootBrand } from '@/lib/bootSplash'
import { ResumeIndicator } from '@/app/ResumeIndicator'
import { EASING, MOTION, prefersReducedMotion, routeKeyframes, routeTransitionFor } from '@/lib/motion'
import { startBackButtonHandler } from '@/native/backButton'
import type { AppSettings, Role } from '@/types/domain'

// Layar inti (jalur transaksi) dimuat langsung; sisanya di-split per rute supaya
// muat awal di tablet murah ringan. Chunk dimuat saat rute pertama kali dibuka.
const OrderPaymentScreen = lazy(() => import('@/features/payments/OrderPaymentScreen').then((m) => ({ default: m.OrderPaymentScreen })))
const KitchenDisplayScreen = lazy(() => import('@/features/kitchen/KitchenDisplayScreen').then((m) => ({ default: m.KitchenDisplayScreen })))
const PrintQueueScreen = lazy(() => import('@/features/printing/PrintQueueScreen').then((m) => ({ default: m.PrintQueueScreen })))
const QrOrderInbox = lazy(() => import('@/features/qr/QrOrderInbox').then((m) => ({ default: m.QrOrderInbox })))
const HistoryScreen = lazy(() => import('@/features/history/HistoryScreen').then((m) => ({ default: m.HistoryScreen })))
const CustomersScreen = lazy(() => import('@/features/customers/CustomersScreen').then((m) => ({ default: m.CustomersScreen })))
const ExpensesScreen = lazy(() => import('@/features/expenses/ExpensesScreen').then((m) => ({ default: m.ExpensesScreen })))
const AttendanceScreen = lazy(() => import('@/features/attendance/AttendanceScreen').then((m) => ({ default: m.AttendanceScreen })))
const PromoScreen = lazy(() => import('@/features/promos/PromoScreen').then((m) => ({ default: m.PromoScreen })))
const KolScreen = lazy(() => import('@/features/promos/KolScreen').then((m) => ({ default: m.KolScreen })))
const MemberScreen = lazy(() => import('@/features/promos/MemberScreen').then((m) => ({ default: m.MemberScreen })))
const ReportsScreen = lazy(() => import('@/features/reports/ReportsScreen').then((m) => ({ default: m.ReportsScreen })))
const ProductsScreen = lazy(() => import('@/features/products/ProductsScreen').then((m) => ({ default: m.ProductsScreen })))
const InventoryScreen = lazy(() => import('@/features/inventory/InventoryScreen').then((m) => ({ default: m.InventoryScreen })))
const SettingsScreen = lazy(() => import('@/features/settings/SettingsScreen').then((m) => ({ default: m.SettingsScreen })))
const TablesScreen = lazy(() => import('@/features/tables/TablesScreen').then((m) => ({ default: m.TablesScreen })))
const ShiftScreen = lazy(() => import('@/features/shifts/ShiftScreen').then((m) => ({ default: m.ShiftScreen })))
// Mode Minimarket: layar ritel tersendiri (kafe & kantin tetap memakai layar di atas).
const RetailCashierScreen = lazy(() => import('@/features/retail/RetailCashierScreen').then((m) => ({ default: m.RetailCashierScreen })))
const RetailPaymentScreen = lazy(() => import('@/features/retail/RetailPaymentScreen').then((m) => ({ default: m.RetailPaymentScreen })))
const RetailStockScreen = lazy(() => import('@/features/retail/RetailStockScreen').then((m) => ({ default: m.RetailStockScreen })))
const RetailProductsScreen = lazy(() => import('@/features/retail/RetailProductsScreen').then((m) => ({ default: m.RetailProductsScreen })))
const RetailPurchasesScreen = lazy(() => import('@/features/retail/RetailPurchasesScreen').then((m) => ({ default: m.RetailPurchasesScreen })))

function ScreenLoading() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-ink-400">Memuat layar…</div>
  )
}

/**
 * Boundary + Suspense yang otomatis pulih saat pindah rute (key = segmen pertama path),
 * plus transisi masuk layar: geser maju/mundur di dalam modul, pudar antar modul (arah
 * dari riwayat, lihat `routeTransitionFor`). Dianimasikan lewat Web Animations API pada
 * pembungkus yang sama — layar tak di-mount ulang karenanya, dan input tetap aktif.
 */
function RouteView({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const segment = pathname.split('/')[1] || 'kasir'
  const ref = useRef<HTMLDivElement>(null)
  const prev = useRef<{ path: string; idx: number | null } | null>(null)
  useLayoutEffect(() => {
    const state = window.history.state as { idx?: unknown } | null
    const next = { path: pathname, idx: typeof state?.idx === 'number' ? state.idx : null }
    const from = prev.current
    prev.current = next
    const el = ref.current
    if (!from || !el || typeof el.animate !== 'function') return
    const frames = routeKeyframes(routeTransitionFor(from, next), prefersReducedMotion())
    if (frames.length) el.animate(frames, { duration: MOTION.route, easing: EASING.out })
  }, [pathname])
  return (
    <div ref={ref} className="h-full">
      <ErrorBoundary key={segment} scope="layar ini">
        <Suspense fallback={<ScreenLoading />}>{children}</Suspense>
      </ErrorBoundary>
    </div>
  )
}

/**
 * Menjaga rute sesuai Pengaturan → Fitur & Akses: menu yang dimatikan atau tak
 * diberikan ke peran ini dialihkan ke halaman awal peran tersebut.
 */
function AccessGuard({ settings, role, children }: { settings: AppSettings; role: Role; children: ReactNode }) {
  const { pathname } = useLocation()
  const items = resolveNavItems(settings, featuresForBusinessType(settings.businessType))
  const home = homePathFor(items, role)
  if (!home) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-ink-300">
        <p className="text-base font-semibold text-ink-100">Belum ada menu untuk akun ini</p>
        <p className="max-w-sm text-sm">Minta Pemilik atau Administrator membuka Pengaturan → Fitur &amp; Akses dan memberi akses ke peran Anda.</p>
      </div>
    )
  }
  if (pathname === '/' || !canOpenPath(items, role, pathname)) return <Navigate to={home} replace />
  return <>{children}</>
}

export default function App() {
  const settings = useLiveQuery(() => getSettings(), [], undefined)
  const currentUser = useSessionStore((s) => s.currentUser)
  const isLocked = useSessionStore((s) => s.isLocked)

  useEffect(() => {
    const stopSync = startSyncEngine()
    const stopEvents = startEventStream()
    const stopPrint = startPrintEngine()
    const stopPager = startPagerEngine()
    const stopBack = startBackButtonHandler()
    return () => {
      stopBack()
      stopSync()
      stopEvents()
      stopPrint()
      stopPager()
    }
  }, [])

  // Tema warna mengikuti jenis usaha (lihat `html[data-theme='retail']` di index.css).
  const retail = !!settings?.onboardingCompleted && featuresForBusinessType(settings.businessType).retailUi
  useEffect(() => {
    const root = document.documentElement
    if (retail) root.dataset.theme = 'retail'
    else delete root.dataset.theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', retail ? '#1f66c1' : '#4338ca')
  }, [retail])

  // Diingat untuk splash cold start berikutnya (gaya per jenis usaha, sebelum database terbuka).
  const bootType = settings?.onboardingCompleted ? settings.businessType : null
  const bootName = settings?.onboardingCompleted ? settings.businessName : ''
  useEffect(() => {
    if (bootType) rememberBootBrand({ businessType: bootType, businessName: bootName })
  }, [bootType, bootName])

  // Sekejap setelah splash (pengaturan sudah disiapkan AppBoot): kanvas kosong, tanpa teks berkedip.
  if (settings === undefined) return <div className="h-full bg-ink-950" />

  if (!settings.onboardingCompleted) {
    return (
      <Routes>
        <Route path="*" element={<OnboardingWizard />} />
      </Routes>
    )
  }

  if (!currentUser) {
    return (
      <Routes>
        <Route path="*" element={<LoginScreen />} />
      </Routes>
    )
  }

  if (isLocked) {
    return <LockScreen />
  }

  return (
    <>
      <AutoLockWatcher autoLockMinutes={settings.autoLockMinutes} />
      <ResumeIndicator />
      <AppShell>
        <RouteView>
          <AccessGuard settings={settings} role={currentUser.role}>
            <Routes>
              <Route path="/kasir" element={retail ? <RetailCashierScreen /> : <CashierScreen />} />
              <Route path="/meja" element={<TablesScreen />} />
              <Route path="/kasir/:orderId/bayar" element={retail ? <RetailPaymentScreen /> : <OrderPaymentScreen />} />
              <Route path="/dapur" element={<KitchenDisplayScreen />} />
              <Route path="/pesanan-qr" element={<QrOrderInbox />} />
              <Route path="/cetak" element={<PrintQueueScreen />} />
              <Route path="/riwayat" element={<HistoryScreen />} />
              <Route path="/pelanggan" element={<CustomersScreen />} />
              <Route path="/pengeluaran" element={<ExpensesScreen />} />
              <Route path="/laporan" element={<ReportsScreen />} />
              <Route path="/laporan/:scope" element={<ReportsScreen />} />
              <Route path="/promo" element={<PromoScreen />} />
              <Route path="/kol" element={<KolScreen />} />
              <Route path="/member" element={<MemberScreen />} />
              <Route path="/absensi" element={<AttendanceScreen />} />
              <Route path="/produk" element={retail ? <RetailProductsScreen /> : <ProductsScreen />} />
              <Route path="/stok" element={retail ? <RetailStockScreen /> : <InventoryScreen />} />
              <Route path="/pembelian" element={<RetailPurchasesScreen />} />
              <Route path="/shift" element={<ShiftScreen />} />
              <Route path="/pengaturan/*" element={<SettingsScreen />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AccessGuard>
        </RouteView>
      </AppShell>
    </>
  )
}
