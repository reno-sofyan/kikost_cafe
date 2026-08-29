import { create } from 'zustand'
import type { User } from '@/types/domain'

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
  login: (user) => set({ currentUser: user, isLocked: false, lastActivityAt: Date.now() }),
  logout: () => set({ currentUser: null, isLocked: false }),
  lock: () => set({ isLocked: true }),
  unlock: () => set({ isLocked: false, lastActivityAt: Date.now() }),
  touchActivity: () => set({ lastActivityAt: Date.now() }),
}))
