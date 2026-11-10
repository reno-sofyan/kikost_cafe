import { useEffect, useRef, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Icon } from '@/components/ui/Icon'

interface DetectedBarcode {
  rawValue: string
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code']

function detectorCtor(): BarcodeDetectorCtor | null {
  return (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector ?? null
}

/**
 * Pindai barcode dengan kamera belakang (BarcodeDetector bawaan Chrome/WebView
 * Android). Perangkat tanpa dukungan tetap bisa mengetik kode manual — pemindai
 * USB/Bluetooth cukup diarahkan ke kolom pencarian, tak perlu modal ini.
 */
export function BarcodeScanModal({ onDetected, onClose, title = 'Scan Barcode' }: { onDetected: (code: string) => void; onClose: () => void; title?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<'starting' | 'scanning' | 'unsupported' | 'denied'>(() => (detectorCtor() ? 'starting' : 'unsupported'))
  const [manual, setManual] = useState('')
  const doneRef = useRef(false)
  const onDetectedRef = useRef(onDetected)
  onDetectedRef.current = onDetected

  useEffect(() => {
    const Ctor = detectorCtor()
    if (!Ctor) return
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    const detector = new Ctor({ formats: FORMATS })

    async function tick() {
      if (stopped || doneRef.current) return
      const video = videoRef.current
      if (video && video.readyState >= 2) {
        try {
          const found = await detector.detect(video)
          const code = found.find((b) => b.rawValue.trim())?.rawValue.trim()
          if (code && !doneRef.current) {
            doneRef.current = true
            navigator.vibrate?.(60)
            onDetectedRef.current(code)
            return
          }
        } catch {
          /* bingkai belum siap — coba lagi */
        }
      }
      timer = setTimeout(() => void tick(), 180)
    }

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        if (stopped) return stream.getTracks().forEach((t) => t.stop())
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        setStatus('scanning')
        void tick()
      } catch {
        setStatus('denied')
      }
    })()

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  function submitManual() {
    const code = manual.trim()
    if (code) onDetected(code)
  }

  return (
    <Modal onClose={onClose} className="w-full max-w-md rounded-2xl bg-ink-900 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold text-ink-50">{title}</h2>
        <button className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-300 hover:bg-ink-800" aria-label="Tutup" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>
      {status !== 'unsupported' && status !== 'denied' && (
        <div className="relative mb-3 aspect-[4/3] overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
          {status === 'starting' && <p className="absolute inset-0 flex items-center justify-center text-sm text-white/80">Membuka kamera…</p>}
        </div>
      )}
      {status === 'unsupported' && (
        <p className="mb-3 rounded-xl bg-ink-800 p-3 text-sm text-ink-200">
          Kamera pemindai tidak didukung di perangkat ini. Gunakan pemindai barcode USB/Bluetooth di kolom pencarian, atau ketik kodenya di bawah.
        </p>
      )}
      {status === 'denied' && (
        <p className="mb-3 rounded-xl bg-red-900 p-3 text-sm text-red-400">Kamera tidak bisa dibuka (izin ditolak atau sedang dipakai). Ketik kodenya di bawah.</p>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          submitManual()
        }}
      >
        <input
          className="input-field"
          inputMode="numeric"
          placeholder="Ketik barcode / SKU"
          value={manual}
          autoFocus={status === 'unsupported' || status === 'denied'}
          onChange={(e) => setManual(e.target.value)}
        />
        <button type="submit" className="btn-primary flex-none" disabled={!manual.trim()}>
          Cari
        </button>
      </form>
    </Modal>
  )
}
