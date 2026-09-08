import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { listTables, TABLE_STATUS_LABELS } from '@/db/repositories/tables'
import { startOrder } from '@/db/repositories/orders'
import { getOpenShift } from '@/db/repositories/shifts'
import { useSessionStore } from '@/state/sessionStore'
import { usePosStore } from '@/state/posStore'
import { durationSince } from '@/lib/datetime'
import { TableDetailModal } from '@/features/tables/TableDetailModal'
import type { CafeTable, TableStatus } from '@/types/domain'

const STATUS_COLORS: Record<TableStatus, string> = {
  available: 'bg-ink-900 border-ink-600 text-ink-300 hover:border-brew-500',
  occupied: 'bg-brew-600 border-brew-600 text-cream-50 shadow-sm',
  awaiting_payment: 'bg-yellow-900 border-yellow-600 text-yellow-500',
  needs_cleaning: 'bg-red-900 border-red-300 text-red-500',
}

const STATUS_DOT: Record<TableStatus, string> = {
  available: 'bg-ink-400',
  occupied: 'bg-cream-50',
  awaiting_payment: 'bg-yellow-600',
  needs_cleaning: 'bg-red-500',
}

export function TablesScreen() {
  const navigate = useNavigate()
  const currentUser = useSessionStore((s) => s.currentUser)!
  const setActiveOrderId = usePosStore((s) => s.setActiveOrderId)
  const tables = useLiveQuery(() => listTables(), []) ?? []
  const openShift = useLiveQuery(() => getOpenShift(), [])
  const [selected, setSelected] = useState<CafeTable | null>(null)

  const areas = Array.from(new Set(tables.map((t) => t.area)))

  async function quickStart(table: CafeTable) {
    if (!openShift) {
      navigate('/shift')
      return
    }
    const order = await startOrder({
      type: 'dine_in',
      tableId: table.id,
      guestCount: 2,
      cashierId: currentUser.id,
      cashierName: currentUser.name,
      shiftId: openShift.id,
    })
    setActiveOrderId(order.id)
    navigate('/kasir')
  }

  const counts = tables.reduce(
    (acc, t) => ({ ...acc, [t.status]: (acc[t.status] ?? 0) + 1 }),
    {} as Record<TableStatus, number>,
  )

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-ink-50">Denah Meja</h1>
          <p className="mt-0.5 text-sm text-ink-300">Ketuk meja kosong untuk memulai pesanan · ketuk meja terisi untuk kelola.</p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {(['available', 'occupied', 'awaiting_payment', 'needs_cleaning'] as TableStatus[]).map((s) => (
            <span key={s} className="flex items-center gap-1.5 text-xs font-medium text-ink-300">
              <span className={`h-2 w-2 rounded-full ${STATUS_DOT[s]}`} />
              {TABLE_STATUS_LABELS[s]}
              <span className="text-ink-400">({counts[s] ?? 0})</span>
            </span>
          ))}
        </div>
      </div>

      {tables.length === 0 && (
        <div className="mt-16 text-center text-sm text-ink-300">
          Belum ada meja. Tambahkan di <span className="font-semibold text-ink-100">Pengaturan → Meja &amp; QR</span>.
        </div>
      )}

      {areas.map((area) => (
        <div key={area} className="mb-8">
          {area && <h2 className="eyebrow mb-3">{area}</h2>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
            {tables
              .filter((t) => t.area === area)
              .map((table) => (
                <button
                  key={table.id}
                  onClick={() => (table.status === 'available' ? void quickStart(table) : setSelected(table))}
                  className={`flex flex-col items-center gap-1 rounded-2xl border p-4 transition-all active:scale-[0.97] ${STATUS_COLORS[table.status]}`}
                >
                  <span className="font-display text-lg font-semibold leading-none">{table.name}</span>
                  <span className="mt-1 flex items-center gap-1 text-[0.7rem] font-medium">
                    <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[table.status]}`} />
                    {TABLE_STATUS_LABELS[table.status]}
                  </span>
                  {table.guestCount ? <span className="text-[0.7rem] opacity-90">{table.guestCount} tamu</span> : null}
                  {table.occupiedSince ? (
                    <span className="text-[0.7rem] opacity-75">{durationSince(table.occupiedSince, Date.now())}</span>
                  ) : null}
                </button>
              ))}
          </div>
        </div>
      ))}

      {selected && (
        <TableDetailModal
          table={selected}
          onClose={() => setSelected(null)}
          onOpenInCashier={(orderId) => {
            setActiveOrderId(orderId)
            navigate('/kasir')
          }}
        />
      )}
    </div>
  )
}
