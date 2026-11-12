import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { clockAttendanceManual, formatWorkMinutes, MANUAL_REASON_MIN } from '@/db/repositories/attendance'
import { updateSettings } from '@/db/repositories/settings'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { attendancePageBase, attendanceQrCode } from '@/lib/attendanceQr'
import { getTrustedNow } from '@/lib/clockGuard'
import { formatTime } from '@/lib/datetime'
import { ROLE_LABELS, roleHasPermission } from '@/lib/permissions'
import { getAttendanceQrSecret, isBackendConfigured, uploadAttendanceRoster } from '@/sync/client'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/state/toastStore'
import type { AppSettings, User } from '@/types/domain'

type Actor = { userId: string; userName: string }

/** Rahasia QR disimpan lokal supaya QR tetap tampil saat tablet sedang offline. */
const SECRET_CACHE_KEY = 'kione.attendanceQrSecret'

type QrConfig = { secret: string; ref: string; periodMs: number }

function readCachedSecret(): QrConfig | null {
  try {
    const raw = localStorage.getItem(SECRET_CACHE_KEY)
    const c = raw ? (JSON.parse(raw) as Partial<QrConfig>) : null
    // Cache lama (sebelum QR memuat penanda usaha) diabaikan — QR-nya tak dikenali server.
    return c?.secret && c.ref && c.periodMs ? (c as QrConfig) : null
  } catch {
    return null
  }
}

/**
 * Mengirim daftar karyawan aktif (nama + hash PIN) ke server tiap kali berubah, supaya
 * karyawan bisa memilih namanya & memasukkan PIN di HP. Diam saja bila tablet belum
 * tersambung atau sedang offline — dicoba lagi saat layar Absensi dibuka berikutnya.
 */
export function useAttendanceRosterSync(users: User[]) {
  const payload = useMemo(
    () => JSON.stringify(users.filter((u) => u.active && u.pinHash && u.pinSalt).map((u) => ({ userId: u.id, userName: u.name, pinHash: u.pinHash, pinSalt: u.pinSalt }))),
    [users],
  )
  useEffect(() => {
    if (!isBackendConfigured()) return
    uploadAttendanceRoster(JSON.parse(payload) as Parameters<typeof uploadAttendanceRoster>[0]).catch(() => undefined)
  }, [payload])
}

/**
 * QR absensi layar penuh di tablet kasir. Kode berganti tiap periode (20 detik) —
 * karyawan memindainya dengan kamera HP-nya, memilih nama, lalu memasukkan PIN. Foto QR
 * yang dikirim ke orang lain sudah basi sebelum sempat dipakai.
 */
export function AttendanceQrModal({ settings, onClose }: { settings: AppSettings | undefined; onClose: () => void }) {
  const [config, setConfig] = useState(readCachedSecret)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => getTrustedNow())
  const [image, setImage] = useState<string | null>(null)
  const base = attendancePageBase(settings)

  useEffect(() => {
    if (!isBackendConfigured()) return setError('Tablet belum tersambung ke server sinkronisasi (Pengaturan → Sinkronisasi).')
    getAttendanceQrSecret()
      .then((c) => {
        setConfig(c)
        try {
          localStorage.setItem(SECRET_CACHE_KEY, JSON.stringify(c))
        } catch {
          /* tanpa cache: QR hanya tampil saat online */
        }
      })
      .catch((e) => {
        if (!readCachedSecret()) setError(e instanceof Error ? e.message : 'Gagal menyiapkan QR absensi.')
      })
  }, [])

  useEffect(() => {
    const t = setInterval(() => setNow(getTrustedNow()), 500)
    return () => clearInterval(t)
  }, [])

  const slot = config ? Math.floor(now / config.periodMs) : null
  useEffect(() => {
    if (!config || slot == null || !base) return
    let cancelled = false
    void attendanceQrCode(config.secret, slot)
      .then((code) => QRCode.toDataURL(`${base}#c=${config.ref}.${slot}.${code}`, { width: 560, margin: 2, errorCorrectionLevel: 'M' }))
      .then((url) => !cancelled && setImage(url))
    return () => {
      cancelled = true
    }
  }, [config, slot, base])

  const progress = config ? 1 - (now % config.periodMs) / config.periodMs : 0
  return (
    <Modal onClose={onClose} className="w-full max-w-lg rounded-2xl bg-ink-900 p-6 text-center">
      <h2 className="text-xl font-bold text-ink-50">QR Absensi</h2>
      <p className="mt-1 text-sm text-ink-300">Pindai dengan kamera HP, pilih nama, masukkan PIN, lalu selfie.</p>
      {error || !base ? (
        <p className="my-10 text-sm text-red-400">{error ?? 'Alamat publik belum diatur (Pengaturan → Sinkronisasi atau URL QR meja).'}</p>
      ) : (
        <>
          <div className="mx-auto mt-4 aspect-square w-full max-w-[22rem] rounded-2xl bg-white p-2">{image && <img src={image} alt="QR absensi" className="h-full w-full" />}</div>
          <div className="mx-auto mt-3 h-1.5 w-full max-w-[22rem] overflow-hidden rounded-full bg-ink-800">
            <div className="h-full bg-brand-500 transition-[width] duration-500 ease-linear" style={{ width: `${progress * 100}%` }} />
          </div>
          <p className="mt-2 text-xs text-ink-400">QR berganti otomatis tiap {Math.round((config?.periodMs ?? 20_000) / 1000)} detik · {formatTime(now)}</p>
        </>
      )}
      <button className="btn-secondary mt-5 w-full" onClick={onClose}>
        Tutup
      </button>
    </Modal>
  )
}

