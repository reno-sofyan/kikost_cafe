import { create } from 'zustand'

export type ToastTone = 'info' | 'success' | 'error'

export interface Toast {
  id: string
  message: string
  tone: ToastTone
  /** ms sebelum otomatis hilang; 0 = tidak auto-dismiss (butuh tap manual). */
  duration: number
}

interface ToastState {
  toasts: Toast[]
  push: (message: string, tone: ToastTone, duration: number) => string
  dismiss: (id: string) => void
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, tone, duration) => {
    const id = crypto.randomUUID()
    set((state) => ({ toasts: [...state.toasts, { id, message, tone, duration }] }))
    return id
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}))

/**
 * Notifikasi transien terpusat — pengganti `alert()` bawaan browser supaya
 * tampilannya konsisten dengan tema aplikasi di semua layar.
 * Bisa dipanggil dari mana saja (bukan hanya dalam komponen React).
 */
export const toast = {
  show: (message: string, duration = 4000) => useToastStore.getState().push(message, 'info', duration),
  success: (message: string, duration = 4000) => useToastStore.getState().push(message, 'success', duration),
  error: (message: string, duration = 6000) => useToastStore.getState().push(message, 'error', duration),
}
