import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { listPrintJobs, processPrintQueue, retryPrintJob } from '@/db/repositories/printQueue'
import { enqueueReceiptForOrder } from '@/db/repositories/receiptDispatch'
import { useSessionStore } from '@/state/sessionStore'
import { roleHasPermission } from '@/lib/permissions'
import { formatDateTime } from '@/lib/datetime'
import { Icon } from '@/components/ui/Icon'
import type { PrintJobStatus } from '@/types/domain'

const STATUS_STYLE: Record<PrintJobStatus, string> = {
  QUEUED: 'bg-ink-800 text-ink-300',
  PRINTING: 'bg-brew-600/20 text-brew-400',
  PRINTED: 'bg-sage-600/20 text-sage-500',
  FAILED: 'bg-red-900/30 text-red-400',
  RETRYING: 'bg-yellow-900/30 text-yellow-400',
  PERMANENTLY_FAILED: 'bg-red-900/40 text-red-300',
}

export function PrintQueueScreen() {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const canRetry = roleHasPermission(currentUser.role, 'print.retry')
  const canReprint = roleHasPermission(currentUser.role, 'receipt.reprint')
  const jobs = useLiveQuery(() => listPrintJobs(150), []) ?? []
  const printers = useLiveQuery(() => db.printers.filter((p) => p.active).toArray(), []) ?? []
  const stationsWithPrinter = new Set(printers.map((p) => p.station))

  const actor = { userId: currentUser.id, userName: currentUser.name }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-none flex-wrap items-center gap-3 border-b border-ink-800 px-6 py-4">
        <h1 className="mr-2 text-xl font-bold text-ink-50">Antrean Cetak</h1>
        <button className="btn-secondary !min-h-0 !px-4 !py-2 text-sm" onClick={() => void processPrintQueue()}>
          Proses Sekarang
        </button>
        {(['cashier', 'kitchen', 'bar'] as const).map((s) =>
          stationsWithPrinter.has(s) ? null : (
            <span key={s} className="rounded-full bg-yellow-900/30 px-3 py-1 text-xs text-yellow-400">
              Belum ada printer {s}
            </span>
          ),
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-2">
          {jobs.map((job) => (
            <div key={job.id} className="card flex items-center justify-between p-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-ink-100">
                  {job.title}
                  {job.isReprint && <span className="ml-2 text-xs text-brown-400">CETAK ULANG</span>}
                </p>
                <p className="text-xs text-ink-500">
                  {job.station} · {formatDateTime(job.createdAt)}
                  {job.attempts > 0 ? ` · ${job.attempts}× coba` : ''}
                  {job.lastError ? ` · ${job.lastError}` : ''}
                </p>
              </div>
              <div className="flex flex-none items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[job.status]}`}>{job.status}</span>
                {canRetry && (job.status === 'FAILED' || job.status === 'PERMANENTLY_FAILED' || job.status === 'RETRYING') && (
                  <button className="btn-secondary !min-h-0 !px-3 !py-1 text-xs" onClick={() => void retryPrintJob(job.id, actor)}>
                    Retry
                  </button>
                )}
                {canReprint && job.status === 'PRINTED' && job.kind === 'receipt' && job.orderId && (
                  <button
                    className="btn-secondary !min-h-0 !px-3 !py-1 text-xs"
                    onClick={() => void enqueueReceiptForOrder(job.orderId!, actor, { isReprint: true })}
                  >
                    Reprint
                  </button>
                )}
              </div>
            </div>
          ))}
          {jobs.length === 0 && (
            <p className="mt-10 text-center text-ink-500">
              <Icon name="printer" size={32} className="mx-auto mb-2 text-ink-600" />
              Belum ada pekerjaan cetak
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
