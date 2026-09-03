import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import type { KitchenTicket } from '@/types/domain'

/**
 * Ambang "pesanan tambahan": item yang ditambahkan lebih dari sekian lama setelah
 * tiket terakhir order dianggap tiket baru (sequenceNo berikutnya), bukan bagian
 * dari tiket yang sedang diproses dapur.
 */
const ADDITIONAL_TICKET_GAP_MS = 90_000

/**
 * Menempatkan sebuah item order ke kitchen ticket yang sesuai — di dalam transaksi
 * pemanggil (harus mencakup `db.kitchenTickets` & `db.syncQueue`). Mengembalikan
 * id tiket. Tiket ke-2+ untuk satu order = pesanan tambahan.
 */
export async function assignItemToTicket(orderId: string, itemId: string, at: number): Promise<string> {
  const tickets = await db.kitchenTickets.where('orderId').equals(orderId).sortBy('sequenceNo')
  const latest = tickets[tickets.length - 1]

  if (latest && at - latest.createdAt <= ADDITIONAL_TICKET_GAP_MS) {
    await db.kitchenTickets.update(latest.id, {
      itemIds: [...latest.itemIds, itemId],
      updatedAt: at,
    })
    const updated = await db.kitchenTickets.get(latest.id)
    if (updated) await enqueueSync('kitchenTickets', latest.id, updated)
    return latest.id
  }

  const ticket: KitchenTicket = {
    id: newId(),
    orderId,
    sequenceNo: (latest?.sequenceNo ?? 0) + 1,
    station: 'all',
    itemIds: [itemId],
    printedAt: null,
    createdAt: at,
    updatedAt: at,
  }
  await db.kitchenTickets.add(ticket)
  await enqueueSync('kitchenTickets', ticket.id, ticket)
  return ticket.id
}

export async function listTicketsForOrder(orderId: string): Promise<KitchenTicket[]> {
  return db.kitchenTickets.where('orderId').equals(orderId).sortBy('sequenceNo')
}

export async function markTicketPrinted(ticketId: string): Promise<void> {
  await db.transaction('rw', db.kitchenTickets, db.syncQueue, async () => {
    const at = Date.now()
    await db.kitchenTickets.update(ticketId, { printedAt: at, updatedAt: at })
    const updated = await db.kitchenTickets.get(ticketId)
    if (updated) await enqueueSync('kitchenTickets', ticketId, updated)
  })
}
