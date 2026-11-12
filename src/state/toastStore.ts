import { create } from 'zustand'
import { randomUUID } from '@/lib/id'

export type ToastTone = 'info' | 'success' | 'warning' | 'error'

export interface ToastAction {
  label: string
  onAction: () => void
}

export interface Toast {
  id: string
  message: string
  tone: ToastTone
  /** ms sebelum otomatis hilang; 0 = tidak auto-dismiss (ditutup manual). */
  duration: number
  /** Tombol aksi opsional, mis. "Coba lagi". */
  action?: ToastAction
  /** Dijalankan saat toast diketuk (selain menutupnya), mis. muat ulang ke versi baru. */
  onTap?: () => void
  createdAt: number
}

/** Durasi bawaan per jenis: sukses singkat, peringatan lebih lama, error menetap sampai ditutup. */
export const TOAST_DURATION: Record<ToastTone, number> = { success: 2500, info: 3000, warning: 4000, error: 0 }
/** Toast yang tampil bersamaan; sisanya antre dan muncul begitu ada yang hilang. */
export const MAX_VISIBLE_TOASTS = 3
/** Pesan yang sama (jenis + teks) dalam selang ini tidak ditampilkan dua kali. */
export const TOAST_DEDUPE_MS = 3000

export interface PushToastInput {
  message: string
  tone: ToastTone
  duration?: number
  action?: ToastAction
  onTap?: () => void
}

interface ToastState {
  /** Urut masuk; yang tampil = `MAX_VISIBLE_TOASTS` pertama (lihat `visibleToasts`). */
  toasts: Toast[]
  push: (input: PushToastInput) => string
  dismiss: (id: string) => void
  clear: () => void
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: ({ message, tone, duration, action, onTap }) => {
    const now = Date.now()
    const dup = get().toasts.find((t) => t.tone === tone && t.message === message && now - t.createdAt < TOAST_DEDUPE_MS)
    if (dup) return dup.id
    const toast: Toast = { id: randomUUID(), message, tone, duration: duration ?? TOAST_DURATION[tone], action, onTap, createdAt: now }
    set((state) => ({ toasts: [...state.toasts, toast] }))
    return toast.id
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}))

export function visibleToasts(toasts: Toast[]): Toast[] {
  return toasts.slice(0, MAX_VISIBLE_TOASTS)
}

/**
 * API lama — tetap dipakai ~120 tempat; kini lewat antrean yang sama dengan `notify`
 * (src/lib/notify.ts). `error` sekarang menetap sampai ditutup.
 */
export const toast = {
  show: (message: string, duration?: number) => useToastStore.getState().push({ message, tone: 'info', duration }),
  success: (message: string, duration?: number) => useToastStore.getState().push({ message, tone: 'success', duration }),
  warning: (message: string, duration?: number) => useToastStore.getState().push({ message, tone: 'warning', duration }),
  error: (message: string, duration?: number) => useToastStore.getState().push({ message, tone: 'error', duration }),
  /** Toast menetap yang menjalankan `onTap` saat diketuk. */
  action: (message: string, onTap: () => void) => useToastStore.getState().push({ message, tone: 'info', duration: 0, onTap }),
}
