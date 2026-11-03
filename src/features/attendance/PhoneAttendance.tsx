import { useCallback, useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { clockAttendanceManual, formatWorkMinutes, MANUAL_REASON_MIN } from '@/db/repositories/attendance'
import { updateSettings } from '@/db/repositories/settings'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { attendancePageBase, attendanceQrCode } from '@/lib/attendanceQr'
import { getTrustedNow } from '@/lib/clockGuard'
import { formatDateTime, formatTime } from '@/lib/datetime'
import { ROLE_LABELS, roleHasPermission } from '@/lib/permissions'
import { createStaffPhoneEnrollment, getAttendanceQrSecret, isBackendConfigured, listStaffPhones, revokeStaffPhone, type StaffPhone } from '@/sync/client'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/state/toastStore'
import type { AppSettings, User } from '@/types/domain'

type Actor = { userId: string; userName: string }

/** Rahasia QR disimpan lokal supaya QR tetap tampil saat tablet sedang offline. */
const SECRET_CACHE_KEY = 'kione.attendanceQrSecret'

function readCachedSecret(): { secret: string; periodMs: number } | null {
  try {
    const raw = localStorage.getItem(SECRET_CACHE_KEY)
    return raw ? (JSON.parse(raw) as { secret: string; periodMs: number }) : null
  } catch {
    return null
  }
}

/**
 * QR absensi layar penuh di tablet kasir. Kode berganti tiap periode (20 detik) —
 * karyawan memindainya dengan kamera HP terdaftar. Foto QR yang dikirim ke orang lain
 * sudah basi sebelum sempat dipakai.
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
      .then((code) => QRCode.toDataURL(`${base}#c=${slot}.${code}`, { width: 560, margin: 2, errorCorrectionLevel: 'M' }))
      .then((url) => !cancelled && setImage(url))
    return () => {
      cancelled = true
    }
  }, [config, slot, base])

  const progress = config ? 1 - (now % config.periodMs) / config.periodMs : 0
  return (
    <Modal onClose={onClose} className="w-full max-w-lg rounded-2xl bg-ink-900 p-6 text-center">
      <h2 className="text-xl font-bold text-ink-50">QR Absensi</h2>
      <p className="mt-1 text-sm text-ink-300">Pindai dengan kamera HP yang sudah terdaftar, lalu ikuti petunjuk selfie.</p>
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

/** Pengaturan admin: selfie wajib/opsional, daftarkan & cabut HP karyawan. */
export function PhoneAttendanceSettings({ users, settings, actor }: { users: User[]; settings: AppSettings | undefined; actor: Actor }) {
  const [phones, setPhones] = useState<StaffPhone[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [enrolling, setEnrolling] = useState<User | null>(null)
  const selfieMode = settings?.attendancePhoneSelfie ?? 'required'

  const reload = useCallback(() => {
    if (!isBackendConfigured()) return setLoadError('Tablet belum tersambung ke server sinkronisasi — absen lewat HP butuh server.')
    listStaffPhones()
      .then((p) => {
        setPhones(p)
        setLoadError(null)
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Gagal memuat HP terdaftar.'))
  }, [])
  useEffect(reload, [reload])

  async function setSelfie(mode: 'required' | 'optional') {
    await updateSettings({ attendancePhoneSelfie: mode })
    await recordAuditLog({ ...actor, action: 'attendance.selfie_mode', entityType: 'settings', entityId: 'singleton', details: `Selfie absen lewat HP diatur ${mode === 'required' ? 'WAJIB' : 'OPSIONAL'}.` })
    toast.success(mode === 'required' ? 'Selfie sekarang wajib saat absen.' : 'Selfie sekarang opsional saat absen.')
  }

  async function revoke(phone: StaffPhone) {
    try {
      await revokeStaffPhone(phone.id)
      await recordAuditLog({ ...actor, action: 'attendance.phone_revoke', entityType: 'attendance', entityId: phone.userId, details: `HP absensi ${phone.userName} (${phone.label}) dicabut.` })
      toast.success(`HP ${phone.userName} dicabut.`)
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mencabut HP.')
    }
  }

  const byUser = new Map((phones ?? []).map((p) => [p.userId, p]))
  return (
    <div className="mt-8">
      <h2 className="mb-1 font-semibold text-ink-100">Absen lewat HP</h2>
      <p className="mb-3 text-sm text-ink-400">Tiap karyawan absen dari HP-nya sendiri: pindai QR Absensi di tablet ini, lalu selfie. Satu HP per karyawan.</p>
      <div className="card mb-3 flex flex-wrap items-center gap-3 p-4">
        <div className="mr-auto">
          <p className="font-medium text-ink-50">Selfie saat absen</p>
          <p className="text-xs text-ink-400">Wajib = absen ditolak tanpa foto wajah. Disarankan tetap wajib untuk mencegah titip absen.</p>
        </div>
        {(['required', 'optional'] as const).map((m) => (
          <button key={m} className={`btn btn-compact !px-4 text-sm ${selfieMode === m ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={selfieMode === m} onClick={() => void setSelfie(m)}>
            {m === 'required' ? 'Wajib' : 'Opsional'}
          </button>
        ))}
      </div>
      {loadError ? (
        <p className="card p-4 text-sm text-yellow-400">{loadError}</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-800 text-left text-ink-300">
              <tr>
                <th className="px-4 py-2">Karyawan</th>
                <th className="px-4 py-2">HP terdaftar</th>
                <th className="px-4 py-2">Terakhir dipakai</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const p = byUser.get(u.id)
                return (
                  <tr key={u.id} className="border-t border-ink-800">
                    <td className="px-4 py-2 text-ink-50">{u.name}</td>
                    <td className={`px-4 py-2 ${p ? 'text-ink-100' : 'text-ink-500'}`}>{phones == null ? '…' : p ? `${p.label} · sejak ${formatDateTime(p.createdAt)}` : 'Belum ada'}</td>
                    <td className="px-4 py-2 text-ink-300">{p?.lastUsedAt ? formatDateTime(p.lastUsedAt) : '—'}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      <button className="btn-secondary btn-compact !px-3 text-sm" onClick={() => setEnrolling(u)}>
                        {p ? 'Ganti HP' : 'Daftarkan HP'}
                      </button>
                      {p && (
                        <button className="btn-ghost btn-compact ml-2 !px-3 text-sm text-red-400" onClick={() => void revoke(p)}>
                          Cabut
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {enrolling && (
        <EnrollPhoneModal
          user={enrolling}
          settings={settings}
          actor={actor}
          onClose={() => {
            setEnrolling(null)
            reload()
          }}
        />
      )}
    </div>
  )
}

function EnrollPhoneModal({ user, settings, actor: actorProp, onClose }: { user: User; settings: AppSettings | undefined; actor: Actor; onClose: () => void }) {
  // Dibekukan saat modal dibuka: tiap render induk membuat objek actor baru, dan efek
  // di bawah tak boleh berjalan ulang (setiap jalan = satu tautan pendaftaran baru).
  const [actor] = useState(actorProp)
  const [image, setImage] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const base = attendancePageBase(settings)

  useEffect(() => {
    if (!base) return setError('Alamat publik belum diatur (Pengaturan → Sinkronisasi atau URL QR meja).')
    let cancelled = false
    void (async () => {
      try {
        const { token, expiresAt } = await createStaffPhoneEnrollment({ userId: user.id, userName: user.name, createdBy: actor.userName })
        await recordAuditLog({ ...actor, action: 'attendance.phone_enroll', entityType: 'attendance', entityId: user.id, details: `Tautan pendaftaran HP absensi dibuat untuk ${user.name}.` })
        const url = await QRCode.toDataURL(`${base}#d=${token}`, { width: 520, margin: 2, errorCorrectionLevel: 'M' })
        if (cancelled) return
        setImage(url)
        setExpiresAt(expiresAt)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Gagal membuat tautan pendaftaran.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [base, user, actor])

  return (
    <Modal onClose={onClose} className="w-full max-w-md rounded-2xl bg-ink-900 p-6 text-center">
      <h2 className="text-lg font-bold text-ink-50">Daftarkan HP · {user.name}</h2>
      <p className="mt-1 text-sm text-ink-300">
        Minta <b>{user.name}</b> memindai QR ini dengan kamera HP-nya sendiri, lalu ketuk “Daftarkan HP Ini”. HP lama (bila ada) otomatis tidak berlaku.
      </p>
      {error ? (
        <p className="my-8 text-sm text-red-400">{error}</p>
      ) : (
        <div className="mx-auto mt-4 aspect-square w-full max-w-[18rem] rounded-2xl bg-white p-2">{image && <img src={image} alt="QR pendaftaran HP" className="h-full w-full" />}</div>
      )}
      {expiresAt && <p className="mt-2 text-xs text-ink-400">Sekali pakai · berlaku sampai {formatTime(expiresAt)}</p>}
      <button className="btn-secondary mt-5 w-full" onClick={onClose}>
        Selesai
      </button>
    </Modal>
  )
}
