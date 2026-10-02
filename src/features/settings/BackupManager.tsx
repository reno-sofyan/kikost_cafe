import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  backupFileName,
  BackupPassphraseRequiredError,
  exportEncryptedBackup,
  parseBackupFile,
  restoreBackup,
  type BackupFile,
} from '@/db/repositories/backup'
import { BackupPassphraseError } from '@/lib/backupCrypto'
import { businessDisplayName, getSettings } from '@/db/repositories/settings'
import { useSessionStore } from '@/state/sessionStore'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { formatDateTime } from '@/lib/datetime'
import { saveTextFile } from '@/lib/saveFile'
import { markBackupDone } from '@/lib/backupReminder'
import { Capacitor } from '@capacitor/core'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Modal } from '@/components/ui/Modal'

/** Dialog input passphrase — dipakai untuk mengunci backup baru (dua kali, cegah salah ketik)
 * maupun membuka backup lama saat memulihkan (satu kali). Satu komponen, dua mode, supaya
 * gaya & validasi panjang minimalnya konsisten di kedua alur. */
function PassphraseModal({
  mode,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  mode: 'set' | 'unlock'
  busy: boolean
  error: string | null
  onCancel: () => void
  onSubmit: (passphrase: string) => void
}) {
  const [value, setValue] = useState('')
  const [confirmValue, setConfirmValue] = useState('')
  const mismatch = mode === 'set' && confirmValue.length > 0 && value !== confirmValue
  const tooShort = mode === 'set' && value.length > 0 && value.length < 8
  const canSubmit = mode === 'set' ? value.length >= 8 && value === confirmValue : value.length > 0

  return (
    <Modal onClose={onCancel} closeOnBackdrop={!busy}>
      <h2 className="mb-2 text-lg font-bold text-ink-50">
        {mode === 'set' ? 'Kunci Backup dengan Passphrase' : 'Masukkan Passphrase Backup'}
      </h2>
      <p className="mb-4 text-sm text-ink-400">
        {mode === 'set'
          ? 'Backup berisi data sensitif (PIN, nomor HP pelanggan, riwayat transaksi) — passphrase ini mengenkripsinya. Simpan baik-baik: tanpa passphrase ini, backup tidak bisa dipulihkan oleh siapa pun, termasuk kami.'
          : 'File backup ini terenkripsi. Masukkan passphrase yang dipakai saat membuatnya.'}
      </p>
      <label className="mb-3 block">
        <span className="mb-1 block text-xs text-ink-400">Passphrase</span>
        <input
          type="password"
          autoFocus
          className="input-field"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) onSubmit(value)
          }}
        />
      </label>
      {mode === 'set' && (
        <label className="mb-1 block">
          <span className="mb-1 block text-xs text-ink-400">Ulangi Passphrase</span>
          <input
            type="password"
            className="input-field"
            value={confirmValue}
            onChange={(e) => setConfirmValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSubmit) onSubmit(value)
            }}
          />
        </label>
      )}
      {tooShort && <p className="mt-1 text-xs text-red-400">Minimal 8 karakter.</p>}
      {mismatch && <p className="mt-1 text-xs text-red-400">Passphrase tidak sama.</p>}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <div className="mt-5 flex gap-3">
        <button className="btn-ghost flex-1" disabled={busy} onClick={onCancel}>
          Batal
        </button>
        <button className="btn-primary flex-[2]" disabled={busy || !canSubmit} onClick={() => onSubmit(value)}>
          {busy ? 'Memproses...' : mode === 'set' ? 'Kunci & Unduh' : 'Buka'}
        </button>
      </div>
    </Modal>
  )
}

