import jsPDF from 'jspdf'
import { getSettings } from '@/db/repositories/settings'
import { buildReceiptData, type ReceiptData } from '@/features/printing/receiptData'
import { resolvePrinterDriver, type PrinterDriver } from '@/features/printing/printerDrivers'
import { renderReceiptBodyHtml } from '@/features/printing/renderReceiptHtml'
import { saveFile } from '@/lib/saveFile'
import type { Order } from '@/types/domain'

export async function prepareReceiptData(order: Order, opts: { isReprint?: boolean } = {}): Promise<ReceiptData> {
  const settings = await getSettings()
  return buildReceiptData(order, settings, opts)
}

export async function printOrderReceipt(
  order: Order,
  opts: { isReprint?: boolean; driverOverride?: PrinterDriver } = {},
): Promise<void> {
  const settings = await getSettings()
  const data = await buildReceiptData(order, settings, { isReprint: opts.isReprint })
  const driver = opts.driverOverride ?? resolvePrinterDriver(settings.printerConfig)
  await driver.print(data)
}

/** Mencetak dari ReceiptData yang sudah dibangun (mempertahankan penanda mis. CETAK ULANG). */
export async function printReceiptData(data: ReceiptData): Promise<void> {
  const settings = await getSettings()
  await resolvePrinterDriver(settings.printerConfig).print(data)
}

/**
 * Menyimpan struk sebagai PDF. Di web mengunduh; di APK menulis berkas lalu
 * membuka lembar "Bagikan" (kirim ke WhatsApp/email pelanggan) — struk digital.
 */
export async function saveReceiptAsPdf(data: ReceiptData): Promise<void> {
  const widthMm = data.paperSize === '58mm' ? 58 : 80
  const doc = new jsPDF({ unit: 'mm', format: [widthMm, 200] })

  const plainText = htmlToPlainLines(renderReceiptBodyHtml(data))
  let y = 6
  const lineHeight = 4
  doc.setFontSize(8)
  for (const line of plainText) {
    if (y > 190) {
      doc.addPage([widthMm, 200])
      y = 6
    }
    doc.text(line, widthMm / 2, y, { align: 'center', maxWidth: widthMm - 6 })
    y += lineHeight
  }
  await saveFile(`struk-${data.orderNumber}.pdf`, doc.output('blob'))
}

function htmlToPlainLines(html: string): string[] {
  const container = document.createElement('div')
  container.innerHTML = html
  const rawText = container.textContent ?? ''
  return rawText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}
