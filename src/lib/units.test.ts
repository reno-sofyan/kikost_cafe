import { describe, expect, it } from 'vitest'
import { compatibleUnits, convertQty, IncompatibleUnitError, unitsCompatible } from './units'

describe('konversi satuan', () => {
  it('massa: kg ↔ g', () => {
    expect(convertQty(0.018, 'kg', 'g')).toBe(18)
    expect(convertQty(1500, 'g', 'kg')).toBe(1.5)
  })
  it('volume: l ↔ ml', () => {
    expect(convertQty(0.15, 'l', 'ml')).toBe(150)
    expect(convertQty(2500, 'ml', 'l')).toBe(2.5)
  })
  it('satuan sama = tanpa perubahan', () => {
    expect(convertQty(42, 'pcs', 'pcs')).toBe(42)
  })
  it('lintas keluarga ditolak', () => {
    expect(() => convertQty(1, 'g', 'ml')).toThrow(IncompatibleUnitError)
    expect(() => convertQty(1, 'pcs', 'kg')).toThrow(IncompatibleUnitError)
    expect(unitsCompatible('g', 'ml')).toBe(false)
    expect(unitsCompatible('g', 'kg')).toBe(true)
  })
  it('compatibleUnits mengembalikan sekeluarga', () => {
    expect(compatibleUnits('g').sort()).toEqual(['g', 'kg'])
    expect(compatibleUnits('ml').sort()).toEqual(['l', 'ml'])
    expect(compatibleUnits('pcs')).toEqual(['pcs'])
  })
})
