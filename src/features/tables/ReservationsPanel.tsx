import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  addToWaitlist,
  closeReservation,
  listReservations,
  RESERVATION_STATUS_LABELS,
} from '@/db/repositories/reservations'
import { listTables } from '@/db/repositories/tables'
import { durationSince, formatDate, formatTime, jakartaDateKey, startOfJakartaDay } from '@/lib/datetime'
import { waLink } from '@/lib/whatsapp'
import { useSessionStore } from '@/state/sessionStore'
import { useConfirmDialog } from '@/components/ui/useConfirmDialog'
import { Icon } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import { ReservationFormModal } from '@/features/tables/ReservationFormModal'
import { PreOrdersPanel } from '@/features/tables/PreOrdersPanel'
import { toast } from '@/state/toastStore'
import type { CafeTable, Reservation, ReservationStatus } from '@/types/domain'

type Filter = 'waitlist' | 'today' | 'upcoming' | 'history' | 'preorder'

const FILTER_LABELS: Record<Filter, string> = { waitlist: 'Daftar Tunggu', today: 'Reservasi Hari Ini', upcoming: 'Mendatang', history: 'Riwayat', preorder: 'Pesanan Terjadwal' }

const STATUS_BADGE: Record<ReservationStatus, string> = {
  booked: 'bg-brand-600/15 text-brand-400',
  seated: 'bg-success-600/15 text-success-500',
  cancelled: 'bg-ink-800 text-ink-400',
  no_show: 'bg-red-900/30 text-red-400',
}

const LATE_AFTER_MS = 15 * 60 * 1000
const NO_RESERVATIONS: Reservation[] = []
const NO_TABLES: CafeTable[] = []

interface Props {
  /** Dudukkan tamu: buka pesanan di meja tsb. Melempar error bila gagal (mis. meja terisi). */
  onSeat: (reservation: Reservation, tableId: string) => Promise<void>
  /** Diisi = tab "Pesanan Terjadwal" tampil. Membuka pesanan dari pesanan terjadwal (meja hanya untuk makan di tempat). */
  onStartPreOrder?: (reservation: Reservation, tableId: string | null) => Promise<void>
}

