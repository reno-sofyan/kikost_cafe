import type { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useSessionStore } from '@/state/sessionStore'
import { useSyncStore } from '@/state/syncStore'
import { triggerManualSync } from '@/sync/engine'
import { getOpenShift } from '@/db/repositories/shifts'
import { roleHasPermission } from '@/lib/permissions'
import { formatRupiah } from '@/lib/currency'
import { Icon, type IconName } from '@/components/ui/Icon'

interface NavItem {
  to: string
  label: string
  icon: IconName
  permission?: Parameters<typeof roleHasPermission>[1]
  roles?: Array<'administrator' | 'supervisor' | 'kasir' | 'dapur'>
}

const NAV_ITEMS: NavItem[] = [
  { to: '/kasir', label: 'Kasir', icon: 'cart', roles: ['administrator', 'supervisor', 'kasir'] },
  { to: '/dapur', label: 'Dapur', icon: 'chef' },
  { to: '/riwayat', label: 'Riwayat', icon: 'clock', roles: ['administrator', 'supervisor', 'kasir'] },
  { to: '/pelanggan', label: 'Pelanggan', icon: 'user', roles: ['administrator', 'supervisor', 'kasir'] },
  { to: '/pengeluaran', label: 'Pengeluaran', icon: 'wallet', roles: ['administrator', 'supervisor', 'kasir'] },
  { to: '/laporan', label: 'Laporan', icon: 'chart', permission: 'reports.view' },
  { to: '/produk', label: 'Produk', icon: 'coffee', permission: 'settings.manage' },
  { to: '/stok', label: 'Stok', icon: 'box', permission: 'stock.adjust' },
  { to: '/shift', label: 'Shift', icon: 'cashDrawer', roles: ['administrator', 'supervisor', 'kasir'] },
  { to: '/pengaturan', label: 'Pengaturan', icon: 'settings', permission: 'settings.manage' },
]

export function AppShell({ children }: { children: ReactNode }) {
  const currentUser = useSessionStore((s) => s.currentUser)
  const lock = useSessionStore((s) => s.lock)
  const logout = useSessionStore((s) => s.logout)
  const navigate = useNavigate()
  const sync = useSyncStore()
  const openShift = useLiveQuery(() => getOpenShift(), [])

  if (!currentUser) return null

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.roles && !item.roles.includes(currentUser.role)) return false
    if (item.permission && !roleHasPermission(currentUser.role, item.permission)) return false
    return true
  })

  return (
    <div className="flex h-full w-full overflow-hidden bg-ink-950">
      <nav className="flex w-24 flex-none flex-col items-stretch gap-1 overflow-y-auto border-r border-ink-800 bg-ink-900 py-3">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 rounded-xl py-3 text-xs font-medium mx-2 ${
                isActive ? 'bg-brew-600 text-white' : 'text-ink-300 hover:bg-ink-800'
              }`
            }
          >
            <Icon name={item.icon} size={22} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-none items-center justify-between border-b border-ink-800 bg-ink-900 px-4 py-2">
          <div className="flex items-center gap-3">
            <button
              onClick={() => void triggerManualSync()}
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${
                sync.failedCount > 0 ? 'bg-red-900/30 text-red-400' : 'bg-ink-800 text-ink-200'
              }`}
              title="Sinkronisasi sekarang"
            >
              <Icon name={sync.isOnline ? 'wifi' : 'wifiOff'} size={16} />
              {sync.isSyncing ? 'Menyinkronkan...' : sync.failedCount > 0 ? 'Gagal Sinkron' : sync.isOnline ? 'Online' : 'Offline'}
              {sync.pendingCount > 0 && (
                <span className="rounded-full bg-brew-600 px-1.5 text-white">{sync.pendingCount}</span>
              )}
              <Icon name="refresh" size={14} className={sync.isSyncing ? 'animate-spin' : ''} />
            </button>
            {openShift ? (
              <span className="rounded-full bg-sage-600/20 px-3 py-1.5 text-xs font-medium text-sage-500">
                Shift aktif • Kas {formatRupiah(openShift.expectedCash)}
              </span>
            ) : (
              <span className="rounded-full bg-red-900/40 px-3 py-1.5 text-xs font-medium text-red-400">
                Belum ada shift
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right text-xs leading-tight">
              <div className="font-semibold text-ink-50">{currentUser.name}</div>
              <div className="text-ink-400">{currentUser.role}</div>
            </div>
            <button onClick={lock} className="btn-ghost !min-h-0 !px-3 !py-2" title="Kunci layar">
              <Icon name="lock" size={18} />
            </button>
            <button
              onClick={() => {
                logout()
                navigate('/')
              }}
              className="btn-ghost !min-h-0 !px-3 !py-2"
              title="Keluar"
            >
              <Icon name="power" size={18} />
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  )
}
