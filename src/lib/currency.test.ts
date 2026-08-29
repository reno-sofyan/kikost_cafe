import { describe, expect, it } from 'vitest'
import { formatRupiah, parseRupiahInput, roundToIncrement } from './currency'

describe('roundToIncrement', () => {
  it('membulatkan ke kelipatan terdekat', () => {
    expect(roundToIncrement(12345, 100)).toBe(12300)
    expect(roundToIncrement(12355, 100)).toBe(12400)
    expect(roundToIncrement(12740, 500)).toBe(12500)
    expect(roundToIncrement(12760, 500)).toBe(13000)
  })
  it('increment <= 0 hanya membulatkan ke bilangan bulat', () => {
    expect(roundToIncrement(99.6, 0)).toBe(100)
    expect(roundToIncrement(99.6, -5)).toBe(100)
  })
})

describe('parseRupiahInput', () => {
  it('mengambil hanya digit', () => {
    expect(parseRupiahInput('Rp 25.000')).toBe(25000)
    expect(parseRupiahInput('abc')).toBe(0)
    expect(parseRupiahInput('')).toBe(0)
    expect(parseRupiahInput('1.234.567')).toBe(1234567)
  })
})

describe('formatRupiah', () => {
  it('memformat tanpa desimal', () => {
    const out = formatRupiah(25000)
    expect(out).toContain('25.000')
    expect(out).toMatch(/Rp/)
  })
})
