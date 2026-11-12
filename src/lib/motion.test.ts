import { describe, expect, it } from 'vitest'
import { routeKeyframes, routeTransitionFor } from './motion'

const at = (path: string, idx: number | null = null) => ({ path, idx })

describe('arah transisi antar layar', () => {
  it('pindah modul setara (Kasir → Laporan → Stok) = fade', () => {
    expect(routeTransitionFor(at('/kasir', 3), at('/laporan', 4))).toBe('fade')
    expect(routeTransitionFor(at('/laporan', 4), at('/stok', 5))).toBe('fade')
  })
  it('masuk lebih dalam di modul yang sama = maju (dari kanan)', () => {
    expect(routeTransitionFor(at('/kasir', 1), at('/kasir/o1/bayar', 2))).toBe('forward')
  })
  it('tombol back (indeks riwayat mundur) = mundur (dari kiri), walau path lebih dalam', () => {
    expect(routeTransitionFor(at('/kasir/o1/bayar', 2), at('/kasir', 1))).toBe('back')
    expect(routeTransitionFor(at('/laporan', 5), at('/laporan/online', 4))).toBe('back')
  })
  it('tanpa indeks riwayat: naik ke tingkat lebih dangkal = mundur', () => {
    expect(routeTransitionFor(at('/kasir/o1/bayar'), at('/kasir'))).toBe('back')
  })
  it('path sama (hanya query) = tanpa animasi', () => {
    expect(routeTransitionFor(at('/pengaturan', 1), at('/pengaturan', 2))).toBe('none')
  })
  it('kurangi gerakan → fade saja, tanpa geser', () => {
    expect(routeKeyframes('forward', true).some((k) => 'transform' in k)).toBe(false)
    expect(routeKeyframes('forward', false)[0].transform).toBe('translateX(28px)')
    expect(routeKeyframes('back', false)[0].transform).toBe('translateX(-28px)')
    expect(routeKeyframes('none', false)).toEqual([])
  })
})
