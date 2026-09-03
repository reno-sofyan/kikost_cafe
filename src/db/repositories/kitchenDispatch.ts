import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import { formatTime } from '@/lib/datetime'
import { getSettings } from '@/db/repositories/settings'
import { stationForCategory } from '@/db/repositories/printers'
import { enqueuePrintJob, processPrintQueue } from '@/db/repositories/printQueue'
import type { KitchenTicket, KitchenTicketLine, KitchenTicketPayload, OrderItem, PrinterStation } from '@/types/domain'

const SOURCE_LABELS: Record<string, string> = {
  cashier: 'Kasir',
  qr_table: 'QR Meja',
  takeaway: 'Bawa Pulang',
  delivery: 'Delivery',
}

function toLine(item: OrderItem): KitchenTicketLine {
  return {
    qty: item.qty,
    name: item.productName,
    modifiers: item.modifiers.map((m) => `${m.groupName}: ${m.optionName}`),
    note: item.notes,
  }
}

/**
 * Mengirim item order yang BELUM tercetak ke dapur/bar: kelompokkan per station,
 * buat kitchen ticket (tiket ke-2+ = pesanan tambahan), dan antre satu print job
 * per station berisi HANYA item baru — item lama tidak dicetak ulang.
 */
export async function sendOrderToKitchen(
  orderId: string,
  actor: { userId: string; userName: string },
): Promise<{ stations: PrinterStation[]; itemCount: number }> {
  const order = await db.orders.get(orderId)
  if (!order) throw new Error('Pesanan tidak ditemukan')

  const items = await db.orderItems
    .where('orderId')
    .equals(orderId)
    .filter((i) => !i.voided && !i.removed && i.kitchenPrintedAt == null)
    .toArray()
  if (items.length === 0) return { stations: [], itemCount: 0 }

  const settings = await getSettings()
  const byStation = new Map<PrinterStation, OrderItem[]>()
  for (const item of items) {
    const product = await db.products.get(item.productId)
    const station = await stationForCategory(product?.categoryId ?? null)
    const list = byStation.get(station) ?? []
    list.push(item)
    byStation.set(station, list)
  }

  const now = Date.now()
  await db.transaction(
    'rw',
    [db.orders, db.orderItems, db.kitchenTickets, db.printJobs, db.printers, db.syncQueue, db.auditLogs],
    async () => {
      const existingTickets = await db.kitchenTickets.where('orderId').equals(orderId).sortBy('sequenceNo')
      let nextSeq = (existingTickets[existingTickets.length - 1]?.sequenceNo ?? 0) + 1

      for (const [station, stationItems] of byStation) {
        const seq = nextSeq++
        const ticket: KitchenTicket = {
          id: newId(),
          orderId,
          sequenceNo: seq,
          station,
          itemIds: stationItems.map((i) => i.id),
          printedAt: null,
          createdAt: now,
          updatedAt: now,
        }
        await db.kitchenTickets.add(ticket)
        await enqueueSync('kitchenTickets', ticket.id, ticket)

        for (const item of stationItems) {
          await db.orderItems.update(item.id, { ticketId: ticket.id, kitchenPrintedAt: now, updatedAt: now })
          const updated = await db.orderItems.get(item.id)
          if (updated) await enqueueSync('orderItems', item.id, updated)
        }

        const payload: KitchenTicketPayload = {
          outletName: settings.cafeName,
          orderNumber: order.orderNumber,
          tableOrQueue: order.queueNumber ? `Antrean #${order.queueNumber}` : '',
          customerName: order.notes || '',
          orderedAtLabel: formatTime(order.createdAt),
          cashierName: order.cashierName,
          source: SOURCE_LABELS[order.source] ?? order.source,
          ticketLabel: seq > 1 ? `ORDER — TAMBAHAN #${seq}` : `ORDER ${station.toUpperCase()}`,
          paperSize: settings.receiptPaperSize,
          lines: stationItems.map(toLine),
        }
        await enqueuePrintJob({
          kind: 'kitchen_ticket',
          station,
          payload,
          title: `Tiket ${station} — ${order.orderNumber}${seq > 1 ? ` (tambahan #${seq})` : ''}`,
          orderId,
          ticketId: ticket.id,
          idempotencyKey: `kt_${orderId}_${ticket.id}`,
          requestedBy: actor.userId,
          requestedByName: actor.userName,
        })
      }
    },
  )

  await processPrintQueue()
  return { stations: [...byStation.keys()], itemCount: items.length }
}

/** Cetak ulang satu kitchen ticket (hanya item tiket itu) — ber-audit + label. */
export async function reprintKitchenTicket(
  ticketId: string,
  actor: { userId: string; userName: string },
): Promise<void> {
  const ticket = await db.kitchenTickets.get(ticketId)
  if (!ticket) return
  const order = await db.orders.get(ticket.orderId)
  if (!order) return
  const settings = await getSettings()
  const items = await db.orderItems.where('id').anyOf(ticket.itemIds).toArray()
  const reprintCount = await db.printJobs
    .where('ticketId')
    .equals(ticketId)
    .filter((j) => j.isReprint)
    .count()

  await db.transaction('rw', [db.printJobs, db.printers, db.syncQueue, db.auditLogs], async () => {
    await enqueuePrintJob({
      kind: 'kitchen_ticket',
      station: ticket.station as PrinterStation,
      payload: {
        outletName: settings.cafeName,
        orderNumber: order.orderNumber,
        tableOrQueue: order.queueNumber ? `Antrean #${order.queueNumber}` : '',
        customerName: order.notes || '',
        orderedAtLabel: formatTime(order.createdAt),
        cashierName: order.cashierName,
        source: SOURCE_LABELS[order.source] ?? order.source,
        ticketLabel: `*** CETAK ULANG *** TIKET #${ticket.sequenceNo}`,
        paperSize: settings.receiptPaperSize,
        lines: items.filter((i) => !i.voided).map(toLine),
      } satisfies KitchenTicketPayload,
      title: `Cetak ulang tiket #${ticket.sequenceNo} — ${order.orderNumber}`,
      orderId: order.id,
      ticketId,
      isReprint: true,
      idempotencyKey: `kt_${order.id}_${ticketId}_reprint_${reprintCount + 1}`,
      requestedBy: actor.userId,
      requestedByName: actor.userName,
    })
  })
  await processPrintQueue()
}
