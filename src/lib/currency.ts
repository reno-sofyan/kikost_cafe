const RUPIAH_FORMATTER = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

export function formatRupiah(amount: number): string {
  return RUPIAH_FORMATTER.format(Math.round(amount))
}

export function formatNumber(amount: number): string {
  return new Intl.NumberFormat('id-ID').format(amount)
}

/** Membulatkan total ke kelipatan tertentu (mis. 100 atau 500 rupiah terdekat). */
export function roundToIncrement(amount: number, increment: number): number {
  if (increment <= 0) return Math.round(amount)
  return Math.round(amount / increment) * increment
}

export function parseRupiahInput(raw: string): number {
  const digitsOnly = raw.replace(/[^0-9]/g, '')
  if (!digitsOnly) return 0
  return Number.parseInt(digitsOnly, 10)
}
