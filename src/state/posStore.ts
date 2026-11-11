import { create } from 'zustand'

interface PosState {
  activeOrderId: string | null
  setActiveOrderId: (orderId: string | null) => void
  /** Kode yang dipindai di luar Kasir (mis. layar sukses bayar) — diproses begitu Kasir terbuka. */
  pendingScan: string | null
  setPendingScan: (code: string | null) => void
}

export const usePosStore = create<PosState>((set) => ({
  activeOrderId: null,
  setActiveOrderId: (orderId) => set({ activeOrderId: orderId }),
  pendingScan: null,
  setPendingScan: (code) => set({ pendingScan: code }),
}))
