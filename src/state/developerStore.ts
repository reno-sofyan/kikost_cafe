import { create } from 'zustand'

interface DeveloperState {
  /** Mode Developer aktif. Hanya di memori: keluar akun, layar terkunci, atau aplikasi dimuat ulang = terkunci. */
  unlocked: boolean
  unlock: () => void
  lock: () => void
}

export const useDeveloperStore = create<DeveloperState>((set) => ({
  unlocked: false,
  unlock: () => set({ unlocked: true }),
  lock: () => set({ unlocked: false }),
}))

/** Hook: true selama Mode Developer aktif. */
export function useDeveloperUnlocked(): boolean {
  return useDeveloperStore((s) => s.unlocked)
}
