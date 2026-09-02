/**
 * Pengingat backup manual — khusus per-perangkat, disimpan di localStorage.
 *
 * Kafe pakai satu tablet tanpa sinkronisasi server, jadi backup manual berkala
 * (Pengaturan → Backup → Unduh) adalah satu-satunya jaring pengaman data. Helper
 * ini melacak kapan backup terakhir dan kapan dianggap "kedaluwarsa".
 */
const LAST_BACKUP_KEY = 'kikost.backup.lastAt'

/** Ambang kedaluwarsa: backup terakhir lebih lama dari ini memunculkan peringatan. */
export const BACKUP_STALE_MS = 36 * 60 * 60 * 1000 // 36 jam (≈ lewat satu hari operasional)

export function getLastBackupAt(): number | null {
  try {
    const raw = localStorage.getItem(LAST_BACKUP_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

export function markBackupDone(at: number = Date.now()): void {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, String(at))
  } catch {
    /* localStorage tidak tersedia — pengingat tidak akurat, bukan masalah fatal */
  }
}

/** True bila belum pernah backup di perangkat ini, atau backup terakhir sudah kedaluwarsa. */
export function backupIsStale(now: number = Date.now()): boolean {
  const last = getLastBackupAt()
  return last === null || now - last > BACKUP_STALE_MS
}

/** Label ringkas untuk indikator, mis. "2 hari lalu" / "belum pernah". */
export function lastBackupLabel(now: number = Date.now()): string {
  const last = getLastBackupAt()
  if (last === null) return 'belum pernah'
  const mins = Math.floor((now - last) / 60000)
  if (mins < 60) return `${Math.max(1, mins)} menit lalu`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} jam lalu`
  return `${Math.floor(hours / 24)} hari lalu`
}
