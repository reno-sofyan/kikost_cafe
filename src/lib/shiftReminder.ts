import { jakartaDateKey } from '@/lib/datetime'

/**
 * Pengingat shift (kantin): setiap pukul 21.00 WIB, bila shift masih terbuka,
 * tanya kasir apakah shift dilanjutkan atau ditutup. "Lanjutkan" menunda sampai
 * pukul 21.00 berikutnya. Aplikasi yang tertutup saat 21.00 tetap menanyakannya
 * begitu dibuka lagi (mis. shift kemarin lupa ditutup, dibuka pagi ini).
 */
export const SHIFT_REMINDER_HOUR = 21

const JAKARTA_UTC_OFFSET_MS = 7 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** Waktu pengingat terakhir (21.00 WIB) yang sudah lewat, sampai dengan `now`. */
export function latestReminderAt(now: number): number {
  const [year, month, day] = jakartaDateKey(now).split('-').map(Number) as [number, number, number]
  const todayReminder = Date.UTC(year, month - 1, day, SHIFT_REMINDER_HOUR) - JAKARTA_UTC_OFFSET_MS
  return todayReminder <= now ? todayReminder : todayReminder - DAY_MS
}

/**
 * Tampilkan pengingat bila jam 21.00 terakhir jatuh SETELAH shift dibuka (shift
 * yang dibuka pukul 22.00 baru ditanya besok malam) dan belum dijawab sejak itu.
 */
export function shouldShowShiftReminder(params: { shiftOpenedAt: number; acknowledgedAt: number | null; now: number }): boolean {
  const reminderAt = latestReminderAt(params.now)
  if (params.shiftOpenedAt >= reminderAt) return false
  return params.acknowledgedAt == null || params.acknowledgedAt < reminderAt
}

const ackKey = (shiftId: string) => `kione.shiftReminderAck.${shiftId}`

/** Kapan pengingat untuk shift ini terakhir dijawab "Lanjutkan" di perangkat ini. */
export function getShiftReminderAck(shiftId: string): number | null {
  try {
    const raw = localStorage.getItem(ackKey(shiftId))
    return raw ? Number(raw) : null
  } catch {
    return null
  }
}

export function setShiftReminderAck(shiftId: string, at: number): void {
  try {
    localStorage.setItem(ackKey(shiftId), String(at))
  } catch {
    /* penyimpanan diblokir → pengingat muncul lagi menit berikutnya; tidak fatal */
  }
}