/**
 * Absen manual — pengecualian bila HP karyawan mati/tanpa internet. Disetujui Admin/Pemilik
 * dengan PIN-nya sendiri + alasan; tercatat dan ditandai "Manual" di rekap.
 */
export function ManualAttendanceModal({ users, clockedIn, onClose }: { users: User[]; clockedIn: Map<string, number> | undefined; onClose: () => void }) {
  const approvers = useMemo(() => users.filter((u) => roleHasPermission(u.role, 'settings.manage')), [users])
  const [staffId, setStaffId] = useState('')
  const [approverId, setApproverId] = useState(approvers.length === 1 ? approvers[0].id : '')
  const [pin, setPin] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const staff = users.find((u) => u.id === staffId)
  const clockingOut = staff ? (clockedIn?.has(staff.id) ?? false) : false

  async function submit() {
    if (!staff) return
    setBusy(true)
    setError(null)
    try {
      const res = await clockAttendanceManual({ staff: { id: staff.id, name: staff.name }, approverId, approverPin: pin, reason })
      toast.success(res.type === 'in' ? `${res.userName} absen masuk (manual) pukul ${formatTime(res.at)}.` : `${res.userName} absen pulang (manual) — bekerja ${formatWorkMinutes(res.minutes)}.`)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal absen.')
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} className="w-full max-w-md rounded-2xl bg-ink-900 p-6">
      <h2 className="text-lg font-bold text-ink-50">Absen Manual</h2>
      <p className="mb-4 text-sm text-ink-400">Hanya untuk pengecualian (HP mati / tanpa internet). Wajib disetujui Admin atau Pemilik dan ditandai “Manual” di rekap.</p>
      {approvers.length === 0 ? (
        <p className="text-sm text-yellow-400">Belum ada akun Admin/Pemilik aktif untuk menyetujui.</p>
      ) : (
        <>
          <label className="mb-3 block">
            <span className="mb-1 block text-sm text-ink-300">Karyawan</span>
            <select className="input-field" value={staffId} onChange={(e) => setStaffId(e.target.value)} aria-label="Karyawan">
              <option value="">Pilih karyawan…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {clockedIn?.has(u.id) ? 'absen pulang' : 'absen masuk'}
                </option>
              ))}
            </select>
          </label>
          <label className="mb-3 block">
            <span className="mb-1 block text-sm text-ink-300">Alasan</span>
            <input className="input-field" maxLength={160} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. HP mati baterai" aria-label="Alasan absen manual" />
          </label>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-sm text-ink-300">Disetujui oleh</span>
              <select className="input-field" value={approverId} onChange={(e) => setApproverId(e.target.value)} aria-label="Penyetuju">
                <option value="">Pilih…</option>
                {approvers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({ROLE_LABELS[u.role]})
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-ink-300">PIN penyetuju</span>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                className="input-field text-center tracking-[0.4em]"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                aria-label="PIN penyetuju"
              />
            </label>
          </div>
        </>
      )}
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
      <div className="mt-2 flex gap-3">
        <button className="btn-ghost flex-1" onClick={onClose}>
          Batal
        </button>
        <button className="btn-primary flex-[2]" disabled={busy || !staff || !approverId || pin.length < 4 || reason.trim().length < MANUAL_REASON_MIN} onClick={() => void submit()}>
          {clockingOut ? 'Catat Absen Pulang' : 'Catat Absen Masuk'}
        </button>
      </div>
    </Modal>
  )
}

/** Pengaturan admin: selfie wajib/opsional. Karyawan absen dari HP mana pun dengan PIN-nya. */
export function PhoneAttendanceSettings({ settings, actor }: { settings: AppSettings | undefined; actor: Actor }) {
  const selfieMode = settings?.attendancePhoneSelfie ?? 'required'

  async function setSelfie(mode: 'required' | 'optional') {
    await updateSettings({ attendancePhoneSelfie: mode })
    await recordAuditLog({ ...actor, action: 'attendance.selfie_mode', entityType: 'settings', entityId: 'singleton', details: `Selfie absen lewat HP diatur ${mode === 'required' ? 'WAJIB' : 'OPSIONAL'}.` })
    toast.success(mode === 'required' ? 'Selfie sekarang wajib saat absen.' : 'Selfie sekarang opsional saat absen.')
  }

  return (
    <div className="mt-8">
      <h2 className="mb-1 font-semibold text-ink-100">Absen lewat HP</h2>
      <p className="mb-3 text-sm text-ink-400">
        Karyawan memindai QR Absensi di tablet ini dengan HP apa saja, memilih namanya, memasukkan PIN-nya sendiri, lalu selfie. Tidak perlu mendaftarkan HP. PIN salah 5 kali
        mengunci nama itu 15 menit.
      </p>
      {!isBackendConfigured() && <p className="card mb-3 p-4 text-sm text-yellow-400">Tablet belum tersambung ke server sinkronisasi — absen lewat HP butuh server.</p>}
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <div className="mr-auto">
          <p className="font-medium text-ink-50">Selfie saat absen</p>
          <p className="text-xs text-ink-400">Wajib = absen ditolak tanpa foto wajah. Disarankan tetap wajib supaya PIN tidak bisa dititipkan ke teman.</p>
        </div>
        {(['required', 'optional'] as const).map((m) => (
          <button key={m} className={`btn btn-compact !px-4 text-sm ${selfieMode === m ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={selfieMode === m} onClick={() => void setSelfie(m)}>
            {m === 'required' ? 'Wajib' : 'Opsional'}
          </button>
        ))}
      </div>
    </div>
  )
}
