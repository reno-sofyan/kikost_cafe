import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listTables } from '@/db/repositories/tables'
import { createReservation, updateReservation, type ReservationInput } from '@/db/repositories/reservations'
import { jakartaDateKey, jakartaDateTimeToEpoch, jakartaTimeKey } from '@/lib/datetime'
import { useSessionStore } from '@/state/sessionStore'
import { Modal } from '@/components/ui/Modal'
import type { Reservation } from '@/types/domain'

interface Props {
  /** Diisi = ubah reservasi; kosong = reservasi baru. */
  reservation?: Reservation
  onClose: () => void
}

/** Default: hari ini, dibulatkan ke jam penuh berikutnya. */
function defaultReservedAt(): number {
  const hour = 60 * 60 * 1000
  return Math.ceil((Date.now() + 15 * 60 * 1000) / hour) * hour
}

export function ReservationFormModal({ reservation, onClose }: Props) {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const tables = useLiveQuery(() => listTables(), []) ?? []
  const initialAt = reservation?.reservedAt ?? defaultReservedAt()

  const [customerName, setCustomerName] = useState(reservation?.customerName ?? '')
  const [phone, setPhone] = useState(reservation?.phone ?? '')
  const [guestCount, setGuestCount] = useState(reservation?.guestCount ?? 2)
  const [date, setDate] = useState(jakartaDateKey(initialAt))
  const [time, setTime] = useState(jakartaTimeKey(initialAt))
  const [tableId, setTableId] = useState<string | null>(reservation?.tableId ?? null)
  const [note, setNote] = useState(reservation?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const selectedTable = tables.find((t) => t.id === tableId)

  async function handleSave() {
    setError(null)
    const input: ReservationInput = {
      customerName,
      phone,
      guestCount,
      reservedAt: jakartaDateTimeToEpoch(date, time),
      tableId,
      note,
    }
    setBusy(true)
    try {
      if (reservation) await updateReservation(reservation.id, input)
      else await createReservation(input, { userId: currentUser.id, userName: currentUser.name })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan reservasi')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-ink-900 p-6">
      <h2 className="mb-4 text-lg font-bold text-ink-50">{reservation ? 'Ubah Reservasi' : 'Reservasi Baru'}</h2>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Nama Pemesan</span>
          <input className="input-field" autoFocus maxLength={60} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">No. HP (opsional)</span>
          <input className="input-field" inputMode="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Tanggal</span>
          <input type="date" className="input-field" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-ink-300">Jam (WIB)</span>
          <input type="time" className="input-field" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>

      <div className="mb-3 flex items-center gap-3">
        <span className="text-sm text-ink-300">Jumlah Tamu</span>
        <button className="btn-secondary btn-compact !px-3" aria-label="Kurangi tamu" onClick={() => setGuestCount((g) => Math.max(1, g - 1))}>
          −
        </button>
        <span className="w-6 text-center font-bold">{guestCount}</span>
        <button className="btn-secondary btn-compact !px-3" aria-label="Tambah tamu" onClick={() => setGuestCount((g) => g + 1)}>
          +
        </button>
      </div>

      {tables.length > 0 && (
        <div className="mb-3">
          <h3 className="mb-2 text-sm text-ink-300">Meja (boleh ditentukan nanti)</h3>
          <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
            <button className={`btn btn-compact !px-3 text-sm ${tableId === null ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTableId(null)}>
              Belum ditentukan
            </button>
            {tables.map((t) => (
              <button
                key={t.id}
                className={`btn btn-compact !px-3 text-sm ${tableId === t.id ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setTableId(t.id)}
              >
                {t.name}
                <span className="ml-1 text-xs opacity-70">({t.capacity})</span>
              </button>
            ))}
          </div>
          {selectedTable && guestCount > selectedTable.capacity && (
            <p className="mt-1 text-xs text-yellow-400">
              {selectedTable.name} berkapasitas {selectedTable.capacity} — tamu {guestCount} orang.
            </p>
          )}
        </div>
      )}

      <label className="mb-4 block">
        <span className="mb-1 block text-sm text-ink-300">Catatan (opsional)</span>
        <input
          className="input-field"
          maxLength={120}
          placeholder='mis. "ulang tahun", "kursi bayi", "dekat jendela"'
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <div className="flex gap-3">
        <button className="btn-ghost flex-1" onClick={onClose}>
          Batal
        </button>
        <button className="btn-primary flex-[2]" disabled={busy || !customerName.trim()} onClick={() => void handleSave()}>
          {busy ? 'Menyimpan...' : 'Simpan Reservasi'}
        </button>
      </div>
    </Modal>
  )
}
