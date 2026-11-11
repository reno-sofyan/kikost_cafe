import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '@/components/ui/Modal'
import { Icon } from '@/components/ui/Icon'
import { formatTime } from '@/lib/datetime'
import { BarcodeScanModal } from '@/features/retail/BarcodeScanModal'
import { useBarcodeScanner } from '@/features/retail/useBarcodeScanner'
import { useScannerStore } from '@/state/scannerStore'

/**
 * Tombol "Scan": menunggu pindaian dari ALAT pemindai barcode (USB/Bluetooth mode
 * keyboard). Begitu kode masuk, dialog tertutup dan kode diteruskan. Kamera tablet
 * hanya cadangan bila alat tak tersedia.
 */
export function ScannerModal({ onDetected, onClose, title = 'Scan Barcode' }: { onDetected: (code: string) => void; onClose: () => void; title?: string }) {
  const navigate = useNavigate()
  const [camera, setCamera] = useState(false)
  const lastScan = useScannerStore((s) => s.lastScan)
  useBarcodeScanner((code) => onDetected(code), { inModal: true, enabled: !camera })

  if (camera) return <BarcodeScanModal title={title} onDetected={onDetected} onClose={() => setCamera(false)} />

  return (
    <Modal onClose={onClose} className="w-full max-w-md rounded-3xl bg-ink-900 p-6 text-center">
      <h2 className="text-xl font-semibold text-ink-50">{title}</h2>
      <div className="mx-auto my-6 flex h-24 w-24 items-center justify-center rounded-full bg-brand-600/12 text-brand-400">
        <Icon name="barcode" size={48} className="animate-pulse" />
      </div>
      <p className="text-lg font-semibold text-ink-100">Siap memindai</p>
      <p className="mt-1 text-sm text-ink-300">Arahkan barcode barang ke alat pemindai. Pada stand auto-sense, cukup sodorkan barangnya.</p>
      <p className={`mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${lastScan ? 'bg-success-600/15 text-success-500' : 'bg-ink-800 text-ink-300'}`}>
        <span className={`h-2 w-2 rounded-full ${lastScan ? 'bg-success-500' : 'bg-ink-400'}`} />
        {lastScan ? `Pemindai bekerja · terakhir ${formatTime(lastScan.at)}` : 'Belum ada pindaian dari alat di sesi ini'}
      </p>
      <div className="mt-6 grid grid-cols-2 gap-2">
        <button className="btn-secondary !rounded-xl text-sm" onClick={() => setCamera(true)}>
          Pakai kamera
        </button>
        <button className="btn-ghost !rounded-xl text-sm" onClick={onClose}>
          Tutup
        </button>
      </div>
      {!lastScan && (
        <button
          className="mt-3 text-sm font-medium text-brand-400 hover:underline"
          onClick={() => {
            onClose()
            navigate('/pengaturan?tab=pemindai')
          }}
        >
          Pemindai tidak merespons? Uji di Pengaturan →
        </button>
      )}
    </Modal>
  )
}
