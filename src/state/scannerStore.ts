import { create } from 'zustand'

interface ScannerState {
  /** Pindaian alat terakhir di sesi ini — tanda pemindai USB tersambung & bekerja. */
  lastScan: { code: string; at: number } | null
  record: (code: string) => void
}

export const useScannerStore = create<ScannerState>((set) => ({
  lastScan: null,
  record: (code) => set({ lastScan: { code, at: Date.now() } }),
}))
