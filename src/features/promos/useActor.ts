import { useSessionStore } from '@/state/sessionStore'

/** Pengguna yang sedang masuk, dalam bentuk pencatat aksi (Log Aktivitas). */
export function useActor() {
  const user = useSessionStore((s) => s.currentUser)!
  return { userId: user.id, userName: user.name }
}
