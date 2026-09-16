import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { issueQrToken, listTables, TABLE_STATUS_LABELS } from '@/db/repositories/tables'
import { startOrder } from '@/db/repositories/orders'
import { getOpenShift } from '@/db/repositories/shifts'
import { useSessionStore } from '@/state/sessionStore'
import { usePosStore } from '@/state/posStore'
import { durationSince } from '@/lib/datetime'
import { Icon } from '@/components/ui/Icon'
import { TableDetailModal } from '@/features/tables/TableDetailModal'
import { TableQrModal } from '@/features/tables/TableQrModal'
import { NewTableModal } from '@/features/tables/NewTableModal'
import { FloorPlanCanvas } from '@/features/tables/FloorPlanCanvas'
import { STATUS_COLORS, STATUS_DOT } from '@/features/tables/tableStatusStyles'
import type { CafeTable, TableStatus } from '@/types/domain'

export function TablesScreen() {
  const navigate = useNavigate()
  const currentUser = useSessionStore((s) => s.currentUser)!
  const setActiveOrderId = usePosStore((s) => s.setActiveOrderId)
  const tables = useLiveQuery(() => listTables(), []) ?? []
  const openShift = useLiveQuery(() => getOpenShift(), [])
  const [selected, setSelected] = useState<CafeTable | null>(null)
  const [qrTable, setQrTable] = useState<CafeTable | null>(null)
  const [showNewTable, setShowNewTable] = useState(false)
  const [arranging, setArranging] = useState(false)

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
          <p className="mt-0.5 text-sm text-ink-300">
            {arranging
              ? 'Geser meja untuk menyusun denah sesuai tata letak kafe. Ketuk meja untuk lihat/ubah QR.'
              : 'Ketuk meja kosong untuk memulai pesanan · ketuk meja terisi untuk kelola · ikon QR untuk cetak.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {(['available', 'occupied', 'awaiting_payment', 'needs_cleaning'] as TableStatus[]).map((s) => (
            <span key={s} className="flex items-center gap-1.5 text-xs font-medium text-ink-300">
              <span className={`h-2 w-2 rounded-full ${STATUS_DOT[s]}`} />
              {TABLE_STATUS_LABELS[s]}
              <span className="text-ink-400">({counts[s] ?? 0})</span>
            </span>
          ))}
          {tables.length > 0 && (
            <button
              className={`btn-compact !px-4 ${arranging ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setArranging((v) => !v)}
            >
              <Icon name="table" size={14} className="mr-1 inline" />
              {arranging ? 'Selesai Menyusun' : 'Susun Denah'}
            </button>
          )}
          <button className="btn-primary btn-compact !px-4" onClick={() => setShowNewTable(true)}>
            <Icon name="plus" size={14} className="mr-1 inline" />
            Tambah Meja
          </button>
        </div>
      </div>

      {tables.length === 0 && (
        <div className="mt-16 flex flex-col items-center gap-3 text-center text-sm text-ink-300">
          <p>Belum ada meja.</p>
          <button className="btn-primary" onClick={() => setShowNewTable(true)}>
            <Icon name="plus" size={14} className="mr-1.5 inline" />
            Tambah Meja Pertama
          </button>
        </div>
      )}

      {areas.map((area) => (
        <div key={area} className="mb-8">
          {area && <h2 className="eyebrow mb-3">{area}</h2>}
          {arranging ? (
            <FloorPlanCanvas tables={tables.filter((t) => t.area === area)} onTap={(t) => setQrTable(t)} />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
              {tables
                .filter((t) => t.area === area)
                .map((table) => (
                  <div key={table.id} className="relative">
                    <button
                      onClick={() => (table.status === 'available' ? void quickStart(table) : setSelected(table))}
                      className={`flex w-full flex-col items-center gap-1 rounded-2xl border px-4 pb-4 pt-7 transition-all active:scale-[0.97] ${STATUS_COLORS[table.status]}`}
                    >
                      <span className="line-clamp-1 font-display text-lg font-semibold leading-none">{table.name}</span>
                      <span className="mt-1 flex items-center gap-1 text-[0.7rem] font-medium">
                        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[table.status]}`} />
                        {TABLE_STATUS_LABELS[table.status]}
                      </span>
                      {table.guestCount ? <span className="text-[0.7rem] opacity-90">{table.guestCount} tamu</span> : null}
                      {table.occupiedSince ? (
                        <span className="text-[0.7rem] opacity-75">{durationSince(table.occupiedSince, Date.now())}</span>
                      ) : null}
                    </button>
                    <button
                      aria-label={`QR meja ${table.name}`}
                      title="Lihat / cetak QR meja"
                      onClick={() => setQrTable(table)}
                      className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-ink-950/70 text-ink-200 backdrop-blur hover:bg-ink-950 hover:text-cream-50"
                    >
                      <Icon name="barcode" size={13} />
                    </button>
                  </div>
                ))}
            </div>
          )}
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

      {qrTable && <TableQrModal table={qrTable} onClose={() => setQrTable(null)} />}

      {showNewTable && (
        <NewTableModal
          onClose={() => setShowNewTable(false)}
          onCreated={(table) => {
            setShowNewTable(false)
            void issueQrToken(table.id, { userId: currentUser.id, userName: currentUser.name }).then(() => {
              setQrTable(table)
            })
          }}
        />
      )}
    </div>
  )
}
