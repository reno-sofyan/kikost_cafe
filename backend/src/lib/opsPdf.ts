import { jsPDF } from 'jspdf'
import type { CancellationReport, CancellationRow } from './opsCancellations.js'

/**
 * PDF laporan konsol operator (`/ops`): transaksi & pembatalan satu tenant untuk
 * satu periode. Dibuat di server (jsPDF, font standar Helvetica) supaya bisa
 * langsung diunduh dari HP tanpa memuat skrip pihak ketiga di halaman ber-token.
 */

const PAGE_W = 210
const PAGE_H = 297
const MARGIN = 12
const CONTENT_W = PAGE_W - MARGIN * 2
const LINE_H = 3.9

/** Font standar PDF hanya WinAnsi — ganti karakter yang tak terwakili. */
export function pdfText(v: unknown): string {
  return String(v ?? '')
    .replace(/[→⇒]/g, '->')
    .replace(/[—–]/g, '-')
    .replace(/[•·]/g, '-')
    .replace(/×/g, 'x')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
}

export const rupiah = (n: number): string => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID')

export function fmtWib(ms: number | null | undefined, withDate = true): string {
  if (!ms) return '-'
  return new Date(ms).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    ...(withDate ? { day: '2-digit', month: 'short', year: '2-digit' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  })
}

export interface PdfColumn {
  title: string
  /** Lebar dalam mm; jumlah semua kolom ≈ CONTENT_W (186). */
  width: number
  align?: 'left' | 'right'
}

class ReportDoc {
  readonly doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  private y = MARGIN

  constructor(private readonly title: string, private readonly subtitle: string) {
    this.header()
  }

  private header() {
    const d = this.doc
    d.setFont('helvetica', 'bold')
    d.setFontSize(13)
    d.text(pdfText(this.title), MARGIN, this.y + 4)
    d.setFont('helvetica', 'normal')
    d.setFontSize(8.5)
    d.setTextColor(90)
    d.text(pdfText(this.subtitle), MARGIN, this.y + 9)
    d.setTextColor(0)
    this.y += 14
  }

  private ensure(h: number, onBreak?: () => void) {
    if (this.y + h <= PAGE_H - MARGIN - 6) return
    this.doc.addPage()
    this.y = MARGIN
    onBreak?.()
  }

  heading(text: string) {
    this.ensure(10)
    this.y += 2
    this.doc.setFont('helvetica', 'bold')
    this.doc.setFontSize(10)
    this.doc.text(pdfText(text), MARGIN, this.y + 3.5)
    this.y += 6
  }

  note(text: string) {
    const d = this.doc
    d.setFont('helvetica', 'normal')
    d.setFontSize(8)
    d.setTextColor(90)
    const lines = d.splitTextToSize(pdfText(text), CONTENT_W) as string[]
    this.ensure(lines.length * LINE_H + 1)
    d.text(lines, MARGIN, this.y + 3)
    d.setTextColor(0)
    this.y += lines.length * LINE_H + 1
  }

  /** Deret kotak angka ringkasan. */
  stats(items: [string, string][]) {
    const d = this.doc
    const perRow = 4
    const w = (CONTENT_W - (perRow - 1) * 3) / perRow
    for (let i = 0; i < items.length; i += perRow) {
      this.ensure(15)
      items.slice(i, i + perRow).forEach(([label, value], j) => {
        const x = MARGIN + j * (w + 3)
        d.setDrawColor(210)
        d.setFillColor(246, 247, 249)
        d.roundedRect(x, this.y, w, 13, 1.5, 1.5, 'FD')
        d.setFont('helvetica', 'normal')
        d.setFontSize(7)
        d.setTextColor(100)
        d.text(pdfText(label).toUpperCase(), x + 2.5, this.y + 4.3)
        d.setFont('helvetica', 'bold')
        d.setFontSize(10.5)
        d.setTextColor(0)
        d.text(pdfText(value), x + 2.5, this.y + 10)
      })
      this.y += 16
    }
  }

