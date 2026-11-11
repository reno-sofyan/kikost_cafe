import { useEffect, useRef } from 'react'
import { readWedgeConfig, WEDGE_CONFIG_EVENT, WedgeDetector, type WedgeScan } from '@/lib/barcodeWedge'
import { useScannerStore } from '@/state/scannerStore'

export interface ScanContext {
  /** Elemen yang sedang fokus saat kode masuk — karakter pindaian ikut terketik bila ia kolom isian. */
  target: Element | null
  scan: WedgeScan
}

/**
 * Menangkap pemindai barcode USB (mode keyboard) di mana pun fokus berada, jadi kasir
 * tak perlu mengetuk kolom cari dulu. Tombol akhiran (Enter/Tab) ditelan supaya tak
 * "menekan" tombol yang sedang fokus atau mengirim formulir.
 *
 * - Kolom bertanda `data-scan-input` menangani pindaiannya sendiri (lewat Enter) — hanya dicatat
 *   sebagai tanda pemindai bekerja, tidak dicegat.
 * - Saat dialog (`Modal`) terbuka, hook halaman diam; dialog yang butuh pemindai memakai
 *   `{ inModal: true }`.
 */
export function useBarcodeScanner(onScan: (code: string, ctx: ScanContext) => void, options: { enabled?: boolean; inModal?: boolean } = {}): void {
  const { enabled = true, inModal = false } = options
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  useEffect(() => {
    if (!enabled) return
    const detector = new WedgeDetector(readWedgeConfig())
    const reload = () => {
      detector.config = readWedgeConfig()
    }
    let idleTimer: ReturnType<typeof setTimeout> | null = null

    const inScope = (el: Element | null): boolean => {
      const modals = document.querySelectorAll('[data-modal]')
      if (!inModal) return modals.length === 0
      // Dialog teratas yang menerima — termasuk saat fokus masih di tombol di belakangnya (mis. tombol Scan).
      const top = modals[modals.length - 1]
      return !!top && (!el || top.contains(el) || !el.closest('[data-modal]'))
    }

    const emit = (result: ReturnType<WedgeDetector['key']>, target: Element | null): boolean => {
      if (result.kind === 'none') return false
      useScannerStore.getState().record(result.scan.code)
      // Kolom bertanda `data-scan-input` memproses pindaiannya sendiri lewat Enter.
      if (target?.closest('[data-scan-input]')) return false
      if (result.kind === 'scan') onScanRef.current(result.scan.code, { target, scan: result.scan })
      return true
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
      const target = e.target instanceof Element ? e.target : null
      if (!inScope(target)) {
        detector.reset()
        return
      }
      if (emit(detector.key(e.key, performance.now()), target)) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (detector.config.terminator === 'none' && e.key.length === 1) {
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => emit(detector.idle(performance.now()), target), detector.config.maxGapMs * 3)
      }
    }

    // Fase capture di window: berjalan sebelum handler Enter milik halaman/tombol.
    window.addEventListener('keydown', onKey, true)
    window.addEventListener(WEDGE_CONFIG_EVENT, reload)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener(WEDGE_CONFIG_EVENT, reload)
      if (idleTimer) clearTimeout(idleTimer)
    }
  }, [enabled, inModal])
}
