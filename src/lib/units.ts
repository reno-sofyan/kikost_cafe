import type { UnitOfMeasure } from '@/types/domain'

/**
 * Konversi satuan untuk resep & stok. Dua "keluarga": massa (g ↔ kg) dan volume
 * (ml ↔ l). `pcs` berdiri sendiri. Konversi lintas keluarga ditolak.
 *
 * Semua stok disimpan dalam satuan dasar bahan (mis. ingredient.unit). Resep boleh
 * ditulis dalam satuan mana pun sekeluarga; jumlahnya dikonversi saat dipotong.
 */
const FAMILY: Record<UnitOfMeasure, 'mass' | 'volume' | 'count'> = {
  g: 'mass',
  kg: 'mass',
  ml: 'volume',
  l: 'volume',
  pcs: 'count',
}

/** Faktor ke satuan dasar keluarga (g untuk massa, ml untuk volume, pcs untuk count). */
const TO_BASE: Record<UnitOfMeasure, number> = {
  g: 1,
  kg: 1000,
  ml: 1,
  l: 1000,
  pcs: 1,
}

export class IncompatibleUnitError extends Error {
  constructor(from: UnitOfMeasure, to: UnitOfMeasure) {
    super(`Satuan tidak sepadan: ${from} tidak dapat dikonversi ke ${to}`)
    this.name = 'IncompatibleUnitError'
  }
}

export function unitsCompatible(a: UnitOfMeasure, b: UnitOfMeasure): boolean {
  return FAMILY[a] === FAMILY[b]
}

/** Mengonversi `qty` dari satuan `from` ke satuan `to` dalam keluarga yang sama. */
export function convertQty(qty: number, from: UnitOfMeasure, to: UnitOfMeasure): number {
  if (from === to) return qty
  if (!unitsCompatible(from, to)) throw new IncompatibleUnitError(from, to)
  const base = qty * TO_BASE[from]
  return roundQty(base / TO_BASE[to])
}

export function roundQty(value: number): number {
  return Math.round(value * 1000) / 1000
}

export const UNIT_LABELS: Record<UnitOfMeasure, string> = {
  pcs: 'pcs',
  g: 'gram',
  kg: 'kg',
  ml: 'ml',
  l: 'liter',
}

/** Satuan yang sepadan (sekeluarga) dengan satuan dasar tertentu — untuk dropdown resep. */
export function compatibleUnits(base: UnitOfMeasure): UnitOfMeasure[] {
  return (Object.keys(FAMILY) as UnitOfMeasure[]).filter((u) => FAMILY[u] === FAMILY[base])
}
