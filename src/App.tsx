import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings } from '@/db/repositories/settings'
import { useSessionStore } from '@/state/sessionStore'
import { startSyncEngine } from '@/sync/engine'
import { startEventStream } from '@/sync/events'
import { startPrintEngine } from '@/features/printing/printEngine'
import { AppShell } from '@/app/AppShell'
import { AutoLockWatcher } from '@/app/AutoLockWatcher'
import { OnboardingWizard } from '@/features/onboarding/OnboardingWizard'
import { LoginScreen } from '@/features/auth/LoginScreen'
import { LockScreen } from '@/features/auth/LockScreen'
import { CashierScreen } from '@/features/pos/CashierScreen'
import { KitchenDisplayScreen } from '@/features/kitchen/KitchenDisplayScreen'
import { PrintQueueScreen } from '@/features/printing/PrintQueueScreen'
import { QrOrderInbox } from '@/features/qr/QrOrderInbox'
import { HistoryScreen } from '@/features/history/HistoryScreen'
import { CustomersScreen } from '@/features/customers/CustomersScreen'
import { ExpensesScreen } from '@/features/expenses/ExpensesScreen'
import { ReportsScreen } from '@/features/reports/ReportsScreen'
import { ProductsScreen } from '@/features/products/ProductsScreen'
import { InventoryScreen } from '@/features/inventory/InventoryScreen'
import { SettingsScreen } from '@/features/settings/SettingsScreen'
import { ShiftScreen } from '@/features/shifts/ShiftScreen'
import { OrderPaymentScreen } from '@/features/payments/OrderPaymentScreen'

export default function App() {
  const settings = useLiveQuery(() => getSettings(), [], undefined)
  const currentUser = useSessionStore((s) => s.currentUser)
  const isLocked = useSessionStore((s) => s.isLocked)

  useEffect(() => {
    const stopSync = startSyncEngine()
    const stopEvents = startEventStream()
    const stopPrint = startPrintEngine()
    return () => {
      stopSync()
      stopEvents()
      stopPrint()
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
        <Routes>
          <Route path="/" element={<Navigate to="/kasir" replace />} />
          <Route path="/kasir" element={<CashierScreen />} />
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
      </AppShell>
    </>
  )
}
