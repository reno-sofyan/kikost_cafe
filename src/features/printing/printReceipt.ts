import jsPDF from 'jspdf'
import { getSettings } from '@/db/repositories/settings'
import { buildReceiptData, type ReceiptData } from '@/features/printing/receiptData'
import { resolvePrinterDriver, type PrinterDriver } from '@/features/printing/printerDrivers'
import { renderReceiptBodyHtml } from '@/features/printing/renderReceiptHtml'
import type { Order } from '@/types/domain'

export async function prepareReceiptData(order: Order): Promise<ReceiptData> {
  const settings = await getSettings()
  return buildReceiptData(order, settings)
}

export async function printOrderReceipt(order: Order, driverOverride?: PrinterDriver): Promise<void> {
  const settings = await getSettings()
  const data = await buildReceiptData(order, settings)
  const driver = driverOverride ?? resolvePrinterDriver(settings.printerConfig)
  await driver.print(data)
}

/** Menyimpan struk sebagai PDF dan mengunduhnya (tersedia di PWA maupun APK). */
export function saveReceiptAsPdf(data: ReceiptData): void {
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
  doc.save(`struk-${data.orderNumber}.pdf`)
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
