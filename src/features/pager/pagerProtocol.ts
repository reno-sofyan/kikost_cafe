/**
 * Membangun frame byte yang dikirim ke base station pager Retekess lewat serial.
 *
 * Base station berbeda model memakai format perintah berbeda dan Retekess hanya
 * membagikan dokumen protokol RS-232 atas permintaan — jadi frame dibuat dari
 * TEMPLATE yang diisi pemilik di Pengaturan, bukan di-hardcode.
 *
 * Aturan template (`commandTemplateHex`):
 *   - Karakter di luar token dianggap HEX literal (spasi & ":" diabaikan).
 *   - Token nomor pager, di-substitusi lalu ikut jadi bagian frame:
 *       {n} {nn} {nnn} {nnnn}  → digit ASCII nomor pager, zero-pad ke panjang token
 *                                 ({n} = tanpa pad). Contoh nomor 12, {nnn} → "012"
 *                                 → byte 0x30 0x31 0x32.
 *       {b}                    → 1 byte biner nilai nomor (0-255). 12 → 0x0C.
 *       {bb}                   → 2 byte biner big-endian. 12 → 0x00 0x0C.
 *
 * Contoh: template "AA{nnn}55" + nomor 12  →  bytes AA 30 31 32 55
 *         template "1B50{b}0D"  + nomor 7   →  bytes 1B 50 07 0D
 */

const TOKEN_RE = /\{(n{1,4}|bb?)\}/g

export interface PagerTemplatePreset {
  id: string
  label: string
  templateHex: string
  baudRate: number
  note: string
}

/**
 * Preset awal. Nilai `templateHex` untuk model asli WAJIB diverifikasi terhadap
 * dokumen protokol RS-232 dari Retekess sebelum dipakai produksi — preset di sini
 * hanya kerangka umum + contoh.
 */
export const PAGER_TEMPLATE_PRESETS: PagerTemplatePreset[] = [
  {
    id: 'ascii-digits',
    label: 'Digit ASCII + CR (umum)',
    templateHex: '{nnn}0D',
    baudRate: 9600,
    note: 'Kirim 3 digit nomor pager sebagai teks diakhiri carriage-return. Cocok untuk banyak base station "PC call".',
  },
  {
    id: 'stx-digits-etx',
    label: 'STX + digit + ETX',
    templateHex: '02{nnn}03',
    baudRate: 9600,
    note: 'Nomor pager diapit STX (0x02) dan ETX (0x03).',
  },
  {
    id: 'single-byte',
    label: '1 byte biner',
    templateHex: '{b}',
    baudRate: 9600,
    note: 'Hanya satu byte berisi nilai nomor pager. Untuk protokol biner sederhana.',
  },
  {
    id: 'custom',
    label: 'Custom',
    templateHex: '',
    baudRate: 9600,
    note: 'Isi manual dari dokumen protokol RS-232 model Retekess Anda.',
  },
]

function expandToken(token: string, pagerNumber: number): number[] {
  if (token === 'b') return [pagerNumber & 0xff]
  if (token === 'bb') return [(pagerNumber >> 8) & 0xff, pagerNumber & 0xff]
  // token 'n'..'nnnn' → digit ASCII, zero-pad ke panjang token
  const text = token.length === 1 ? String(pagerNumber) : String(pagerNumber).padStart(token.length, '0')
  return Array.from(text, (ch) => ch.charCodeAt(0))
}

/**
 * @throws {Error} bila template tidak valid (tidak ada token nomor, hex ganjil,
 *   karakter non-hex, atau nomor pager tak muat pada token).
 */
export function buildPagerFrame(template: string, pagerNumber: number): Uint8Array {
  if (!Number.isInteger(pagerNumber) || pagerNumber < 0) {
    throw new Error(`Nomor pager tidak valid: ${pagerNumber}`)
  }
  const trimmed = (template ?? '').trim()
  if (!trimmed) throw new Error('Template frame pager belum diatur di Pengaturan.')
  if (!/\{(n{1,4}|bb?)\}/.test(trimmed)) {
    throw new Error('Template frame harus memuat token nomor pager, mis. {nnn} atau {b}.')
  }

  const out: number[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  TOKEN_RE.lastIndex = 0

  const pushHexLiteral = (segment: string) => {
    const hex = segment.replace(/[\s:]/g, '')
    if (!hex) return
    if (hex.length % 2 !== 0) {
      throw new Error(`Bagian hex pada template harus genap: "${segment.trim()}"`)
    }
    if (!/^[0-9a-fA-F]+$/.test(hex)) {
      throw new Error(`Karakter hex tidak valid pada template: "${segment.trim()}"`)
    }
    for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16))
  }

  while ((match = TOKEN_RE.exec(trimmed)) !== null) {
    pushHexLiteral(trimmed.slice(lastIndex, match.index))
    const kind = match[1]
    if (kind === 'b' && pagerNumber > 0xff) {
      throw new Error(`Nomor pager ${pagerNumber} tidak muat pada token {b} (maks 255). Pakai {bb} atau {nnn}.`)
    }
    if (kind[0] === 'n' && kind.length > 1 && String(pagerNumber).length > kind.length) {
      throw new Error(`Nomor pager ${pagerNumber} lebih panjang dari token {${kind}}.`)
    }
    out.push(...expandToken(kind, pagerNumber))
    lastIndex = TOKEN_RE.lastIndex
  }
  pushHexLiteral(trimmed.slice(lastIndex))

  return Uint8Array.from(out)
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
}
