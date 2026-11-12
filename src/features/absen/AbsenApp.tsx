import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/ui/Icon'

/**
 * Halaman absen karyawan di HP: `/absen`. Publik, tanpa login/Dexie/sync, dan HP tidak
 * perlu didaftarkan. `/absen#c=<qr>` = QR absensi yang dipindai dari tablet kasir →
 * pilih nama → PIN → selfie → absen. Fragmen URL langsung dihapus agar tak terpakai
 * ulang saat halaman dimuat lagi.
 */

interface Session {
  challengeId: string
  businessName: string
  selfieRequired: boolean
  staff: { userId: string; userName: string }[]
  expiresAt: number
}

interface Identified {
  type: 'in' | 'out'
  userName: string
  clockedInSince: number | null
}

interface PunchDone {
  type: 'in' | 'out'
  at: number
  userName: string
  minutes: number
}

interface PunchLocation {
  latitude: number
  longitude: number
  accuracy: number
}

type Screen =
  | { kind: 'loading' }
  | { kind: 'idle' }
  | { kind: 'pick'; session: Session }
  | { kind: 'punch'; session: Session; who: Identified }
  | { kind: 'done'; result: PunchDone; businessName: string }
  | { kind: 'error'; message: string }

const fmtTime = (ms: number) => new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }).format(ms)
const fmtDate = (ms: number) => new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long' }).format(ms)
const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} jam ${m % 60} mnt` : `${m} mnt`)

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = (await r.json().catch(() => ({}))) as T & { error?: string }
  if (!r.ok) throw new Error(data.error || `Server tidak dapat dihubungi (HTTP ${r.status}).`)
  return data
}

/** Lokasi saat absen, bila diizinkan — hanya catatan untuk Pemilik, bukan syarat. */
function getLocation(): Promise<PunchLocation | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null)
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    )
  })
}

/** Sisa detik sesi absen, diperbarui tiap detik. */
function useSecondsLeft(expiresAt: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return Math.max(0, Math.round((expiresAt - now) / 1000))
}

function Countdown({ secondsLeft }: { secondsLeft: number }) {
  return (
    <p className={`mt-2 text-center text-xs ${secondsLeft < 30 ? 'text-red-600' : 'text-ink-400'}`}>
      {secondsLeft === 0 ? 'Waktu habis — pindai QR di tablet lagi.' : `Sisa waktu ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`}
    </p>
  )
}

export function AbsenApp() {
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' })
  // Dibaca saat render pertama, sebelum efek di bawah menghapus fragmen dari bilah alamat
  // (efek bisa berjalan dua kali di StrictMode; fragmen sudah kosong di jalan kedua).
  const [qr] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('c'))

  useEffect(() => {
    if (window.location.hash) history.replaceState(null, '', window.location.pathname)
    if (!qr) return setScreen({ kind: 'idle' })
    let cancelled = false
    postJson<Session>('/api/absen/start', { qr })
      .then((session) => !cancelled && setScreen({ kind: 'pick', session }))
      .catch((e) => !cancelled && setScreen({ kind: 'error', message: e instanceof Error ? e.message : 'Gagal memulai absen.' }))
    return () => {
      cancelled = true
    }
  }, [qr])

  // Memindai QR berikutnya sering membuka tab /absen yang sama — hanya fragmen yang
  // berubah, tanpa muat ulang. Muat ulang supaya QR baru diproses dari awal.
  useEffect(() => {
    const onHash = () => {
      if (/[#&]c=/.test(window.location.hash)) window.location.reload()
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const business = screen.kind === 'pick' || screen.kind === 'punch' ? screen.session.businessName : screen.kind === 'done' ? screen.businessName : null
  return (
    <div className="min-h-full bg-white text-ink-50">
      <div className="mx-auto max-w-md px-4 pb-12 pt-6">
        <header className="mb-5 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">
            <Icon name="clock" size={18} />
          </span>
          <div>
            <p className="text-base font-bold leading-tight">Absensi Karyawan</p>
            <p className="text-xs text-ink-400">{business || 'Kione POS'}</p>
          </div>
        </header>
        {screen.kind === 'loading' && <p className="mt-24 text-center text-ink-400">Memuat…</p>}
        {screen.kind === 'idle' && (
          <section className="card p-5">
            <HowTo />
          </section>
        )}
        {screen.kind === 'pick' && <PickStaff session={screen.session} onDone={(who) => setScreen({ kind: 'punch', session: screen.session, who })} />}
        {screen.kind === 'punch' && (
          <Punch session={screen.session} who={screen.who} onDone={(result) => setScreen({ kind: 'done', result, businessName: screen.session.businessName })} />
        )}
        {screen.kind === 'done' && (
          <section className="card p-6 text-center">
            <span className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${screen.result.type === 'in' ? 'bg-success-600' : 'bg-brand-600'} text-white`}>
              <Icon name="check" size={34} />
            </span>
            <h1 className="mt-3 text-xl font-bold">{screen.result.type === 'in' ? 'Absen masuk tercatat' : 'Absen pulang tercatat'}</h1>
            <p className="mt-1 text-4xl font-bold tabular-nums">{fmtTime(screen.result.at)}</p>
            <p className="text-sm text-ink-400">{fmtDate(screen.result.at)} · WIB</p>
            <p className="mt-3 text-sm text-ink-300">
              {screen.result.userName}
              {screen.result.type === 'out' ? ` · bekerja ${fmtMinutes(screen.result.minutes)}` : ' · selamat bekerja!'}
            </p>
          </section>
        )}
        {screen.kind === 'error' && (
          <section className="card p-5 text-center">
            <p className="text-base font-semibold text-red-600">Absen belum berhasil</p>
            <p className="mt-2 text-sm text-ink-300">{screen.message}</p>
            <HowTo />
          </section>
        )}
      </div>
    </div>
  )
}

