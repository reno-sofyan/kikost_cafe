import type { OrderItem } from '@/types/domain'

/**
 * Urutan saji (course) ala restoran: item ditandai Pembuka / Utama / Penutup.
 * "Kirim ke Dapur" hanya melepas tahap paling awal yang belum dikirim; tahap
 * berikutnya ditahan sampai pelayan melepasnya. Item tanpa tahap selalu ikut dikirim.
 */
export const COURSES = [1, 2, 3] as const
export type Course = (typeof COURSES)[number]
export const COURSE_LABELS: Record<number, string> = { 1: 'Pembuka', 2: 'Utama', 3: 'Penutup' }

type CourseItem = Pick<OrderItem, 'course' | 'voided' | 'removed' | 'skipKitchen' | 'kitchenPrintedAt'>

const isUnsent = (i: CourseItem) => !i.voided && !i.removed && !i.skipKitchen && i.kitchenPrintedAt == null

/** Tahap yang dilepas pada pengiriman berikutnya (null = tak ada item bertahap yang menunggu). */
export function nextCourseToFire(items: CourseItem[]): number | null {
  const courses = items.filter((i) => isUnsent(i) && i.course != null).map((i) => i.course as number)
  return courses.length ? Math.min(...courses) : null
}

/** Item yang ikut pada pengiriman berikutnya bila tahap-tahap berikutnya ditahan. */
export function itemsToFire<T extends CourseItem>(items: T[]): { fire: T[]; held: T[]; course: number | null } {
  const course = nextCourseToFire(items)
  const unsent = items.filter(isUnsent)
  if (course == null) return { fire: unsent, held: [], course: null }
  return { fire: unsent.filter((i) => i.course == null || i.course === course), held: unsent.filter((i) => i.course != null && i.course > course), course }
}

/** Tahap berikutnya saat chip di keranjang ditekan: — → Pembuka → Utama → Penutup → —. */
export function cycleCourse(course: number | null | undefined): number | null {
  if (course == null) return 1
  return course >= 3 ? null : course + 1
}
