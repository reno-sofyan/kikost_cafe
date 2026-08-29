import { create } from 'zustand'

interface PosState {
  activeOrderId: string | null
  setActiveOrderId: (orderId: string | null) => void
}

export const usePosStore = create<PosState>((set) => ({
  activeOrderId: null,
  setActiveOrderId: (orderId) => set({ activeOrderId: orderId }),
}))
