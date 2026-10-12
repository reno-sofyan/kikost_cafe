import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { issueQrToken, listTables, TABLE_STATUS_LABELS } from '@/db/repositories/tables'
import { startOrder } from '@/db/repositories/orders'
import { getOpenShift } from '@/db/repositories/shifts'
import { getSettings } from '@/db/repositories/settings'
import { defaultWaiterFor } from '@/db/repositories/users'
import { featuresForBusinessType } from '@/lib/businessType'
import { useSessionStore } from '@/state/sessionStore'
import { usePosStore } from '@/state/posStore'
import { durationSince, formatTime } from '@/lib/datetime'
import { heldReservationsByTable, seatReservation } from '@/db/repositories/reservations'
import { startPreOrder } from '@/db/repositories/preOrders'
import { ReservationsPanel } from '@/features/tables/ReservationsPanel'
import { tableLongStayMinutesOf } from '@/db/repositories/serviceInsights'
import { useConfirmDialog } from '@/components/ui/useConfirmDialog'
import { toast } from '@/state/toastStore'
import { Icon } from '@/components/ui/Icon'
import { TableDetailModal } from '@/features/tables/TableDetailModal'
import { TableQrModal } from '@/features/tables/TableQrModal'
import { NewTableModal } from '@/features/tables/NewTableModal'
import { FloorPlanCanvas } from '@/features/tables/FloorPlanCanvas'
import { STATUS_COLORS, STATUS_DOT } from '@/features/tables/tableStatusStyles'
import type { CafeTable, Reservation, TableStatus } from '@/types/domain'

