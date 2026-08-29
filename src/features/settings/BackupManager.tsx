import { useRef, useState } from 'react'
import { backupFileName, exportBackup, restoreBackup, validateBackupFile } from '@/db/repositories/backup'
import { useSessionStore } from '@/state/sessionStore'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { formatDateTime } from '@/lib/datetime'

export function BackupManager() {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmRestoreFile, setConfirmRestoreFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleExport() {
    setBusy(true)
    setError(null)
    try {
      const backup = await exportBackup()
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = backupFileName('kikost-cafe')
      a.click()
      URL.revokeObjectURL(url)
      await recordAuditLog({
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'backup.export',
        entityType: 'backup',
        entityId: 'manual',
        details: 'Backup manual diekspor',
      })
      setMessage(`Backup berhasil diunduh pada ${formatDateTime(Date.now())}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleRestore(file: File) {
    setBusy(true)
    setError(null)
    try {
      const text = await file.text()
      const data = JSON.parse(text) as unknown
      if (!validateBackupFile(data)) {
        setError('File backup tidak valid. Pastikan file berasal dari ekspor Kikost Cafe POS.')
        return
      }
      await restoreBackup(data)
      await recordAuditLog({
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'backup.restore',
        entityType: 'backup',
        entityId: 'manual',
        details: `Data dipulihkan dari file ${file.name}`,
      })
      setMessage('Data berhasil dipulihkan. Memuat ulang aplikasi...')
      setTimeout(() => window.location.reload(), 1500)
    } catch {
      setError('Gagal membaca file backup. Pastikan file tidak rusak.')
    } finally {
      setBusy(false)
      setConfirmRestoreFile(null)
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="card p-5">
        <h3 className="mb-2 font-semibold text-ink-100">Backup Manual</h3>
        <p className="mb-4 text-sm text-ink-400">
          Unduh seluruh data aplikasi (produk, transaksi, stok, pengguna, pengaturan) sebagai file JSON. Simpan file ini di
          tempat aman (email, drive, atau penyimpanan eksternal) secara berkala.
        </p>
        <button className="btn-primary" disabled={busy} onClick={() => void handleExport()}>
          Unduh Backup Sekarang
        </button>
      </div>

      <div className="card p-5">
        <h3 className="mb-2 font-semibold text-ink-100">Pulihkan dari Backup</h3>
        <p className="mb-4 text-sm text-red-400">
          Peringatan: memulihkan backup akan MENIMPA seluruh data yang ada di perangkat ini. Gunakan hanya saat memulihkan
          tablet baru/rusak.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) setConfirmRestoreFile(file)
            e.target.value = ''
          }}
        />
        <button className="btn-danger" disabled={busy} onClick={() => fileInputRef.current?.click()}>
          Pilih File Backup untuk Dipulihkan
        </button>
      </div>

      {message && <p className="text-sm text-sage-500">{message}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {confirmRestoreFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setConfirmRestoreFile(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-ink-900 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-lg font-bold text-red-400">Konfirmasi Pemulihan</h2>
            <p className="mb-4 text-sm text-ink-300">
              Anda akan memulihkan data dari <span className="font-semibold">{confirmRestoreFile.name}</span>. Seluruh data
              saat ini di perangkat ini akan diganti. Tindakan ini tidak dapat dibatalkan. Lanjutkan?
            </p>
            <div className="flex gap-3">
              <button className="btn-ghost flex-1" onClick={() => setConfirmRestoreFile(null)}>
                Batal
              </button>
              <button className="btn-danger flex-[2]" onClick={() => void handleRestore(confirmRestoreFile)}>
                Ya, Pulihkan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
