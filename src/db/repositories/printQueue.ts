import { db } from '@/db/schema'

import { recordAuditLog } from '@/db/repositories/auditLog'
import { activePrinterForStation } from '@/db/repositories/printers'
import { buildEscPosKitchenTicket, buildEscPosReceipt } from '@/features/printing/escpos'
import { sendEscPosBytes, warmUpPrinter } from '@/features/printing/printerDrivers'
import type { ReceiptData } from '@/features/printing/receiptData'
import type { KitchenTicketPayload, Printer, PrintJob, PrintJobKind, PrinterStation } from '@/types/domain'

const MAX_ATTEMPTS = 5
/** Retry ke-1 setelah 4 dtk, lalu 8, 16, 32 — dijadwalkan tepat waktu (lihat
 *  `scheduleNextRetry`), bukan menunggu tik berkala print engine (15 dtk). */
const RETRY_BASE_MS = 2000

function retryWaitMs(job: PrintJob): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.min(job.attempts, 5), 5 * 60_000)
}

function backoffReady(job: PrintJob): boolean {
  if (job.status === 'QUEUED') return true
  if (job.status !== 'RETRYING') return false
  return Date.now() - job.updatedAt >= retryWaitMs(job)
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

/** Kunci printer FISIK tujuan sebuah job (dua entri printer bisa menunjuk alat yang sama). */
async function physicalPrinterKey(job: PrintJob): Promise<string> {
  let printer = job.printerId ? await db.printers.get(job.printerId) : null
  if (!printer || !printer.active) printer = await activePrinterForStation(job.station)
  if (!printer) return `none:${job.station}`
  if (printer.connectionType === 'bluetooth') return `bt:${printer.bluetoothAddress ?? printer.id}`
  if (printer.connectionType === 'network') return `net:${printer.networkHost}:${printer.networkPort}`
  return `printer:${printer.id}`
}

async function readyJobsByPrinter(): Promise<Map<string, PrintJob[]>> {
  const candidates = (await db.printJobs.where('status').anyOf(['QUEUED', 'RETRYING']).sortBy('createdAt')).filter(backoffReady)
  const byPrinter = new Map<string, PrintJob[]>()
  for (const job of candidates) {
    const key = await physicalPrinterKey(job)
    const list = byPrinter.get(key) ?? []
    list.push(job)
    byPrinter.set(key, list)
  }
  return byPrinter
}

/**
 * Satu "pekerja" per printer fisik: job printer itu dijalankan berurutan (satu
 * printer tak bisa dua koneksi), tapi antar-printer berjalan PARALEL dan saling
 * bebas — printer dapur yang mati/lama menyambung (sampai 20 dtk per percobaan)
 * tak lagi menahan struk di printer kasir, termasuk struk yang masuk saat printer
 * dapur sedang macet.
 */
const workers = new Map<string, Promise<void>>()
const rerunRequested = new Set<string>()
let retryTimer: ReturnType<typeof setTimeout> | null = null

function startWorker(key: string): Promise<void> {
  const existing = workers.get(key)
  if (existing) {
    rerunRequested.add(key)
    return existing
  }
  const worker = (async () => {
    do {
      rerunRequested.delete(key)
      const jobs = (await readyJobsByPrinter()).get(key) ?? []
      for (const job of jobs) await runJob(job)
    } while (rerunRequested.has(key))
  })().finally(() => {
    workers.delete(key)
    // Permintaan yang tiba tepat saat pekerja selesai jangan sampai hilang.
    if (rerunRequested.delete(key)) void startWorker(key)
    void scheduleNextRetry().catch(() => {})
  })
  workers.set(key, worker)
  return worker
}

/** Jadwalkan putaran berikutnya tepat saat job RETRYING terdekat siap dicoba lagi. */
async function scheduleNextRetry(): Promise<void> {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  const retrying = await db.printJobs.where('status').equals('RETRYING').toArray()
  if (retrying.length === 0) return
  const due = Math.min(...retrying.map((j) => j.updatedAt + retryWaitMs(j)))
  retryTimer = setTimeout(() => void processPrintQueue(), Math.max(250, due - Date.now()))
}

/**
 * Memproses semua job yang siap: tiap printer yang punya job mendapat pekerjanya
 * (atau pekerja yang sudah jalan diminta mengecek ulang). Promise selesai setelah
 * job-job yang siap saat ini — di semua printer — selesai diproses.
 */
const scans = new Set<Promise<void>>()

export function processPrintQueue(): Promise<void> {
  // Pemindaian dicatat SINKRON, supaya `printQueueIdle` yang dipanggil tepat
  // sesudahnya ikut menunggu walau pekerjanya belum sempat terdaftar.
  const scan = (async () => {
    const byPrinter = await readyJobsByPrinter()
    await Promise.all([...byPrinter.keys()].map((key) => startWorker(key)))
  })()
  scans.add(scan)
  void scan.finally(() => scans.delete(scan)).catch(() => {})
  return scan
}

/** Menunggu semua pemindaian & pekerja cetak selesai (untuk test & tombol "Proses"). */
export async function printQueueIdle(): Promise<void> {
  while (scans.size > 0 || workers.size > 0) await Promise.allSettled([...scans, ...workers.values()])
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

/**
 * Sambungkan lebih awal printer aktif untuk station-station ini (koneksi dipakai
 * ulang oleh plugin), supaya cetak berikutnya tak menunggu Bluetooth menyambung.
 */
export async function warmUpStationPrinters(stations: PrinterStation[]): Promise<void> {
  for (const station of stations) {
    const printer = await activePrinterForStation(station)
    if (printer) warmUpPrinter(targetFrom(printer))
  }
}
