import { create } from 'zustand'

interface SyncState {
  isOnline: boolean
  isSyncing: boolean
  pendingCount: number
  failedCount: number
  lastSyncedAt: number | null
  lastError: string | null
  setOnline: (online: boolean) => void
  setSyncing: (syncing: boolean) => void
  setCounts: (pending: number, failed: number) => void
  setResult: (params: { success: boolean; error?: string }) => void
}

export const useSyncStore = create<SyncState>((set) => ({
  isOnline: navigator.onLine,
  isSyncing: false,
  pendingCount: 0,
  failedCount: 0,
  lastSyncedAt: null,
  lastError: null,
  setOnline: (online) => set({ isOnline: online }),
  setSyncing: (syncing) => set({ isSyncing: syncing }),
  setCounts: (pending, failed) => set({ pendingCount: pending, failedCount: failed }),
  setResult: ({ success, error }) =>
    set((state) => ({
      lastSyncedAt: success ? Date.now() : state.lastSyncedAt,
      lastError: success ? null : (error ?? 'Sinkronisasi gagal'),
    })),
}))
