import { ean13CheckDigit, isValidEan13 } from '@/lib/retailPricing'

/**
 * Encoder barcode untuk label harga rak: EAN-13 (barcode pabrik 13 digit) dan
 * Code 128-B (SKU/kode toko lainnya). Hasilnya deret modul — `true` = batang hitam —
 * yang digambar sebagai persegi panjang (PDF/SVG), tanpa pustaka tambahan.
 */

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const EAN_R = EAN_L.map((p) => [...p].map((b) => (b === '1' ? '0' : '1')).join(''))
const EAN_G = EAN_R.map((p) => [...p].reverse().join(''))
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

/** Modul EAN-13 (95 modul, tanpa zona sepi). `code` 12 digit (cek dihitung) atau 13 digit valid. */
export function encodeEan13(code: string): boolean[] {
  const digits = code.length === 12 && /^\d{12}$/.test(code) ? code + ean13CheckDigit(code) : code
  if (!isValidEan13(digits)) throw new Error('Bukan EAN-13 yang valid')
  const parity = EAN_PARITY[Number(digits[0])]
  let bits = '101'
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'L' ? EAN_L : EAN_G)[Number(digits[i])]
  bits += '01010'
  for (let i = 7; i <= 12; i++) bits += EAN_R[Number(digits[i])]
  bits += '101'
  return [...bits].map((b) => b === '1')
}

/** Lebar batang/spasi Code 128 per nilai simbol 0–106 (106 = stop, 13 modul). */
const CODE128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]
export const CODE128_PATTERNS: readonly string[] = CODE128

const START_B = 104
const STOP = 106

/** Modul Code 128-B (ASCII 32–126). */
export function encodeCode128(text: string): boolean[] {
  if (!text || [...text].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) > 126)) throw new Error('Code 128 hanya untuk huruf/angka/tanda baca ASCII')
  const values = [START_B, ...[...text].map((ch) => ch.charCodeAt(0) - 32)]
  const checksum = values.reduce((s, v, i) => s + v * (i === 0 ? 1 : i), 0) % 103
  const out: boolean[] = []
  for (const v of [...values, checksum, STOP]) {
    const widths = CODE128[v]
    for (let i = 0; i < widths.length; i++) for (let w = 0; w < Number(widths[i]); w++) out.push(i % 2 === 0)
  }
  return out
}

/** EAN-13 bila kodenya 13 digit valid (atau 12 digit), selain itu Code 128. */
export function encodeBarcode(code: string): { kind: 'ean13' | 'code128'; modules: boolean[] } {
  const c = code.trim()
  if (isValidEan13(c) || /^\d{12}$/.test(c)) return { kind: 'ean13', modules: encodeEan13(c) }
  return { kind: 'code128', modules: encodeCode128(c) }
}

/** Rentang batang hitam [awal, lebar] dalam satuan modul — untuk digambar sebagai persegi. */
export function barRuns(modules: boolean[]): Array<[number, number]> {
  const runs: Array<[number, number]> = []
  let i = 0
  while (i < modules.length) {
    if (!modules[i]) {
      i++
      continue
    }
    const start = i
    while (i < modules.length && modules[i]) i++
    runs.push([start, i - start])
  }
  return runs
}
