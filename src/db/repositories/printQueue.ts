import { db } from '@/db/schema'

import { recordAuditLog } from '@/db/repositories/auditLog'
import { activePrinterForStation } from '@/db/repositories/printers'
import { buildEscPosKitchenTicket, buildEscPosReceipt } from '@/features/printing/escpos'
import { sendEscPosBytes } from '@/features/printing/printerDrivers'
import type { ReceiptData } from '@/features/printing/receiptData'
import type { KitchenTicketPayload, Printer, PrintJob, PrintJobKind, PrinterStation } from '@/types/domain'

const MAX_ATTEMPTS = 5
const RETRY_BASE_MS = 4000

function backoffReady(job: PrintJob): boolean {
  if (job.status === 'QUEUED') return true
  if (job.status !== 'RETRYING') return false
  const wait = Math.min(RETRY_BASE_MS * 2 ** Math.min(job.attempts, 5), 5 * 60_000)
  return Date.now() - job.updatedAt >= wait
}

/**
 * Menambahkan pekerjaan cetak ke antrean. Idempoten: kunci yang sama tak membuat
 * job kedua (retry jaringan / klik ganda aman). Printer diselesaikan dari station.
 */
export async function enqueuePrintJob(params: {
  kind: PrintJobKind
  station: PrinterStation
  payload: ReceiptData | KitchenTicketPayload
  title: string
  orderId?: string
  ticketId?: string
  isReprint?: boolean
  idempotencyKey: string
  requestedBy: string
  requestedByName: string
}): Promise<PrintJob> {
  const existing = await db.printJobs.where('id').equals(params.idempotencyKey).first()
  if (existing) return existing

  const printer = await activePrinterForStation(params.station)
  const now = Date.now()
  const job: PrintJob = {
    id: params.idempotencyKey,
    idempotencyKey: params.idempotencyKey,
    kind: params.kind,
    station: params.station,
    printerId: printer?.id ?? null,
    payload: params.payload,
    title: params.title,
    isReprint: params.isReprint ?? false,
    orderId: params.orderId ?? null,
    ticketId: params.ticketId ?? null,
    requestedBy: params.requestedBy,
    requestedByName: params.requestedByName,
    status: 'QUEUED',
    attempts: 0,
    lastError: printer ? null : `Tidak ada printer aktif untuk station "${params.station}"`,
    createdAt: now,
    updatedAt: now,
    printedAt: null,
  }
  await db.printJobs.add(job)
  if (params.isReprint) {
    await recordAuditLog({
      userId: params.requestedBy,
      userName: params.requestedByName,
      action: params.kind === 'receipt' ? 'receipt.reprint' : 'kitchen.ticket.reprint',
      entityType: 'printJob',
      entityId: job.id,
      details: `Cetak ulang: ${params.title}`,
    })
  }
  return job
}

function targetFrom(printer: Printer) {
  return {
    connectionType: printer.connectionType,
    bluetoothAddress: printer.bluetoothAddress,
    networkHost: printer.networkHost,
    networkPort: printer.networkPort,
  }
}

async function runJob(job: PrintJob): Promise<void> {
  const now = Date.now()
  await db.printJobs.update(job.id, { status: 'PRINTING', updatedAt: now })
  try {
    let printer = job.printerId ? await db.printers.get(job.printerId) : null
    if (!printer || !printer.active) printer = await activePrinterForStation(job.station)
    if (!printer) throw new Error(`Tidak ada printer aktif untuk station "${job.station}"`)

    const bytes =
      job.kind === 'receipt'
        ? buildEscPosReceipt(job.payload as ReceiptData)
        : buildEscPosKitchenTicket(job.payload as KitchenTicketPayload)

    try {
      await sendEscPosBytes(targetFrom(printer), bytes)
    } catch (err) {
      // Alihkan ke printer cadangan sekali bila dikonfigurasi.
      if (printer.fallbackPrinterId) {
        const fb = await db.printers.get(printer.fallbackPrinterId)
        if (fb?.active) {
          await sendEscPosBytes(targetFrom(fb), bytes)
          await db.printJobs.update(job.id, { printerId: fb.id })
        } else throw err
      } else throw err
    }

    await db.printJobs.update(job.id, {
      status: 'PRINTED',
      printedAt: Date.now(),
      updatedAt: Date.now(),
      lastError: null,
    })
  } catch (err) {
    const attempts = job.attempts + 1
    const msg = err instanceof Error ? err.message : 'Gagal mencetak'
    await db.printJobs.update(job.id, {
      status: attempts >= MAX_ATTEMPTS ? 'PERMANENTLY_FAILED' : 'RETRYING',
      attempts,
      lastError: msg,
      updatedAt: Date.now(),
    })
  }
}

let running = false

/** Memproses semua job yang siap. Aman dipanggil berulang (guard `running`). */
export async function processPrintQueue(): Promise<void> {
  if (running) return
  running = true
  try {
    const candidates = await db.printJobs.where('status').anyOf(['QUEUED', 'RETRYING']).sortBy('createdAt')
    for (const job of candidates) {
      if (backoffReady(job)) await runJob(job)
    }
  } finally {
    running = false
  }
}

export async function retryPrintJob(jobId: string, actor: { userId: string; userName: string }): Promise<void> {
  const job = await db.printJobs.get(jobId)
  if (!job) return
  await db.printJobs.update(jobId, { status: 'QUEUED', updatedAt: Date.now(), lastError: null })
  await recordAuditLog({
    userId: actor.userId,
    userName: actor.userName,
    action: 'print.retry',
    entityType: 'printJob',
    entityId: jobId,
    details: `Retry cetak: ${job.title}`,
  })
  await processPrintQueue()
}

export async function listPrintJobs(limit = 100): Promise<PrintJob[]> {
  return db.printJobs.orderBy('createdAt').reverse().limit(limit).toArray()
}

export async function countActivePrintFailures(): Promise<number> {
  return db.printJobs.where('status').anyOf(['FAILED', 'PERMANENTLY_FAILED']).count()
}
