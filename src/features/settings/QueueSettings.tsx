import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { drawQueueNumber, resetQueueNumbers } from '@/db/repositories/orders'
import { useSessionStore } from '@/state/sessionStore'
import { useConfirmDialog } from '@/components/ui/useConfirmDialog'
import { formatDateTime } from '@/lib/datetime'
import { toast } from '@/state/toastStore'

export function QueueSettings() {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const { confirm, dialog: confirmDialog } = useConfirmDialog()
  const nextNumber = useLiveQuery(() => drawQueueNumber(), [])
  const resetAt = useLiveQuery(async () => (await db.settings.get('singleton'))?.queueResetAt ?? null, [])
  const openWithQueue = useLiveQuery(
    () => db.orders.where('status').equals('open').filter((o) => o.queueNumber != null).count(),
    [],
  )

  async function handleReset() {
    const ok = await confirm({
      title: 'Reset nomor antrean ke #1?',
      description: `Pesanan berikutnya mendapat nomor #1. Nomor pesanan yang sudah ada tidak berubah.${
        openWithQueue ? ` Masih ada ${openWithQueue} pesanan terbuka bernomor antrean — nomornya bisa sama dengan pesanan baru.` : ''
      }`,
      confirmLabel: 'Ya, Reset',
      tone: openWithQueue ? 'danger' : 'default',
    })
    if (!ok) return
    await resetQueueNumbers({ userId: currentUser.id, userName: currentUser.name })
    toast.success('Nomor antrean direset — pesanan berikutnya #1')
  }

  return (
    <div className="card max-w-lg p-6">
      <h2 className="mb-1 text-lg font-bold text-ink-50">Nomor Antrean</h2>
      <p className="mb-4 text-sm text-ink-400">
        Antrean otomatis kembali ke #1 setiap hari pukul 00.00 WIB. Reset manual dipakai bila nomor hari ini sudah
        terpakai untuk uji coba.
      </p>
      <div className="mb-4 flex items-center justify-between rounded-xl bg-ink-800 px-4 py-3">
        <span className="text-sm text-ink-300">Nomor antrean berikutnya</span>
        <span className="text-2xl font-bold text-ink-50">{nextNumber != null ? `#${nextNumber}` : '…'}</span>
      </div>
      {resetAt && <p className="mb-4 text-xs text-ink-500">Terakhir direset manual: {formatDateTime(resetAt)}</p>}
      <button className="btn-secondary w-full" disabled={nextNumber === 1} onClick={() => void handleReset()}>
        Reset Antrean ke #1
      </button>
      {confirmDialog}
    </div>
  )
}
