import { useLiveQuery } from 'dexie-react-hooks'
import { listAuditLogs } from '@/db/repositories/auditLog'
import { formatDateTime } from '@/lib/datetime'

export function AuditLogPanel() {
  const logs = useLiveQuery(() => listAuditLogs(300), []) ?? []

  return (
    <div className="max-w-2xl space-y-2">
      {logs.map((log) => (
        <div key={log.id} className="card p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-ink-100">{log.action}</span>
            <span className="text-xs text-ink-500">{formatDateTime(log.createdAt)}</span>
          </div>
          <p className="text-ink-400">{log.details}</p>
          <p className="text-xs text-ink-500">oleh {log.userName}</p>
        </div>
      ))}
      {logs.length === 0 && <p className="text-ink-500">Belum ada aktivitas tercatat</p>}
    </div>
  )
}
