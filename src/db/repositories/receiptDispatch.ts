import { db } from '@/db/schema'
import { getSettings } from '@/db/repositories/settings'
import { activePrinterForStation } from '@/db/repositories/printers'
import { enqueuePrintJob, processPrintQueue } from '@/db/repositories/printQueue'
import { buildReceiptData } from '@/features/printing/receiptData'

/**
 * Mengantre cetak nota kasir untuk sebuah order ke station 'cashier'.
 * Idempoten: nota pertama vs. cetak ulang punya kunci berbeda; retry aman.
 * Jika tak ada printer kasir aktif, job tetap dibuat (QUEUED) dengan catatan error
 * — kegagalan printer tak membatalkan pembayaran.
 */
export async function enqueueReceiptForOrder(
  orderId: string,
  actor: { userId: string; userName: string },
  opts: { isReprint?: boolean } = {},
): Promise<{ enqueued: boolean; noPrinter: boolean }> {
  const order = await db.orders.get(orderId)
  if (!order) return { enqueued: false, noPrinter: false }
  const settings = await getSettings()
  const data = await buildReceiptData(order, settings, { isReprint: opts.isReprint })

  const reprintCount = opts.isReprint
    ? await db.printJobs.where('orderId').equals(orderId).filter((j) => j.isReprint && j.kind === 'receipt').count()
    : 0
  const key = opts.isReprint ? `rc_${orderId}_reprint_${reprintCount + 1}` : `rc_${orderId}`

  await db.transaction('rw', [db.printJobs, db.printers, db.syncQueue, db.auditLogs], async () => {
    await enqueuePrintJob({
      kind: 'receipt',
      station: 'cashier',
      payload: data,
      title: `Nota ${order.orderNumber}${opts.isReprint ? ' (cetak ulang)' : ''}`,
      orderId,
      isReprint: opts.isReprint,
      idempotencyKey: key,
      requestedBy: actor.userId,
      requestedByName: actor.userName,
    })
  })

  await processPrintQueue()
  const printer = await activePrinterForStation('cashier')
  return { enqueued: true, noPrinter: !printer }
}
