import { describe, expect, it } from 'vitest'
import { DEFAULT_WEDGE_CONFIG, WedgeDetector } from '@/lib/barcodeWedge'

/** Ketik `text` mulai `start`, `gap` ms per karakter; kembalikan waktu karakter terakhir. */
function type(d: WedgeDetector, text: string, start: number, gap: number): number {
  let t = start
  for (const ch of text) {
    d.key(ch, t)
    t += gap
  }
  return t - gap
}

describe('pendeteksi pemindai mode keyboard', () => {
  it('semburan cepat + Enter = pindaian', () => {
    const d = new WedgeDetector()
    const last = type(d, '8990000000109', 1000, 8)
    const r = d.key('Enter', last + 10)
    expect(r.kind).toBe('scan')
    expect(r.kind === 'scan' && r.scan).toMatchObject({ code: '8990000000109', terminator: 'Enter' })
    expect(r.kind === 'scan' && r.scan.avgGapMs).toBeCloseTo(8)
  })

  it('ketikan manusia (≥ 80 ms/karakter) bukan pindaian', () => {
    const d = new WedgeDetector()
    const last = type(d, '8990000000109', 0, 120)
    expect(d.key('Enter', last + 100).kind).toBe('none')
  })

  it('awal lambat lalu semburan: hanya semburannya yang dihitung', () => {
    const d = new WedgeDetector()
    type(d, 'ab', 0, 300)
    const last = type(d, 'MM-500', 2000, 5)
    const r = d.key('Tab', last + 5)
    expect(r.kind === 'scan' && r.scan.code).toBe('MM-500')
  })

  it('Shift (huruf besar dari pemindai) tak memutus kode', () => {
    const d = new WedgeDetector()
    d.key('Shift', 0)
    d.key('A', 4)
    d.key('Shift', 6)
    d.key('B', 10)
    d.key('1', 14)
    d.key('2', 18)
    const r = d.key('Enter', 22)
    expect(r.kind === 'scan' && r.scan.code).toBe('AB12')
  })

  it('terlalu pendek atau Enter datang terlambat = bukan pindaian', () => {
    const d = new WedgeDetector()
    expect(d.key('Enter', type(d, '123', 0, 5) + 5).kind).toBe('none')
    expect(d.key('Enter', type(d, '12345678', 100, 5) + 1000).kind).toBe('none')
  })

  it('tombol lain (Backspace) memutus semburan', () => {
    const d = new WedgeDetector()
    type(d, '1234', 0, 5)
    d.key('Backspace', 22)
    expect(d.key('Enter', 25).kind).toBe('none')
  })

  it('tanpa akhiran: kode selesai saat jeda', () => {
    const d = new WedgeDetector({ ...DEFAULT_WEDGE_CONFIG, terminator: 'none' })
    const last = type(d, '8990000000109', 0, 6)
    expect(d.idle(last + 10).kind).toBe('none') // masih mungkin berlanjut
    const r = d.idle(last + 200)
    expect(r.kind === 'scan' && r.scan).toMatchObject({ code: '8990000000109', terminator: 'idle' })
    expect(d.key('Enter', last + 210).kind).toBe('none')
  })

  it('pindaian ganda kode sama dalam rentang dedupe ditandai duplikat', () => {
    const d = new WedgeDetector({ ...DEFAULT_WEDGE_CONFIG, dedupeMs: 1000 })
    expect(d.key('Enter', type(d, '12345', 0, 5) + 5).kind).toBe('scan')
    expect(d.key('Enter', type(d, '12345', 300, 5) + 5).kind).toBe('duplicate')
    expect(d.key('Enter', type(d, '99999', 600, 5) + 5).kind).toBe('scan')
    expect(d.key('Enter', type(d, '12345', 2000, 5) + 5).kind).toBe('scan')
  })
})
