import { create } from 'zustand'
import type { ConfirmDialogProps } from '@/components/ui/ConfirmDialog'

export type ConfirmOptions = Omit<ConfirmDialogProps, 'onCancel' | 'onConfirm'>

interface PendingConfirm extends ConfirmOptions {
  id: number
  resolve: (ok: boolean) => void
}

interface ConfirmState {
  queue: PendingConfirm[]
  open: (options: ConfirmOptions) => Promise<boolean>
  settle: (id: number, ok: boolean) => void
}

let nextId = 1

/** Antrean dialog konfirmasi global (lihat `notify.confirm` & ConfirmHost). Satu tampil sekaligus. */
export const useConfirmStore = create<ConfirmState>((set, get) => ({
  queue: [],
  open: (options) =>
    new Promise<boolean>((resolve) => {
      set((s) => ({ queue: [...s.queue, { ...options, id: nextId++, resolve }] }))
    }),
  settle: (id, ok) => {
    const item = get().queue.find((p) => p.id === id)
    if (!item) return
    set((s) => ({ queue: s.queue.filter((p) => p.id !== id) }))
    item.resolve(ok)
  },
}))
