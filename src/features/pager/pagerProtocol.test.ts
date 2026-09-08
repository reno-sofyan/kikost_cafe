import { describe, expect, it } from 'vitest'
import { buildPagerFrame, bytesToHex } from './pagerProtocol'

describe('buildPagerFrame', () => {
  it('menyisipkan digit ASCII nomor pager (zero-pad sesuai token)', () => {
    // "AA{nnn}55", pager 12 → AA + '0''1''2' + 55
    expect(Array.from(buildPagerFrame('AA{nnn}55', 12))).toEqual([0xaa, 0x30, 0x31, 0x32, 0x55])
  })

  it('token {n} tanpa zero-pad', () => {
    expect(Array.from(buildPagerFrame('{n}0D', 7))).toEqual([0x37, 0x0d])
    expect(Array.from(buildPagerFrame('{n}0D', 128))).toEqual([0x31, 0x32, 0x38, 0x0d])
  })

  it('token {b} = 1 byte biner, {bb} = 2 byte big-endian', () => {
    expect(Array.from(buildPagerFrame('{b}', 12))).toEqual([0x0c])
    expect(Array.from(buildPagerFrame('02{bb}03', 300))).toEqual([0x02, 0x01, 0x2c, 0x03])
  })

  it('mengabaikan spasi dan titik dua pada bagian hex', () => {
    expect(Array.from(buildPagerFrame('1B 50 {b} 0D', 3))).toEqual([0x1b, 0x50, 0x03, 0x0d])
  })

  it('menolak template tanpa token nomor', () => {
    expect(() => buildPagerFrame('AA55', 1)).toThrow(/token nomor pager/i)
  })

  it('menolak bagian hex ganjil / karakter non-hex', () => {
    expect(() => buildPagerFrame('A{nn}55', 1)).toThrow(/genap/i)
    expect(() => buildPagerFrame('ZZ{nn}', 1)).toThrow(/hex tidak valid/i)
  })

  it('menolak template kosong', () => {
    expect(() => buildPagerFrame('', 1)).toThrow(/belum diatur/i)
  })

  it('menolak nomor yang tak muat pada token', () => {
    expect(() => buildPagerFrame('{b}', 256)).toThrow(/tidak muat/i)
    expect(() => buildPagerFrame('{nn}', 123)).toThrow(/lebih panjang/i)
  })

  it('bytesToHex memformat spasi + uppercase', () => {
    expect(bytesToHex(Uint8Array.from([0x02, 0xab, 0x0d]))).toBe('02 AB 0D')
  })
})
