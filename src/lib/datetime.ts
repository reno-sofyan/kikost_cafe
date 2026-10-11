export const CAFE_TIMEZONE = 'Asia/Jakarta'

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('id-ID', {
  timeZone: CAFE_TIMEZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const DATE_FORMATTER = new Intl.DateTimeFormat('id-ID', {
  timeZone: CAFE_TIMEZONE,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

const TIME_FORMATTER = new Intl.DateTimeFormat('id-ID', {
  timeZone: CAFE_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
})

export function formatDateTime(timestamp: number): string {
  return `${DATE_TIME_FORMATTER.format(new Date(timestamp))} WIB`
}

export function formatDate(timestamp: number): string {
  return DATE_FORMATTER.format(new Date(timestamp))
}

export function formatTime(timestamp: number): string {
  return TIME_FORMATTER.format(new Date(timestamp))
}

/** Kunci hari dalam zona waktu Asia/Jakarta, format YYYY-MM-DD, untuk pengelompokan laporan. */
export function jakartaDateKey(timestamp: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAFE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp))
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const month = parts.find((p) => p.type === 'month')?.value ?? '01'
  const day = parts.find((p) => p.type === 'day')?.value ?? '01'
  return `${year}-${month}-${day}`
}

const JAKARTA_UTC_OFFSET_MS = 7 * 60 * 60 * 1000

/** Awal hari (00:00 WIB) dalam epoch ms, mundur `offsetDays` hari dari sekarang. */
export function startOfJakartaDay(offsetDays = 0): number {
  const key = jakartaDateKey(Date.now())
  const parts = key.split('-').map(Number)
  const [year, month, day] = parts as [number, number, number]
  const utcMidnight = Date.UTC(year, month - 1, day) - JAKARTA_UTC_OFFSET_MS
  return utcMidnight - offsetDays * 24 * 60 * 60 * 1000
}

/** Awal bulan berjalan (00:00 WIB tanggal 1) dalam epoch ms. */
export function startOfJakartaMonth(): number {
  const key = jakartaDateKey(Date.now())
  const parts = key.split('-').map(Number)
  const [year, month] = parts as [number, number, number]
  return Date.UTC(year, month - 1, 1) - JAKARTA_UTC_OFFSET_MS
}

export function durationSince(startTimestamp: number, nowTimestamp: number): string {
  const diffMs = Math.max(0, nowTimestamp - startTimestamp)
  const totalMinutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours}j ${minutes}m`
  return `${minutes}m`
}

/** Jam:menit (HH:MM, 24 jam) dalam zona waktu Asia/Jakarta — untuk `<input type="time">`. */
export function jakartaTimeKey(timestamp: number): string {
  const d = new Date(timestamp + JAKARTA_UTC_OFFSET_MS)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/**
 * Gabungkan tanggal (YYYY-MM-DD) + jam (HH:MM) WIB menjadi epoch ms — tak bergantung
 * zona waktu perangkat. Mengembalikan NaN bila masukan tak valid.
 */
export function jakartaDateTimeToEpoch(dateKey: string, timeKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number)
  const [hour, minute] = timeKey.split(':').map(Number)
  if (![year, month, day, hour, minute].every((n) => Number.isFinite(n))) return NaN
  return Date.UTC(year as number, (month as number) - 1, day as number, hour as number, minute as number) - JAKARTA_UTC_OFFSET_MS
}