export function TablesScreen() {
  const navigate = useNavigate()
  const currentUser = useSessionStore((s) => s.currentUser)!
  const setActiveOrderId = usePosStore((s) => s.setActiveOrderId)
  const tables = useLiveQuery(() => listTables(), []) ?? []
  const openShift = useLiveQuery(() => getOpenShift(), [])
  const settings = useLiveQuery(() => getSettings(), [])
  const features = featuresForBusinessType(settings?.businessType ?? 'lainnya')
  const [selected, setSelected] = useState<CafeTable | null>(null)
  const [qrTable, setQrTable] = useState<CafeTable | null>(null)
  const [showNewTable, setShowNewTable] = useState(false)
  const [arranging, setArranging] = useState(false)
  const [view, setView] = useState<'floor' | 'reservations'>('floor')
  const { confirm, dialog: confirmDialog } = useConfirmDialog()
  // Penanda "Dipesan" bergantung waktu — segarkan tiap menit.
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const heldByTable =
    useLiveQuery(() => (features.reservations ? heldReservationsByTable(nowTick) : new Map<string, Reservation>()), [features.reservations, nowTick]) ??
    new Map<string, Reservation>()

  const areas = Array.from(new Set(tables.map((t) => t.area)))
  // Batas menit "tamu terlalu lama" (0 = tanpa penanda).
  const longStayMinutes = features.proTools ? tableLongStayMinutesOf(settings) : 0
  const isLongStay = (t: CafeTable) => longStayMinutes > 0 && t.occupiedSince != null && nowTick - t.occupiedSince > longStayMinutes * 60_000

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
      waiter: defaultWaiterFor(currentUser, features.waiterTracking),
      shiftId: openShift.id,
    })
    setActiveOrderId(order.id)
    navigate('/kasir')
  }

  async function seat(reservation: Reservation, tableId: string) {
    if (!openShift) {
      navigate('/shift')
      return
    }
    const order = await seatReservation(reservation.id, {
      tableId,
      cashierId: currentUser.id,
      cashierName: currentUser.name,
      waiter: defaultWaiterFor(currentUser, features.waiterTracking),
      shiftId: openShift.id,
    })
    setActiveOrderId(order.id)
    navigate('/kasir')
  }

  /** Pesanan terjadwal tiba waktunya: buka pesanan berisi menunya lalu lanjut ke kasir. */
  async function startScheduled(reservation: Reservation, tableId: string | null) {
    if (!openShift) {
      navigate('/shift')
      return
    }
    const { order, skipped } = await startPreOrder(reservation.id, {
      tableId,
      cashierId: currentUser.id,
      cashierName: currentUser.name,
      waiter: defaultWaiterFor(currentUser, features.waiterTracking),
      shiftId: openShift.id,
    })
    if (skipped.length) toast.error(`Menu ini sudah tidak dijual dan dilewati: ${skipped.join(', ')}`)
    setActiveOrderId(order.id)
    navigate('/kasir')
  }

  /** Meja kosong yang sedang ditahan reservasi: tanya dulu sebelum dipakai tamu lain. */
  async function handleAvailableTap(table: CafeTable) {
    const held = heldByTable.get(table.id)
    if (!held) return quickStart(table)
    const seatIt = await confirm({
      title: `${table.name} dipesan ${formatTime(held.reservedAt)}`,
      description: `Reservasi atas nama ${held.customerName} (${held.guestCount} tamu). Dudukkan tamu reservasi ini sekarang?`,
      confirmLabel: 'Dudukkan Reservasi',
      cancelLabel: 'Bukan, Tamu Lain',
    })
    if (seatIt) return seat(held, table.id).catch((e: unknown) => toast.error(e instanceof Error ? e.message : 'Gagal mendudukkan tamu'))
    const useAnyway = await confirm({
      title: 'Pakai meja untuk tamu lain?',
      description: `${held.customerName} dijadwalkan ${formatTime(held.reservedAt)}. Reservasinya tetap tersimpan — pindahkan ke meja lain bila perlu.`,
      confirmLabel: 'Ya, Pakai Meja',
      tone: 'danger',
    })
    if (useAnyway) await quickStart(table)
  }

  const counts = tables.reduce(
    (acc, t) => ({ ...acc, [t.status]: (acc[t.status] ?? 0) + 1 }),
    {} as Record<TableStatus, number>,
  )

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-ink-50">{view === 'floor' ? 'Denah Meja' : 'Reservasi'}</h1>
            {features.reservations && (
              <div className="flex gap-1 rounded-xl bg-ink-900 p-1">
                {(['floor', 'reservations'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium ${view === v ? 'bg-brand-600 text-white' : 'text-ink-300 hover:text-ink-50'}`}
                  >
                    {v === 'floor' ? 'Denah' : 'Reservasi'}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="mt-0.5 text-sm text-ink-300">
            {view === 'reservations'
              ? 'Catat booking meja; ketuk "Dudukkan" saat tamu datang untuk langsung membuka pesanan.'
              : arranging
              ? 'Geser meja untuk menyusun denah sesuai tata letak kafe. Ketuk meja untuk lihat/ubah QR.'
              : 'Ketuk meja kosong untuk memulai pesanan · ketuk meja terisi untuk kelola · ikon QR untuk cetak.'}
          </p>
        </div>
        <div className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 ${view === 'reservations' ? 'hidden' : ''}`}>
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

      {view === 'reservations' && <ReservationsPanel onSeat={seat} onStartPreOrder={features.proTools ? startScheduled : undefined} />}

      {view === 'floor' && tables.length === 0 && (
        <div className="mt-16 flex flex-col items-center gap-3 text-center text-sm text-ink-300">
          <p>Belum ada meja.</p>
          <button className="btn-primary" onClick={() => setShowNewTable(true)}>
            <Icon name="plus" size={14} className="mr-1.5 inline" />
            Tambah Meja Pertama
          </button>
        </div>
      )}

      {view === 'floor' && areas.map((area) => (
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
                      onClick={() => (table.status === 'available' ? void handleAvailableTap(table) : setSelected(table))}
                      className={`flex w-full flex-col items-center gap-1 rounded-2xl border px-4 pb-4 pt-7 transition-all active:scale-[0.97] ${STATUS_COLORS[table.status]}`}
                    >
                      <span className="line-clamp-1 font-display text-lg font-semibold leading-none">{table.name}</span>
                      <span className="mt-1 flex items-center gap-1 text-[0.7rem] font-medium">
                        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[table.status]}`} />
                        {TABLE_STATUS_LABELS[table.status]}
                      </span>
                      {heldByTable.get(table.id) && (
                        <span className="mt-0.5 line-clamp-1 rounded-full bg-accent-500/20 px-2 py-0.5 text-[0.65rem] font-semibold text-accent-500">
                          Dipesan {formatTime(heldByTable.get(table.id)!.reservedAt)} · {heldByTable.get(table.id)!.customerName}
                        </span>
                      )}
                      {table.guestCount ? <span className="text-[0.7rem] opacity-90">{table.guestCount} tamu</span> : null}
                      {table.occupiedSince ? (
                        isLongStay(table) ? (
                          <span className="rounded-full bg-red-600 px-2 py-0.5 text-[0.65rem] font-bold text-white" title={`Lebih dari ${longStayMinutes} menit`}>
                            Lama · {durationSince(table.occupiedSince, nowTick)}
                          </span>
                        ) : (
                          <span className="text-[0.7rem] opacity-75">{durationSince(table.occupiedSince, nowTick)}</span>
                        )
                      ) : null}
                    </button>
                    <button
                      aria-label={`QR meja ${table.name}`}
                      title="Lihat / cetak QR meja"
                      onClick={() => setQrTable(table)}
                      className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-ink-950/70 text-ink-200 backdrop-blur hover:bg-ink-950 hover:text-white"
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

      {confirmDialog}
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