  table(columns: PdfColumn[], rows: string[][], opts: { rowNotes?: (string | null)[] } = {}) {
    const d = this.doc
    const drawHead = () => {
      d.setFillColor(235, 238, 242)
      d.rect(MARGIN, this.y, CONTENT_W, 6, 'F')
      d.setFont('helvetica', 'bold')
      d.setFontSize(7.5)
      let x = MARGIN
      for (const c of columns) {
        const tx = c.align === 'right' ? x + c.width - 1.5 : x + 1.5
        d.text(pdfText(c.title), tx, this.y + 4, { align: c.align === 'right' ? 'right' : 'left' })
        x += c.width
      }
      this.y += 6.5
    }
    this.ensure(14)
    drawHead()
    d.setFontSize(7.5)
    rows.forEach((row, ri) => {
      d.setFont('helvetica', 'normal')
      const cells = row.map((v, ci) => d.splitTextToSize(pdfText(v), columns[ci].width - 3) as string[])
      const note = opts.rowNotes?.[ri]
      const noteLines = note ? (d.splitTextToSize(pdfText(note), CONTENT_W - 6) as string[]) : []
      const h = Math.max(...cells.map((c) => c.length)) * LINE_H + noteLines.length * LINE_H + 2
      this.ensure(h, drawHead)
      let x = MARGIN
      cells.forEach((lines, ci) => {
        const c = columns[ci]
        const tx = c.align === 'right' ? x + c.width - 1.5 : x + 1.5
        d.text(lines, tx, this.y + 3, { align: c.align === 'right' ? 'right' : 'left' })
        x += c.width
      })
      const cellH = Math.max(...cells.map((c) => c.length)) * LINE_H
      if (noteLines.length) {
        d.setFontSize(7)
        d.setTextColor(150, 30, 30)
        d.text(noteLines, MARGIN + 4, this.y + cellH + 3)
        d.setTextColor(0)
        d.setFontSize(7.5)
      }
      this.y += h
      d.setDrawColor(225)
      d.line(MARGIN, this.y - 0.8, MARGIN + CONTENT_W, this.y - 0.8)
    })
    if (rows.length === 0) this.note('Tidak ada data pada periode ini.')
    this.y += 2
  }

  finish(footer: string): Buffer {
    const d = this.doc
    const total = d.getNumberOfPages()
    for (let i = 1; i <= total; i++) {
      d.setPage(i)
      d.setFont('helvetica', 'normal')
      d.setFontSize(7)
      d.setTextColor(130)
      d.text(pdfText(footer), MARGIN, PAGE_H - 7)
      d.text(`Hal ${i}/${total}`, PAGE_W - MARGIN, PAGE_H - 7, { align: 'right' })
    }
    return Buffer.from(d.output('arraybuffer'))
  }
}

export interface ReportMeta {
  businessName: string
  tenantId: string
  periodLabel: string
  generatedAt: number
}

const footerOf = (m: ReportMeta) => `Kione POS - ${m.businessName} (${m.tenantId}) - dibuat ${fmtWib(m.generatedAt)} WIB`

// ---------------- Transaksi ----------------

export interface TransactionRow {
  orderNumber: string | null
  queueNumber: number | null
  buyer: string | null
  cashierName: string | null
  methods: string[]
  status: 'paid' | 'void' | 'open'
  payLater: boolean
  grandTotal: number
  at: number | null
}

export interface TransactionReport {
  rows: TransactionRow[]
  byMethod: { method: string; amount: number; count: number }[]
  paidCount: number
  paidValue: number
  voidCount: number
  openPayLaterCount: number
  openPayLaterValue: number
}

const METHOD_LABEL: Record<string, string> = { cash: 'Tunai', qris: 'QRIS', transfer: 'Transfer', card: 'Kartu' }
const STATUS_LABEL: Record<TransactionRow['status'], string> = { paid: 'Lunas', void: 'Batal', open: 'Belum bayar' }

export function buildTransactionsPdf(meta: ReportMeta, r: TransactionReport): Buffer {
  const doc = new ReportDoc(`Laporan Transaksi - ${meta.businessName}`, `Periode ${meta.periodLabel} (WIB)`)
  doc.stats([
    ['Transaksi lunas', String(r.paidCount)],
    ['Omzet', rupiah(r.paidValue)],
    ['Dibatalkan', String(r.voidCount)],
    ['Tagihan tertunda belum lunas', `${r.openPayLaterCount} - ${rupiah(r.openPayLaterValue)}`],
  ])
  if (r.byMethod.length) {
    doc.heading('Per metode pembayaran')
    doc.table(
      [
        { title: 'Metode', width: 90 },
        { title: 'Jumlah pembayaran', width: 46, align: 'right' },
        { title: 'Nilai', width: 50, align: 'right' },
      ],
      r.byMethod.map((m) => [METHOD_LABEL[m.method] ?? m.method, String(m.count), rupiah(m.amount)]),
    )
  }
  doc.heading(`Daftar transaksi (${r.rows.length})`)
  doc.table(
    [
      { title: 'Waktu', width: 27 },
      { title: 'No.', width: 25 },
      { title: 'Antrean / Pembeli', width: 40 },
      { title: 'Kasir', width: 24 },
      { title: 'Metode', width: 22 },
      { title: 'Status', width: 21 },
      { title: 'Total', width: 27, align: 'right' },
    ],
    r.rows.map((t) => [
      fmtWib(t.at),
      t.orderNumber ?? '-',
      [t.queueNumber ? `#${t.queueNumber}` : '', t.buyer ?? ''].filter(Boolean).join(' ') || '-',
      t.cashierName ?? '-',
      t.methods.map((m) => METHOD_LABEL[m] ?? m).join(', ') || '-',
      STATUS_LABEL[t.status] + (t.payLater ? ' (tagihan tertunda)' : ''),
      rupiah(t.grandTotal),
    ]),
  )
  doc.note('Omzet = total transaksi berstatus lunas pada periode ini, berdasarkan waktu pembayaran.')
  return doc.finish(footerOf(meta))
}

