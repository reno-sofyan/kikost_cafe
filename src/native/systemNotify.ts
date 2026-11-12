import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'

/**
 * Notifikasi sistem Android (muncul walau aplikasi di latar belakang). Di web dilewati
 * tanpa error; izin diminta saat pertama kali dibutuhkan. Tak pernah melempar error —
 * pengingat tak boleh mengganggu kasir.
 */
const SHIFT_REMINDER_ID = 2100

async function ready(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const current = await LocalNotifications.checkPermissions()
    if (current.display === 'granted') return true
    return (await LocalNotifications.requestPermissions()).display === 'granted'
  } catch {
    return false
  }
}

/** Jadwalkan "Shift masih berjalan" pada waktu `at` (menggantikan jadwal sebelumnya). */
export async function scheduleShiftReminder(at: number, body: string): Promise<void> {
  if (!(await ready())) return
  try {
    await LocalNotifications.cancel({ notifications: [{ id: SHIFT_REMINDER_ID }] })
    await LocalNotifications.schedule({
      notifications: [{ id: SHIFT_REMINDER_ID, title: 'Shift masih berjalan', body, schedule: { at: new Date(at), allowWhileIdle: true } }],
    })
  } catch {
    // abaikan: popup di dalam aplikasi tetap muncul
  }
}

export async function cancelShiftReminder(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await LocalNotifications.cancel({ notifications: [{ id: SHIFT_REMINDER_ID }] })
  } catch {
    // abaikan
  }
}

/** Notifikasi sistem segera (mis. pesanan QR baru, stok menipis). `id` sama = menggantikan yang lama. */
export async function notifySystemNow(id: number, title: string, body: string): Promise<void> {
  if (!(await ready())) return
  try {
    await LocalNotifications.schedule({ notifications: [{ id, title, body }] })
  } catch {
    // abaikan: info yang sama tetap tampil di dalam aplikasi
  }
}

export const SYSTEM_NOTIFICATION_IDS = { qrOrder: 2200, lowStock: 2300 } as const
