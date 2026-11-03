import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import {
  challengeMessage,
  generatePhoneKey,
  loadIdentity,
  locationText,
  phoneLabel,
  punchMessage,
  saveIdentity,
  sha256Hex,
  signMessage,
  type PhoneIdentity,
  type PunchLocation,
} from '@/features/absen/absenCrypto'

/**
 * Halaman absen karyawan di HP sendiri: `/absen`. Publik, tanpa login/Dexie/sync.
 *  - `/absen#d=<token>` — tautan pendaftaran dari tablet (admin) → HP ini didaftarkan.
 *  - `/absen#c=<qr>`    — QR absensi yang dipindai dari tablet kasir → selfie → absen.
 * Fragmen URL langsung dihapus agar tak terpakai ulang saat halaman dimuat lagi.
 */

interface Challenge {
  challengeId: string
  type: 'in' | 'out'
  userName: string
  businessName: string
  selfieRequired: boolean
  clockedInSince: number | null
  expiresAt: number
}

interface PunchDone {
  type: 'in' | 'out'
  at: number
  userName: string
  minutes: number
}

type Screen =
  | { kind: 'loading' }
  | { kind: 'idle'; identity: PhoneIdentity | null }
  | { kind: 'enroll'; token: string; existing: PhoneIdentity | null }
  | { kind: 'enrolled'; identity: PhoneIdentity }
  | { kind: 'punch'; identity: PhoneIdentity; challenge: Challenge }
  | { kind: 'done'; result: PunchDone; identity: PhoneIdentity }
  | { kind: 'error'; message: string; identity: PhoneIdentity | null }

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

