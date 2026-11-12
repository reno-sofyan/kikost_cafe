import { create } from 'zustand'
import type { User } from '@/types/domain'
import { useDeveloperStore } from '@/state/developerStore'

interface SessionState {
  currentUser: User | null
  isLocked: boolean
  lastActivityAt: number
  login: (user: User) => void
  logout: () => void
  lock: () => void
  unlock: () => void
  touchActivity: () => void
}

export const useSessionStore = create<SessionState>((set) => ({
  currentUser: null,
  isLocked: false,
  lastActivityAt: Date.now(),
  // Mode Developer tak pernah terbawa ke sesi lain: berganti akun, keluar, atau layar
  // terkunci = Mode Developer ikut terkunci.
  login: (user) => {
    useDeveloperStore.getState().lock()
    set({ currentUser: user, isLocked: false, lastActivityAt: Date.now() })
  },
  logout: () => {
    useDeveloperStore.getState().lock()
    set({ currentUser: null, isLocked: false })
  },
  lock: () => {
    useDeveloperStore.getState().lock()
    set({ isLocked: true })
  },
  unlock: () => set({ isLocked: false, lastActivityAt: Date.now() }),
  touchActivity: () => set({ lastActivityAt: Date.now() }),
}))