export function ReservationsPanel({ onSeat, onStartPreOrder }: Props) {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const actor = { userId: currentUser.id, userName: currentUser.name }
  const allReservations = useLiveQuery(() => listReservations(), []) ?? NO_RESERVATIONS
  // Pesanan terjadwal punya tabnya sendiri — bukan reservasi meja.
  const reservations = useMemo(() => allReservations.filter((r) => !r.preOrder), [allReservations])
  const preOrderOpenCount = allReservations.filter((r) => r.preOrder && r.status === 'booked').length
  const tables = useLiveQuery(() => listTables(), []) ?? NO_TABLES
  const [filter, setFilter] = useState<Filter>('today')
  const [editing, setEditing] = useState<Reservation | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [showWaitlist, setShowWaitlist] = useState(false)
  const [pickTableFor, setPickTableFor] = useState<Reservation | null>(null)
  const { confirm, dialog } = useConfirmDialog()
  // Penanda "terlambat" ikut bergerak tanpa harus ada perubahan data.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  const tableById = useMemo(() => new Map(tables.map((t) => [t.id, t])), [tables])
  const todayStart = startOfJakartaDay()
  const tomorrowStart = todayStart + 86_400_000

  const visible = useMemo(() => {
    if (filter === 'waitlist') return reservations.filter((r) => r.walkIn && r.status === 'booked' && r.reservedAt >= todayStart)
    if (filter === 'today') return reservations.filter((r) => !r.walkIn && r.reservedAt >= todayStart && r.reservedAt < tomorrowStart)
    if (filter === 'upcoming') return reservations.filter((r) => r.reservedAt >= tomorrowStart && r.status === 'booked')
    if (filter === 'preorder') return NO_RESERVATIONS
    return reservations.filter((r) => r.reservedAt < todayStart).reverse()
  }, [reservations, filter, todayStart, tomorrowStart])

  const todayBooked = reservations.filter((r) => !r.walkIn && r.status === 'booked' && r.reservedAt >= todayStart && r.reservedAt < tomorrowStart)
  const waitingCount = reservations.filter((r) => r.walkIn && r.status === 'booked' && r.reservedAt >= todayStart).length
  const todayGuests = todayBooked.reduce((s, r) => s + r.guestCount, 0)

  async function handleSeat(reservation: Reservation, tableId: string) {
    try {
      if (reservation.preOrder) await onStartPreOrder?.(reservation, tableId)
      else await onSeat(reservation, tableId)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mendudukkan tamu')
    }
  }

  function startSeat(reservation: Reservation) {
    const table = reservation.tableId ? tableById.get(reservation.tableId) : undefined
    if (table && table.status === 'available') void handleSeat(reservation, table.id)
    else setPickTableFor(reservation)
  }

  async function handleClose(reservation: Reservation, status: 'cancelled' | 'no_show') {
    const ok = await confirm({
      title: status === 'cancelled' ? 'Batalkan Reservasi?' : 'Tandai Tidak Datang?',
      description: `${reservation.customerName} • ${formatDate(reservation.reservedAt)} ${formatTime(reservation.reservedAt)} • ${reservation.guestCount} tamu`,
      confirmLabel: status === 'cancelled' ? 'Ya, Batalkan' : 'Tandai Tidak Datang',
      tone: 'danger',
    })
    if (ok) await closeReservation(reservation.id, status, actor)
  }

  let lastDay = ''

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(Object.keys(FILTER_LABELS) as Filter[])
          .filter((f) => f !== 'preorder' || !!onStartPreOrder)
          .map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`btn btn-compact !px-4 text-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`}>
              {FILTER_LABELS[f]}
              {f === 'waitlist' && waitingCount > 0 ? ` (${waitingCount})` : ''}
              {f === 'preorder' && preOrderOpenCount > 0 ? ` (${preOrderOpenCount})` : ''}
            </button>
          ))}
        <span className="ml-2 text-sm text-ink-400">
          Hari ini: {todayBooked.length} reservasi menunggu · {todayGuests} tamu
        </span>
        <button className="btn-secondary btn-compact ml-auto !px-4" onClick={() => setShowWaitlist(true)}>
          <Icon name="plus" size={14} className="mr-1 inline" />
          Daftar Tunggu
        </button>
        <button className="btn-primary btn-compact !px-4" onClick={() => setShowNew(true)}>
          <Icon name="plus" size={14} className="mr-1 inline" />
          Reservasi Baru
        </button>
      </div>

      {filter === 'preorder' && onStartPreOrder && (
        <PreOrdersPanel
          now={now}
          onStart={(r) => {
            // Makan di tempat butuh meja; diambil/diantar langsung dibuka.
            if (r.preOrder?.fulfillment === 'dine_in') setPickTableFor(r)
            else void onStartPreOrder(r, null).catch((e: unknown) => toast.error(e instanceof Error ? e.message : 'Gagal memproses pesanan'))
          }}
        />
      )}

      {filter !== 'preorder' && visible.length === 0 && (
        <p className="mt-16 text-center text-sm text-ink-400">
          {filter === 'waitlist' ? 'Tidak ada tamu yang menunggu meja.' : filter === 'today' ? 'Belum ada reservasi untuk hari ini.' : filter === 'upcoming' ? 'Belum ada reservasi mendatang.' : 'Belum ada riwayat reservasi.'}
        </p>
      )}

      <div className={`space-y-2 ${filter === 'preorder' ? 'hidden' : ''}`}>
        {visible.map((r, index) => {
          const table = r.tableId ? tableById.get(r.tableId) : undefined
          const late = !r.walkIn && r.status === 'booked' && now > r.reservedAt + LATE_AFTER_MS
          const callLink = r.walkIn ? waLink(r.phone, `Halo ${r.customerName}, meja Anda sudah siap. Silakan menuju kasir/pelayan kami. Terima kasih sudah menunggu.`) : null
          const dayKey = jakartaDateKey(r.reservedAt)
          const showDay = filter !== 'today' && filter !== 'waitlist' && dayKey !== lastDay
          lastDay = dayKey
          return (
            <div key={r.id}>
              {showDay && <h3 className="eyebrow mb-2 mt-4">{formatDate(r.reservedAt)}</h3>}
              <div className="card flex flex-wrap items-center gap-4 p-4">
                <div className="w-16 flex-none text-center">
                  <p className="font-display text-xl font-bold text-ink-50">{filter === 'waitlist' ? `#${index + 1}` : formatTime(r.reservedAt)}</p>
                  {filter === 'waitlist' && <p className="text-[0.7rem] font-semibold text-ink-300">{durationSince(r.reservedAt, now)}</p>}
                  {late && <p className="text-[0.7rem] font-semibold text-yellow-400">Terlambat</p>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink-50">
                    {r.customerName}
                    <span className="ml-2 text-sm font-normal text-ink-300">{r.guestCount} tamu</span>
                  </p>
                  <p className="truncate text-sm text-ink-400">
                    {r.walkIn ? `Daftar tunggu sejak ${formatTime(r.reservedAt)}` : table ? table.name : 'Meja belum ditentukan'}
                    {r.phone ? ` · ${r.phone}` : ''}
                    {r.note ? ` · ${r.note}` : ''}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_BADGE[r.status]}`}>{RESERVATION_STATUS_LABELS[r.status]}</span>
                {r.status === 'booked' && (
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-primary btn-compact !px-3 text-sm" onClick={() => startSeat(r)}>
                      Dudukkan
                    </button>
                    {callLink && (
                      <a className="btn-secondary btn-compact !px-3 text-sm" href={callLink} target="_blank" rel="noreferrer">
                        Panggil via WA
                      </a>
                    )}
                    {!r.walkIn && (
                      <button className="btn-secondary btn-compact !px-3 text-sm" onClick={() => setEditing(r)}>
                        Ubah
                      </button>
                    )}
                    <button className="btn-ghost btn-compact !px-3 text-sm" onClick={() => void handleClose(r, 'no_show')}>
                      Tidak Datang
                    </button>
                    <button className="btn-ghost btn-compact !px-3 text-sm !text-red-400" onClick={() => void handleClose(r, 'cancelled')}>
                      Batal
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {(showNew || editing) && (
        <ReservationFormModal
          reservation={editing ?? undefined}
          // Reservasi untuk besok/lusa tak tampil di "Hari Ini" — pindah ke tab yang memuatnya.
          onSaved={(reservedAt) => setFilter(reservedAt >= tomorrowStart ? 'upcoming' : reservedAt >= todayStart ? 'today' : 'history')}
          onClose={() => {
            setShowNew(false)
            setEditing(null)
          }}
        />
      )}
      {showWaitlist && (
        <WaitlistModal
          onClose={() => setShowWaitlist(false)}
          onSubmit={async (input) => {
            await addToWaitlist(input, actor)
            setShowWaitlist(false)
            setFilter('waitlist')
            toast.success(`${input.customerName} masuk daftar tunggu.`)
          }}
        />
      )}
      {pickTableFor && (
        <SeatTablePicker
          reservation={pickTableFor}
          tables={tables}
          onCancel={() => setPickTableFor(null)}
          onPick={(tableId) => {
            const r = pickTableFor
            setPickTableFor(null)
            void handleSeat(r, tableId)
          }}
        />
      )}
      {dialog}
    </div>
  )
}

function SeatTablePicker({
  reservation,
  tables,
  onCancel,
  onPick,
}: {
  reservation: Reservation
  tables: CafeTable[]
  onCancel: () => void
  onPick: (tableId: string) => void
}) {
  const available = tables.filter((t) => t.status === 'available')
  const reserved = reservation.tableId ? tables.find((t) => t.id === reservation.tableId) : undefined
  return (
    <Modal onClose={onCancel}>
      <h2 className="mb-1 text-lg font-bold text-ink-50">Dudukkan {reservation.customerName}</h2>
      <p className="mb-4 text-sm text-ink-400">
        {reserved ? `${reserved.name} belum tersedia. Pilih meja lain:` : `Pilih meja untuk ${reservation.guestCount} tamu:`}
      </p>
      <div className="mb-4 grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto">
        {available.map((t) => (
          <button key={t.id} className="btn-secondary flex-col !py-2" onClick={() => onPick(t.id)}>
            <span className="font-semibold">{t.name}</span>
            <span className={`text-xs ${t.capacity < reservation.guestCount ? 'text-yellow-400' : 'opacity-70'}`}>{t.capacity} kursi</span>
          </button>
        ))}
        {available.length === 0 && <p className="col-span-3 text-sm text-ink-500">Tidak ada meja tersedia saat ini.</p>}
      </div>
      <button className="btn-ghost w-full" onClick={onCancel}>
        Batal
      </button>
    </Modal>
  )
}

function WaitlistModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (input: { customerName: string; phone: string; guestCount: number; note: string }) => Promise<void> }) {
  const [customerName, setCustomerName] = useState('')
  const [phone, setPhone] = useState('')
  const [guestCount, setGuestCount] = useState(2)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal onClose={onClose}>
      <h2 className="mb-1 text-lg font-bold text-ink-50">Daftar Tunggu Meja</h2>
      <p className="mb-3 text-sm text-ink-400">Untuk tamu yang sudah datang tetapi meja masih penuh. Urutan mengikuti waktu daftar.</p>
      <input className="input-field mb-3" autoFocus placeholder="Nama tamu" aria-label="Nama tamu" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
      <div className="mb-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Jumlah tamu</span>
          <input type="number" min={1} className="input-field" aria-label="Jumlah tamu menunggu" value={guestCount} onChange={(e) => setGuestCount(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">No. HP (untuk dipanggil)</span>
          <input className="input-field" inputMode="tel" aria-label="No. HP tamu menunggu" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
      </div>
      <input className="input-field mb-3" placeholder="Catatan (opsional), mis. kursi bayi" value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      <div className="flex gap-3">
        <button className="btn-ghost flex-1" onClick={onClose}>
          Batal
        </button>
        <button
          className="btn-primary flex-[2]"
          disabled={!customerName.trim()}
          onClick={() => void onSubmit({ customerName, phone, guestCount, note }).catch((e) => setError(e instanceof Error ? e.message : 'Gagal menyimpan'))}
        >
          Masukkan ke Daftar Tunggu
        </button>
      </div>
    </Modal>
  )
}
