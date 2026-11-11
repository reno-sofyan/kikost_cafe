import { Icon } from '@/components/ui/Icon'
import { useScannerStore } from '@/state/scannerStore'

/** Tombol "Scan" ritel: membuka panel alat pemindai; titik hijau = alat sudah terbaca di sesi ini. */
export function ScanButton({ onClick, className = '' }: { onClick: () => void; className?: string }) {
  const ready = useScannerStore((s) => !!s.lastScan)
  return (
    <button className={`btn-primary relative flex-none !rounded-xl ${className}`} onClick={onClick} title={ready ? 'Pemindai barcode tersambung' : 'Pindai dengan alat pemindai barcode'}>
      <Icon name="barcode" size={18} /> Scan
      {ready && <span aria-label="Pemindai tersambung" className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-success-500" />}
    </button>
  )
}
