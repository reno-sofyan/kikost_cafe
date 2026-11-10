import { barRuns, encodeBarcode } from '@/lib/barcodeEncode'
import { formatRupiah } from '@/lib/currency'
import { saveFile } from '@/lib/saveFile'
import type { jsPDF } from 'jspdf'

export interface PriceLabel {
  name: string
  price: number
  /** Barcode/SKU yang dicetak; kosong = label tanpa barcode. */
  code: string | null
  /** Baris kecil di bawah harga, mis. "Beli ≥ 12: Rp2.800/pcs". */
  note?: string
}

/** Kertas label A4 umum (3 kolom × 8 baris, 70 × 37 mm). */
const COLS = 3
const ROWS = 8
const LABEL_W = 70
const LABEL_H = 37.125

/** Membuat PDF label harga rak dan menyimpannya (unduh / berkas di Android). */
export async function savePriceLabelsPdf(labels: PriceLabel[], filename = 'label-harga.pdf'): Promise<void> {
  if (!labels.length) return
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  labels.forEach((label, i) => {
    const slot = i % (COLS * ROWS)
    if (i > 0 && slot === 0) doc.addPage()
    const x = (slot % COLS) * LABEL_W
    const y = Math.floor(slot / COLS) * LABEL_H
    drawLabel(doc, label, x, y)
  })
  await saveFile(filename, doc.output('blob'))
}

function drawLabel(doc: jsPDF, label: PriceLabel, x: number, y: number) {
  const pad = 3
  doc.setDrawColor(200)
  doc.setLineWidth(0.1)
  doc.rect(x + 1, y + 1, LABEL_W - 2, LABEL_H - 2)

  doc.setTextColor(20)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  const nameLines = (doc.splitTextToSize(label.name, LABEL_W - pad * 2) as string[]).slice(0, 2)
  doc.text(nameLines, x + pad, y + pad + 3)

  doc.setFontSize(17)
  doc.text(formatRupiah(label.price), x + pad, y + 16.5)
  if (label.note) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.text(label.note, x + pad, y + 20)
  }

  if (!label.code) return
  let modules: boolean[]
  try {
    modules = encodeBarcode(label.code).modules
  } catch {
    return
  }
  const barTop = y + 21.5
  const barH = 9
  const maxW = LABEL_W - pad * 2
  const module = Math.min(0.33, maxW / modules.length)
  const startX = x + (LABEL_W - modules.length * module) / 2
  doc.setFillColor(0, 0, 0)
  for (const [start, width] of barRuns(modules)) doc.rect(startX + start * module, barTop, width * module, barH, 'F')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.text(label.code, x + LABEL_W / 2, barTop + barH + 2.8, { align: 'center' })
}
