import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { listAuditLogs, verifyAuditLogIntegrity } from '@/db/repositories/auditLog'
import { formatDateTime } from '@/lib/datetime'
import { Icon } from '@/components/ui/Icon'
import type { AuditLogIntegritySummary } from '@/lib/auditLogIntegrity'

export function AuditLogPanel() {
  const logs = useLiveQuery(() => listAuditLogs(300), []) ?? []
  const [integrity, setIntegrity] = useState<AuditLogIntegritySummary | null>(null)
  const [checking, setChecking] = useState(false)

  async function runCheck() {
    setChecking(true)
    try {
      setIntegrity(await verifyAuditLogIntegrity())
    } finally {
      setChecking(false)
    }
  }

  const brokenIds = new Set(integrity?.brokenEntryIds ?? [])

  return (
    <div className="max-w-2xl space-y-3">
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <button className="btn-secondary btn-compact" disabled={checking} onClick={() => void runCheck()}>
          {checking ? 'Memeriksa...' : 'Cek Integritas Log'}
        </button>
        {integrity && integrity.brokenCount === 0 && (
          <span className="flex items-center gap-1.5 text-sm text-success-500">
            <Icon name="check" size={16} />
            {integrity.okCount} entri terverifikasi utuh
            {integrity.unverifiableCount > 0 && ` (+ ${integrity.unverifiableCount} entri lama, sebelum fitur ini ada)`}
          </span>
        )}
        {integrity && integrity.brokenCount > 0 && (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-red-400">
            <Icon name="alertTriangle" size={16} />
            {integrity.brokenCount} entri terdeteksi diubah/dihapus di luar aplikasi — ditandai merah di bawah.
          </span>
        )}
      </div>

      {logs.map((log) => (
        <div
          key={log.id}
          className={`card p-3 text-sm ${brokenIds.has(log.id) ? 'border border-red-500/60 bg-red-900/10' : ''}`}
        >
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-semibold text-ink-100">
              {brokenIds.has(log.id) && <Icon name="alertTriangle" size={14} className="text-red-400" />}
              {log.action}
            </span>
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
