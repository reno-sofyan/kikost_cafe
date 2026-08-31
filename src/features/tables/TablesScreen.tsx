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
  available: 'bg-sage-600/20 border-sage-600 text-sage-500',
  occupied: 'bg-brew-600/20 border-brew-600 text-brew-400',
  awaiting_payment: 'bg-yellow-600/20 border-yellow-600 text-yellow-400',
  needs_cleaning: 'bg-red-900/20 border-red-800 text-red-400',
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

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-6 text-xl font-bold text-ink-50">Denah Meja</h1>

      {areas.map((area) => (
        <div key={area} className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">{area}</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {tables
              .filter((t) => t.area === area)
              .map((table) => (
                <button
                  key={table.id}
                  onClick={() => (table.status === 'available' ? void quickStart(table) : setSelected(table))}
                  className={`card flex flex-col items-center gap-1 border-2 p-4 ${STATUS_COLORS[table.status]}`}
                >
                  <span className="text-lg font-bold">{table.name}</span>
                  <span className="text-xs">{TABLE_STATUS_LABELS[table.status]}</span>
                  {table.guestCount && <span className="text-xs">{table.guestCount} tamu</span>}
                  {table.occupiedSince && <span className="text-xs opacity-80">{durationSince(table.occupiedSince, Date.now())}</span>}
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