export function BackupManager() {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmRestoreFile, setConfirmRestoreFile] = useState<BackupFile | null>(null)
  const [pendingExport, setPendingExport] = useState(false)
  const [pendingRestoreText, setPendingRestoreText] = useState<string | null>(null)
  const [passphraseError, setPassphraseError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Nama berkas backup memakai nama usaha — pemilik beberapa outlet perlu tahu
  // berkas mana milik siapa tanpa membukanya.
  const settings = useLiveQuery(() => getSettings(), [])

  async function handleExport(passphrase: string) {
    setBusy(true)
    setPassphraseError(null)
    try {
      const envelope = await exportEncryptedBackup(passphrase)
      await saveTextFile(backupFileName(businessDisplayName(settings)), JSON.stringify(envelope, null, 2), 'application/json')
      markBackupDone()
      await recordAuditLog({
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'backup.export',
        entityType: 'backup',
        entityId: 'manual',
        details: 'Backup manual diekspor (terenkripsi)',
      })
      setPendingExport(false)
      setMessage(
        Capacitor.isNativePlatform()
          ? `Backup terenkripsi dibuat pada ${formatDateTime(Date.now())} — pilih tujuan simpan (Drive/WhatsApp/email) di menu bagikan.`
          : `Backup terenkripsi berhasil diunduh pada ${formatDateTime(Date.now())}`,
      )
    } catch (e) {
      setPassphraseError(e instanceof Error ? e.message : 'Gagal membuat backup')
    } finally {
      setBusy(false)
    }
  }

  async function tryParseRestore(text: string, passphrase?: string) {
    setBusy(true)
    setPassphraseError(null)
    try {
      const file = await parseBackupFile(text, passphrase)
      setPendingRestoreText(null)
      setConfirmRestoreFile(file)
    } catch (e) {
      if (e instanceof BackupPassphraseRequiredError) {
        setPendingRestoreText(text) // percobaan pertama tanpa passphrase — buka dialog, bukan error
      } else if (e instanceof BackupPassphraseError) {
        setPendingRestoreText(text) // passphrase salah — biarkan dialog terbuka, tampilkan error DI DALAMNYA
        setPassphraseError(e.message)
      } else {
        setError(e instanceof Error ? e.message : 'Gagal membaca file backup. Pastikan file tidak rusak.')
        setPendingRestoreText(null)
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleRestore(file: BackupFile, sourceLabel: string) {
    setBusy(true)
    setError(null)
    try {
      await restoreBackup(file)
      await recordAuditLog({
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'backup.restore',
        entityType: 'backup',
        entityId: 'manual',
        details: `Data dipulihkan dari file ${sourceLabel}`,
      })
      setMessage('Data berhasil dipulihkan. Memuat ulang aplikasi...')
      setTimeout(() => window.location.reload(), 1500)
    } catch {
      setError('Gagal memulihkan data dari backup.')
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
          Unduh seluruh data aplikasi (produk, transaksi, stok, pengguna, pengaturan) sebagai file terenkripsi. Simpan file
          ini di tempat aman (email, drive, atau penyimpanan eksternal) secara berkala.
        </p>
        <button className="btn-primary" disabled={busy} onClick={() => setPendingExport(true)}>
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
            e.target.value = ''
            if (file) void file.text().then((text) => void tryParseRestore(text))
          }}
        />
        <button className="btn-danger" disabled={busy} onClick={() => fileInputRef.current?.click()}>
          Pilih File Backup untuk Dipulihkan
        </button>
      </div>

      {message && <p className="text-sm text-success-500">{message}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {pendingExport && (
        <PassphraseModal
          mode="set"
          busy={busy}
          error={passphraseError}
          onCancel={() => {
            setPendingExport(false)
            setPassphraseError(null)
          }}
          onSubmit={(passphrase) => void handleExport(passphrase)}
        />
      )}

      {pendingRestoreText && (
        <PassphraseModal
          mode="unlock"
          busy={busy}
          error={passphraseError}
          onCancel={() => {
            setPendingRestoreText(null)
            setPassphraseError(null)
          }}
          onSubmit={(passphrase) => void tryParseRestore(pendingRestoreText, passphrase)}
        />
      )}

      {confirmRestoreFile && (
        <ConfirmDialog
          title="Konfirmasi Pemulihan"
          description="Seluruh data saat ini di perangkat ini akan diganti dengan isi file backup. Tindakan ini tidak dapat dibatalkan. Lanjutkan?"
          confirmLabel="Ya, Pulihkan"
          tone="danger"
          onCancel={() => setConfirmRestoreFile(null)}
          onConfirm={() => void handleRestore(confirmRestoreFile, 'backup terenkripsi')}
        />
      )}
    </div>
  )
}
