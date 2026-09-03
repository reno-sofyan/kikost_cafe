import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import { recordAuditLog } from '@/db/repositories/auditLog'
import type { Printer, PrinterStation, PrintRoute } from '@/types/domain'

export async function listPrinters(): Promise<Printer[]> {
  return db.printers.orderBy('station').toArray()
}

export async function activePrinterForStation(station: PrinterStation): Promise<Printer | null> {
  const all = await db.printers.where('station').equals(station).toArray()
  return all.find((p) => p.active) ?? null
}

export async function savePrinter(
  input: Omit<Printer, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
  actor: { userId: string; userName: string },
): Promise<Printer> {
  const now = Date.now()
  const existing = input.id ? await db.printers.get(input.id) : undefined
  const printer: Printer = {
    ...input,
    id: input.id ?? newId(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await db.transaction('rw', db.printers, db.syncQueue, db.auditLogs, async () => {
    await db.printers.put(printer)
    await enqueueSync('printers', printer.id, printer)
    await recordAuditLog({
      userId: actor.userId,
      userName: actor.userName,
      action: existing ? 'printer.update' : 'printer.create',
      entityType: 'printer',
      entityId: printer.id,
      details: `Printer "${printer.name}" (${printer.station}, ${printer.connectionType})${printer.active ? '' : ' — nonaktif'}`,
    })
  })
  return printer
}

export async function deletePrinter(id: string, actor: { userId: string; userName: string }): Promise<void> {
  await db.transaction('rw', db.printers, db.syncQueue, db.auditLogs, async () => {
    const p = await db.printers.get(id)
    if (!p) return
    // Soft: nonaktifkan + hapus dari fallback lain. Baris tetap ada untuk histori job.
    await db.printers.put({ ...p, active: false, updatedAt: Date.now() })
    await enqueueSync('printers', id, { ...p, active: false, updatedAt: Date.now() })
    await db.printers
      .filter((x) => x.fallbackPrinterId === id)
      .modify({ fallbackPrinterId: null, updatedAt: Date.now() })
    await recordAuditLog({
      userId: actor.userId,
      userName: actor.userName,
      action: 'printer.disable',
      entityType: 'printer',
      entityId: id,
      details: `Printer "${p.name}" dinonaktifkan`,
    })
  })
}

// ---- Routing kategori → station ----

export async function listPrintRoutes(): Promise<PrintRoute[]> {
  return db.printRoutes.toArray()
}

/** Station untuk sebuah kategori: aturan spesifik → aturan default → 'kitchen'. */
export async function stationForCategory(categoryId: string | null): Promise<PrinterStation> {
  const routes = await db.printRoutes.toArray()
  if (categoryId) {
    const specific = routes.find((r) => r.categoryId === categoryId)
    if (specific) return specific.station
  }
  const def = routes.find((r) => r.categoryId === null)
  return def?.station ?? 'kitchen'
}

export async function setPrintRoute(categoryId: string | null, station: PrinterStation): Promise<void> {
  const routes = await db.printRoutes.toArray()
  const existing = routes.find((r) => r.categoryId === categoryId)
  const route: PrintRoute = {
    id: existing?.id ?? newId(),
    categoryId,
    station,
    updatedAt: Date.now(),
  }
  await db.transaction('rw', db.printRoutes, db.syncQueue, async () => {
    await db.printRoutes.put(route)
    await enqueueSync('printRoutes', route.id, route)
  })
}