export function AbsenApp() {
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' })
  // Dibaca saat render pertama, sebelum efek di bawah menghapus fragmen dari bilah alamat
  // (efek bisa berjalan dua kali di StrictMode; fragmen sudah kosong di jalan kedua).
  const [params] = useState(() => new URLSearchParams(window.location.hash.slice(1)))

  useEffect(() => {
    if (window.location.hash) history.replaceState(null, '', window.location.pathname)
    let cancelled = false
    const show = (s: Screen) => !cancelled && setScreen(s)
    void (async () => {
      const identity = await loadIdentity()
      const enrollToken = params.get('d')
      const qr = params.get('c')
      if (enrollToken) return show({ kind: 'enroll', token: enrollToken, existing: identity })
      if (!qr) return show({ kind: 'idle', identity })
      if (!identity) return show({ kind: 'error', identity: null, message: 'HP ini belum terdaftar untuk absensi. Minta admin mendaftarkan HP Anda dari tablet kasir (menu Absensi).' })
      try {
        const challenge = await postJson<Challenge>('/api/absen/challenge', { phoneId: identity.phoneId, qr, signature: await signMessage(identity.privateKey, challengeMessage(identity.phoneId, qr)) })
        show({ kind: 'punch', identity, challenge })
      } catch (e) {
        show({ kind: 'error', identity, message: e instanceof Error ? e.message : 'Gagal memulai absen.' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [params])

  // Memindai QR berikutnya sering membuka tab /absen yang sama — hanya fragmen yang
  // berubah, tanpa muat ulang. Muat ulang supaya QR baru diproses dari awal.
  useEffect(() => {
    const onHash = () => {
      if (/[#&](c|d)=/.test(window.location.hash)) window.location.reload()
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return (
    <div className="min-h-full bg-white text-ink-50">
      <div className="mx-auto max-w-md px-4 pb-12 pt-6">
        <header className="mb-5 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">
            <Icon name="clock" size={18} />
          </span>
          <div>
            <p className="text-base font-bold leading-tight">Absensi Karyawan</p>
            <p className="text-xs text-ink-400">{screenBusiness(screen) || 'Kione POS'}</p>
          </div>
        </header>
        {screen.kind === 'loading' && <p className="mt-24 text-center text-ink-400">Memuat…</p>}
        {screen.kind === 'idle' && <Idle identity={screen.identity} />}
        {screen.kind === 'enroll' && <Enroll token={screen.token} existing={screen.existing} onDone={(identity) => setScreen({ kind: 'enrolled', identity })} />}
        {screen.kind === 'enrolled' && (
          <section className="card p-5 text-center">
            <Icon name="check" size={36} className="mx-auto text-success-600" />
            <h1 className="mt-2 text-lg font-bold">HP terdaftar</h1>
            <p className="mt-1 text-sm text-ink-300">
              HP ini sekarang dipakai absensi <b className="text-ink-50">{screen.identity.userName}</b>.
            </p>
            <HowTo />
          </section>
        )}
        {screen.kind === 'punch' && <Punch identity={screen.identity} challenge={screen.challenge} onDone={(result) => setScreen({ kind: 'done', result, identity: screen.identity })} />}
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

function screenBusiness(screen: Screen): string | null {
  if (screen.kind === 'punch') return screen.challenge.businessName
  if ('identity' in screen && screen.identity) return screen.identity.businessName
  return null
}

function HowTo() {
  return (
    <p className="mt-4 rounded-xl bg-ink-950 p-3 text-left text-sm text-ink-300">
      Untuk absen: buka <b className="text-ink-100">kamera HP</b>, arahkan ke <b className="text-ink-100">QR Absensi</b> yang tampil di tablet kasir, lalu buka tautannya. QR berganti tiap
      beberapa detik, jadi pindai langsung di tempat.
    </p>
  )
}

function Idle({ identity }: { identity: PhoneIdentity | null }) {
  return (
    <section className="card p-5">
      {identity ? (
        <p className="text-sm text-ink-300">
          HP ini terdaftar untuk absensi <b className="text-ink-50">{identity.userName}</b>.
        </p>
      ) : (
        <p className="text-sm text-ink-300">HP ini belum terdaftar. Minta admin mendaftarkan HP Anda dari tablet kasir (menu Absensi → Absen lewat HP).</p>
      )}
      <HowTo />
    </section>
  )
}

function Enroll({ token, existing, onDone }: { token: string; existing: PhoneIdentity | null; onDone: (identity: PhoneIdentity) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function enroll() {
    setBusy(true)
    setError(null)
    try {
      if (!window.isSecureContext || !crypto.subtle) throw new Error('Browser ini tidak mendukung absensi aman. Buka lewat Chrome atau Safari terbaru.')
      const { privateKey, publicJwk } = await generatePhoneKey()
      const res = await postJson<{ phoneId: string; userName: string; businessName: string }>('/api/absen/enroll', { token, publicKey: publicJwk, label: phoneLabel() })
      const identity: PhoneIdentity = { phoneId: res.phoneId, userName: res.userName, businessName: res.businessName, privateKey }
      await saveIdentity(identity)
      onDone(identity)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pendaftaran gagal.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card p-5">
      <h1 className="text-lg font-bold">Daftarkan HP ini untuk absensi</h1>
      <p className="mt-2 text-sm text-ink-300">
        Setelah terdaftar, absen hanya bisa dilakukan dari HP & browser ini. Pakai HP milik Anda sendiri — jangan daftarkan HP orang lain.
      </p>
      {existing && <p className="mt-2 text-sm text-yellow-700">HP ini sebelumnya terdaftar untuk {existing.userName}. Pendaftaran baru akan menggantikannya.</p>}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <button className="btn-primary mt-4 w-full" disabled={busy} onClick={() => void enroll()}>
        {busy ? 'Mendaftarkan…' : 'Daftarkan HP Ini'}
      </button>
    </section>
  )
}

function Punch({ identity, challenge, onDone }: { identity: PhoneIdentity; challenge: Challenge; onDone: (r: PunchDone) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [camera, setCamera] = useState<'starting' | 'on' | 'failed'>('starting')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
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
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      cancelled = true
      clearInterval(t)
      stream?.getTracks().forEach((tr) => tr.stop())
    }
  }, [])

  const secondsLeft = Math.max(0, Math.round((challenge.expiresAt - now) / 1000))
  const expired = secondsLeft === 0

  /** Foto langsung dari video kamera (bukan galeri), diperkecil ke JPEG ±40 KB. */
  function captureSelfie(): Promise<Uint8Array<ArrayBuffer>> {
    const video = videoRef.current!
    const width = 480
    const height = Math.round((video.videoHeight / video.videoWidth) * width) || 640
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')!.drawImage(video, 0, 0, width, height)
    return new Promise((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? void blob.arrayBuffer().then((b) => resolve(new Uint8Array(b))) : reject(new Error('Gagal mengambil foto.'))), 'image/jpeg', 0.72),
    )
  }

  async function submit(withSelfie: boolean) {
    setBusy(true)
    setError(null)
    try {
      const selfie = withSelfie ? await captureSelfie() : null
      const loc = await location.current
      const selfieB64 = selfie ? btoa(Array.from(selfie, (b) => String.fromCharCode(b)).join('')) : null
      const signature = await signMessage(identity.privateKey, punchMessage(challenge.challengeId, selfie ? await sha256Hex(selfie) : '-', locationText(loc)))
      onDone(await postJson<PunchDone>('/api/absen/punch', { phoneId: identity.phoneId, challengeId: challenge.challengeId, selfie: selfieB64, location: loc, signature }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Absen gagal.')
    } finally {
      setBusy(false)
    }
  }

  const label = challenge.type === 'in' ? 'Absen Masuk' : 'Absen Pulang'
  return (
    <section>
      <div className="mb-3">
        <h1 className="text-xl font-bold">
          {label} · {challenge.userName}
        </h1>
        {challenge.clockedInSince != null && <p className="text-sm text-ink-400">Masuk sejak {fmtTime(challenge.clockedInSince)} WIB</p>}
      </div>
      <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />
        {camera !== 'on' && (
          <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white">
            {camera === 'starting' ? 'Menyalakan kamera depan…' : 'Kamera tidak bisa dibuka. Izinkan akses kamera untuk situs ini di pengaturan browser, lalu pindai QR lagi.'}
          </p>
        )}
      </div>
      <p className={`mt-2 text-center text-xs ${secondsLeft < 30 ? 'text-red-600' : 'text-ink-400'}`}>
        {expired ? 'Waktu habis — pindai QR di tablet lagi.' : `Sisa waktu ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`}
      </p>
      {error && <p className="mt-2 text-center text-sm text-red-600">{error}</p>}
      <button className="btn-primary mt-3 w-full !min-h-[3.25rem] text-base" disabled={busy || expired || camera !== 'on'} onClick={() => void submit(true)}>
        {busy ? 'Mengirim…' : `Ambil Selfie & ${label}`}
      </button>
      {!challenge.selfieRequired && (
        <button className="btn-ghost mt-2 w-full" disabled={busy || expired} onClick={() => void submit(false)}>
          {label} tanpa selfie
        </button>
      )}
      <p className="mt-4 text-center text-xs text-ink-400">Waktu absen memakai jam server. Foto & lokasi hanya dilihat pengelola {challenge.businessName}.</p>
    </section>
  )
}