// ---------------- Pembatalan ----------------

const STAGE_LABEL: Record<CancellationRow['stage'], string> = {
  paid: 'Sudah lunas',
  kitchen: 'Sudah ke dapur',
  unprocessed: 'Belum diproses',
}
const APPROVAL_LABEL: Record<string, string> = { owner_code: 'Kode Pemilik', supervisor: 'PIN Supervisor', self: 'Tanpa persetujuan' }
const KIND_LABEL: Record<string, string> = { removed: 'dihapus', voided: 'di-void', reduced: 'dikurangi' }

function correctionNote(r: CancellationRow): string | null {
  if (!r.corrections.length) return null
  const parts = r.corrections.map(
    (c) =>
      `${c.name}${c.qty ? ' x' + c.qty : ''} ${KIND_LABEL[c.kind]} -${rupiah(c.value)}` +
      ` (${c.reason ?? (c.kind === 'reduced' ? 'lihat log' : 'tanpa alasan')}${c.by ? ', ' + c.by : ''}${c.ownerApproved ? ', kode Pemilik' : ''})`,
  )
  return (r.emptiedFirst ? 'DIKOSONGKAN DULU - item dihapus: ' : 'Koreksi item: ') + parts.join('; ')
}

export function buildCancellationsPdf(meta: ReportMeta, r: CancellationReport): Buffer {
  const doc = new ReportDoc(`Laporan Pembatalan - ${meta.businessName}`, `Periode ${meta.periodLabel} (WIB)`)
  const t = r.totals
  doc.stats([
    ['Jumlah batal', String(t.count)],
    ['Nilai batal', rupiah(t.value)],
    ['Setelah lunas', `${t.paidCount} - ${rupiah(t.paidValue)}`],
    ['Dikosongkan dulu', `${t.emptiedFirstCount} - ${rupiah(t.emptiedFirstValue)}`],
    ['Pakai kode Pemilik', String(t.ownerCodeCount)],
  ])
  const groupTable = (title: string, groups: CancellationReport['byRequester']) => {
    doc.heading(title)
    doc.table(
      [
        { title: 'Nama / alasan', width: 110 },
        { title: 'Kali', width: 26, align: 'right' },
        { title: 'Nilai', width: 50, align: 'right' },
      ],
      groups.map((g) => [g.name, String(g.count), rupiah(g.value)]),
    )
  }
  groupTable('Rekap per peminta', r.byRequester)
  groupTable('Rekap per penyetuju', r.byApprover)
  groupTable('Rekap per alasan', r.byReason)

  doc.heading(`Daftar pembatalan (${r.rows.length})`)
  doc.table(
    [
      { title: 'Dibatalkan', width: 25 },
      { title: 'No. / Pembeli', width: 33 },
      { title: 'Tahap', width: 22 },
      { title: 'Alasan', width: 38 },
      { title: 'Diminta', width: 19 },
      { title: 'Disetujui', width: 25 },
      { title: 'Nilai', width: 24, align: 'right' },
    ],
    r.rows.map((c) => [
      fmtWib(c.voidedAt),
      [c.queueNumber ? `#${c.queueNumber}` : '', c.orderNumber ?? '-', c.buyer ?? ''].filter(Boolean).join(' '),
      STAGE_LABEL[c.stage] + (c.payLater ? ', tagihan tertunda' : '') + (c.neverHadItems ? ', tanpa item' : ''),
      c.reason ?? '(tanpa alasan)',
      c.requestedBy ?? '-',
      (c.approvedBy ?? '-') + (c.approval ? ` (${APPROVAL_LABEL[c.approval] ?? c.approval})` : ''),
      rupiah(c.value),
    ]),
    { rowNotes: r.rows.map(correctionNote) },
  )
  doc.note(
    'Nilai = total pesanan saat dibatalkan; untuk pesanan yang dikosongkan dulu, nilai = total item yang dihapus. ' +
      'Data sebelum app v1.0.13/v1.0.14 tidak menyimpan peminta (untuk persetujuan supervisor) dan alasan per item.',
  )
  return doc.finish(footerOf(meta))
}