function HowTo() {
  return (
    <p className="mt-4 rounded-xl bg-ink-950 p-3 text-left text-sm text-ink-300">
      Untuk absen: buka <b className="text-ink-100">kamera HP</b>, arahkan ke <b className="text-ink-100">QR Absensi</b> yang tampil di tablet kasir, lalu buka tautannya. QR berganti tiap
      beberapa detik, jadi pindai langsung di tempat.
    </p>
  )
}

/** Langkah 1: pilih nama sendiri, lalu masukkan PIN (sama dengan PIN masuk ke aplikasi kasir). */
function PickStaff({ session, onDone }: { session: Session; onDone: (who: Identified) => void }) {
  const [userId, setUserId] = useState<string | null>(session.staff.length === 1 ? session.staff[0].userId : null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const secondsLeft = useSecondsLeft(session.expiresAt)
  const pinRef = useRef<HTMLInputElement>(null)
  const selected = session.staff.find((s) => s.userId === userId)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!userId) return
    setBusy(true)
    setError(null)
    try {
      onDone(await postJson<Identified>('/api/absen/identify', { challengeId: session.challengeId, userId, pin }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PIN tidak bisa diperiksa.')
      setPin('')
      pinRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)}>
      <h1 className="text-xl font-bold">Siapa Anda?</h1>
      <p className="mb-3 text-sm text-ink-400">Pilih nama Anda, lalu masukkan PIN yang biasa dipakai masuk ke aplikasi kasir.</p>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Nama karyawan">
        {session.staff.map((s) => (
          <button
            key={s.userId}
            type="button"
            aria-pressed={s.userId === userId}
            onClick={() => {
              setUserId(s.userId)
              setError(null)
              setTimeout(() => pinRef.current?.focus(), 0)
            }}
            className={`min-h-[3rem] truncate rounded-xl border px-3 text-left text-sm font-semibold ${
              s.userId === userId ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-700 bg-white text-ink-100'
            }`}
          >
            {s.userName}
          </button>
        ))}
      </div>
      {selected && (
        <label className="mt-4 block">
          <span className="mb-1 block text-sm text-ink-300">PIN {selected.userName}</span>
          <input
            ref={pinRef}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            className="input-field text-center text-2xl tracking-[0.5em]"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
            aria-label="PIN"
          />
        </label>
      )}
      {error && <p className="mt-2 text-center text-sm text-red-600">{error}</p>}
      <button type="submit" className="btn-primary mt-4 w-full !min-h-[3.25rem] text-base" disabled={busy || !selected || pin.length < 4 || secondsLeft === 0}>
        {busy ? 'Memeriksa…' : 'Lanjut'}
      </button>
      <Countdown secondsLeft={secondsLeft} />
    </form>
  )
}

