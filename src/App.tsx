import { lazy, Suspense, useEffect, type ReactNode } from 'react'
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

// Layar inti (jalur transaksi) dimuat langsung; sisanya di-split per rute supaya
// muat awal di tablet murah ringan. Chunk dimuat saat rute pertama kali dibuka.
const OrderPaymentScreen = lazy(() => import('@/features/payments/OrderPaymentScreen').then((m) => ({ default: m.OrderPaymentScreen })))
const KitchenDisplayScreen = lazy(() => import('@/features/kitchen/KitchenDisplayScreen').then((m) => ({ default: m.KitchenDisplayScreen })))
const PrintQueueScreen = lazy(() => import('@/features/printing/PrintQueueScreen').then((m) => ({ default: m.PrintQueueScreen })))
const QrOrderInbox = lazy(() => import('@/features/qr/QrOrderInbox').then((m) => ({ default: m.QrOrderInbox })))
const HistoryScreen = lazy(() => import('@/features/history/HistoryScreen').then((m) => ({ default: m.HistoryScreen })))
const CustomersScreen = lazy(() => import('@/features/customers/CustomersScreen').then((m) => ({ default: m.CustomersScreen })))
const ExpensesScreen = lazy(() => import('@/features/expenses/ExpensesScreen').then((m) => ({ default: m.ExpensesScreen })))
const ReportsScreen = lazy(() => import('@/features/reports/ReportsScreen').then((m) => ({ default: m.ReportsScreen })))
const ProductsScreen = lazy(() => import('@/features/products/ProductsScreen').then((m) => ({ default: m.ProductsScreen })))
const InventoryScreen = lazy(() => import('@/features/inventory/InventoryScreen').then((m) => ({ default: m.InventoryScreen })))
const SettingsScreen = lazy(() => import('@/features/settings/SettingsScreen').then((m) => ({ default: m.SettingsScreen })))
const TablesScreen = lazy(() => import('@/features/tables/TablesScreen').then((m) => ({ default: m.TablesScreen })))
const ShiftScreen = lazy(() => import('@/features/shifts/ShiftScreen').then((m) => ({ default: m.ShiftScreen })))

function ScreenLoading() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-ink-400">Memuat layar…</div>
  )
}

/** Boundary + Suspense yang otomatis pulih saat pindah rute (key = segmen pertama path). */
function RouteView({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const segment = pathname.split('/')[1] || 'kasir'
  return (
    <ErrorBoundary key={segment} scope="layar ini">
      <Suspense fallback={<ScreenLoading />}>{children}</Suspense>
    </ErrorBoundary>
  )
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
    return () => {
      stopSync()
      stopEvents()
      stopPrint()
      stopPager()
    }
  }, [])

  if (settings === undefined) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-950 text-ink-300">
        Memuat aplikasi...
      </div>
    )
  }

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
      <AppShell>
        <RouteView>
          <Routes>
            <Route path="/" element={<Navigate to="/kasir" replace />} />
            <Route path="/kasir" element={<CashierScreen />} />
            <Route path="/meja" element={<TablesScreen />} />
            <Route path="/kasir/:orderId/bayar" element={<OrderPaymentScreen />} />
            <Route path="/dapur" element={<KitchenDisplayScreen />} />
            <Route path="/pesanan-qr" element={<QrOrderInbox />} />
            <Route path="/cetak" element={<PrintQueueScreen />} />
            <Route path="/riwayat" element={<HistoryScreen />} />
            <Route path="/pelanggan" element={<CustomersScreen />} />
            <Route path="/pengeluaran" element={<ExpensesScreen />} />
            <Route path="/laporan" element={<ReportsScreen />} />
            <Route path="/produk" element={<ProductsScreen />} />
            <Route path="/stok" element={<InventoryScreen />} />
            <Route path="/shift" element={<ShiftScreen />} />
            <Route path="/pengaturan/*" element={<SettingsScreen />} />
            <Route path="*" element={<Navigate to="/kasir" replace />} />
          </Routes>
        </RouteView>
      </AppShell>
    </>
  )
}
