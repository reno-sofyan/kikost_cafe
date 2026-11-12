import { create } from 'zustand'

/**
 * Preferensi umpan balik per perangkat (bukan per usaha — tiap tablet bisa beda):
 * getar ringan saat tombol ditekan, dan suara (belum dipakai; bawaan mati).
 * Disimpan di localStorage; gagal baca/tulis → pakai bawaan.
 */
interface UiPrefs {
  haptics: boolean
  sound: boolean
}

interface UiPrefsState extends UiPrefs {
  setHaptics: (on: boolean) => void
  setSound: (on: boolean) => void
}

const KEY = 'kione.uiPrefs'
const DEFAULTS: UiPrefs = { haptics: true, sound: false }

function load(): UiPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<UiPrefs>
    return { haptics: parsed.haptics !== false, sound: parsed.sound === true }
  } catch {
    return DEFAULTS
  }
}

function save(prefs: UiPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // Penyimpanan diblokir: preferensi berlaku sampai aplikasi ditutup saja.
  }
}

export const useUiPrefsStore = create<UiPrefsState>((set, get) => ({
  ...load(),
  setHaptics: (haptics) => {
    set({ haptics })
    save({ haptics, sound: get().sound })
  },
  setSound: (sound) => {
    set({ sound })
    save({ haptics: get().haptics, sound })
  },
}))