/** Langkah 2: selfie dari kamera depan (+ lokasi bila diizinkan) → absen tercatat. */
function Punch({ session, who, onDone }: { session: Session; who: Identified; onDone: (r: PunchDone) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [camera, setCamera] = useState<'starting' | 'on' | 'failed'>('starting')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const secondsLeft = useSecondsLeft(session.expiresAt)
  const location = useRef<Promise<PunchLocation | null>>(Promise.resolve(null))

  useEffect(() => {
    location.current = getLocation()
    let stream: MediaStream | null = null
    let cancelled = false
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 } }, audio: false })
        if (cancelled) return stream.getTracks().forEach((t) => t.stop())
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
        }
        setCamera('on')
      } catch {
        if (!cancelled) setCamera('failed')
      }
    })()
    return () => {
      cancelled = true
      stream?.getTracks().forEach((tr) => tr.stop())
    }
  }, [])

  const expired = secondsLeft === 0

  /** Foto langsung dari video kamera (bukan galeri), diperkecil ke JPEG ±40 KB → base64. */
  function captureSelfie(): Promise<string> {
    const video = videoRef.current!
    const width = 480
    const height = Math.round((video.videoHeight / video.videoWidth) * width) || 640
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')!.drawImage(video, 0, 0, width, height)
    return new Promise((resolve, reject) => {
      const url = canvas.toDataURL('image/jpeg', 0.72)
      if (url.startsWith('data:image/jpeg;base64,')) resolve(url.slice('data:image/jpeg;base64,'.length))
      else reject(new Error('Gagal mengambil foto.'))
    })
  }

  async function submit(withSelfie: boolean) {
    setBusy(true)
    setError(null)
    try {
      const selfie = withSelfie ? await captureSelfie() : null
      onDone(await postJson<PunchDone>('/api/absen/punch', { challengeId: session.challengeId, selfie, location: await location.current }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Absen gagal.')
    } finally {
      setBusy(false)
    }
  }

  const label = who.type === 'in' ? 'Absen Masuk' : 'Absen Pulang'
  return (
    <section>
      <div className="mb-3">
        <h1 className="text-xl font-bold">
          {label} · {who.userName}
        </h1>
        {who.clockedInSince != null && <p className="text-sm text-ink-400">Masuk sejak {fmtTime(who.clockedInSince)} WIB</p>}
      </div>
      <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />
        {camera !== 'on' && (
          <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white">
            {camera === 'starting' ? 'Menyalakan kamera depan…' : 'Kamera tidak bisa dibuka. Izinkan akses kamera untuk situs ini di pengaturan browser, lalu pindai QR lagi.'}
          </p>
        )}
      </div>
      <Countdown secondsLeft={secondsLeft} />
      {error && <p className="mt-2 text-center text-sm text-red-600">{error}</p>}
      <button className="btn-primary mt-3 w-full !min-h-[3.25rem] text-base" disabled={busy || expired || camera !== 'on'} onClick={() => void submit(true)}>
        {busy ? 'Mengirim…' : `Ambil Selfie & ${label}`}
      </button>
      {!session.selfieRequired && (
        <button className="btn-ghost mt-2 w-full" disabled={busy || expired} onClick={() => void submit(false)}>
          {label} tanpa selfie
        </button>
      )}
      <p className="mt-4 text-center text-xs text-ink-400">Waktu absen memakai jam server. Foto & lokasi hanya dilihat pengelola {session.businessName}.</p>
    </section>
  )
}
