/**
 * Format manual "Rp1.500.000" / "Rp5.500,50" — titik pemisah ribuan, koma
 * desimal HANYA muncul bila ada pecahan. Sengaja tidak pakai `style: 'currency'`
 * karena data simbol mata uang ICU sering terpangkas (small-ICU) di WebView
 * Android OEM, membuat simbol Rupiah tercetak rusak (mis. jadi "Ta"). Grouping
 * angka polos (`style: 'decimal'`, default) jauh lebih konsisten lintas perangkat.
 */
export function formatRupiah(amount: number): string {
  const rounded = Math.round(amount * 100) / 100
  const hasFraction = !Number.isInteger(rounded)
  const formatter = new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  })
  return `Rp${formatter.format(rounded)}`
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
