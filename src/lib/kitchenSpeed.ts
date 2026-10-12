import type { AppSettings, OrderItem } from '@/types/domain'

export const DEFAULT_KITCHEN_TARGET_MINUTES = 15

/** Batas menit penyiapan; 0 = pemilik mematikan batas. */
export function kitchenTargetMinutesOf(settings: Pick<AppSettings, 'kitchenTargetMinutes'> | null | undefined): number {
  const v = settings?.kitchenTargetMinutes
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : DEFAULT_KITCHEN_TARGET_MINUTES
}

type TimedItem = Pick<OrderItem, 'kitchenPrintedAt' | 'queuedAt' | 'createdAt' | 'readyAt' | 'servedAt'>

/** Saat item mulai menjadi tanggungan dapur: waktu dikirim, atau waktu ditambahkan bila tak tercatat. */
export function kitchenStartOf(item: TimedItem): number {
  return item.kitchenPrintedAt ?? item.queuedAt ?? item.createdAt
}

/** Lama penyiapan (menit) item yang sudah siap/diantar; null bila belum selesai atau datanya janggal. */
export function prepMinutesOf(item: TimedItem): number | null {
  const end = item.readyAt ?? item.servedAt
  if (end == null) return null
  const ms = end - kitchenStartOf(item)
  return ms > 0 ? ms / 60_000 : null
}

export interface KitchenSpeedGroup {
  key: string
  count: number
  avgMinutes: number
  lateCount: number
  /** Persen item yang selesai dalam batas; 100 bila batas dimatikan. */
  onTimePercent: number
}

export interface KitchenSpeed {
  targetMinutes: number
  overall: KitchenSpeedGroup
  byStation: KitchenSpeedGroup[]
  /** Menu paling sering melewati batas (minimal 1 kali), terbanyak dulu. */
  lateProducts: KitchenSpeedGroup[]
}

const round1 = (n: number) => Math.round(n * 10) / 10

function summarize(key: string, minutes: number[], target: number): KitchenSpeedGroup {
  const count = minutes.length
  const lateCount = target > 0 ? minutes.filter((m) => m > target).length : 0
  return {
    key,
    count,
    avgMinutes: count ? round1(minutes.reduce((s, m) => s + m, 0) / count) : 0,
    lateCount,
    onTimePercent: count ? round1(((count - lateCount) / count) * 100) : 100,
  }
}

/** Ringkasan kecepatan dapur dari item yang sudah selesai disiapkan. */
export function buildKitchenSpeed(items: { productName: string; station: string; minutes: number }[], targetMinutes: number): KitchenSpeed {
  const group = (pick: (i: (typeof items)[number]) => string) => {
    const map = new Map<string, number[]>()
    for (const i of items) map.set(pick(i), [...(map.get(pick(i)) ?? []), i.minutes])
    return Array.from(map.entries()).map(([key, mins]) => summarize(key, mins, targetMinutes))
  }
  return {
    targetMinutes,
    overall: summarize('all', items.map((i) => i.minutes), targetMinutes),
    byStation: group((i) => i.station).sort((a, b) => b.count - a.count),
    lateProducts: group((i) => i.productName)
      .filter((g) => g.lateCount > 0)
      .sort((a, b) => b.lateCount - a.lateCount || b.avgMinutes - a.avgMinutes)
      .slice(0, 10),
  }
}

/** Menit menunggu item yang masih dikerjakan dapur. */
export function waitingMinutesOf(item: TimedItem, now: number): number {
  return Math.max(0, Math.floor((now - kitchenStartOf(item)) / 60_000))
}
