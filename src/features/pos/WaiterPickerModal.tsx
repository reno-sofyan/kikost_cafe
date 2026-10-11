import { useLiveQuery } from 'dexie-react-hooks'
import { listWaiterCandidates } from '@/db/repositories/users'
import { ROLE_LABELS } from '@/lib/permissions'
import { Modal } from '@/components/ui/Modal'

interface Props {
  currentWaiterId: string | null
  onCancel: () => void
  onPick: (waiter: { id: string; name: string } | null) => void
}

/** Pilih pelayan yang melayani pesanan — dipakai laporan penjualan per pelayan. */
export function WaiterPickerModal({ currentWaiterId, onCancel, onPick }: Props) {
  const waiters = useLiveQuery(() => listWaiterCandidates(), []) ?? []

  return (
    <Modal onClose={onCancel}>
      <h2 className="mb-1 text-lg font-bold text-ink-50">Pelayan</h2>
      <p className="mb-4 text-sm text-ink-400">Siapa yang melayani pesanan ini?</p>
      <div className="mb-4 grid max-h-[50vh] grid-cols-2 gap-2 overflow-y-auto">
        {waiters.map((u) => (
          <button
            key={u.id}
            className={`btn flex-col !items-start !py-2 text-left ${u.id === currentWaiterId ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => onPick({ id: u.id, name: u.name })}
          >
            <span className="font-semibold">{u.name}</span>
            <span className="text-xs opacity-75">{ROLE_LABELS[u.role]}</span>
          </button>
        ))}
        {waiters.length === 0 && <p className="col-span-2 text-sm text-ink-500">Belum ada pengguna aktif.</p>}
      </div>
      <div className="flex gap-3">
        <button className="btn-ghost flex-1" onClick={onCancel}>
          Batal
        </button>
        {currentWaiterId && (
          <button className="btn-secondary flex-1" onClick={() => onPick(null)}>
            Tanpa Pelayan
          </button>
        )}
      </div>
    </Modal>
  )
}
