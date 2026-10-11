import { db } from '@/db/schema'
import { recordAuditLog } from '@/db/repositories/auditLog'
import type { DateRange } from '@/db/repositories/reports'
import type { AuditLogEntry } from '@/types/domain'

/**
 * Penilaian tamu (1–5 bintang + komentar) setelah pembayaran. Disimpan sebagai
 * entri Log Aktivitas (`feedback.rating`): append-only & ikut sinkron, tanpa
 * mengubah pesanan yang sudah lunas. Satu penilaian per pesanan.
 */
const ACTION = 'feedback.rating'
const DETAILS = /^Penilaian tamu ★(\d)\/5 untuk (\S+)\.(?: Komentar: ([\s\S]*))?$/

export interface OrderFeedback {
  id: string
  orderId: string
  orderNumber: string
  rating: number
  comment: string
  createdAt: number
  recordedBy: string
}

function parse(entry: AuditLogEntry): OrderFeedback | null {
  const m = DETAILS.exec(entry.details)
  if (!m) return null
  return { id: entry.id, orderId: entry.entityId, orderNumber: m[2], rating: Number(m[1]), comment: m[3] ?? '', createdAt: entry.createdAt, recordedBy: entry.userName }
}

async function allFeedback(): Promise<OrderFeedback[]> {
  const rows = await db.auditLogs.where('entityType').equals('feedback').toArray()
  return rows.filter((e) => e.action === ACTION).map(parse).filter((f): f is OrderFeedback => f !== null)
}

export async function getOrderFeedback(orderId: string): Promise<OrderFeedback | null> {
  return (await allFeedback()).find((f) => f.orderId === orderId) ?? null
}

export async function recordOrderFeedback(params: { orderId: string; rating: number; comment: string; actor: { userId: string; userName: string } }): Promise<void> {
  const rating = Math.round(params.rating)
  if (!(rating >= 1 && rating <= 5)) throw new Error('Pilih 1 sampai 5 bintang.')
  const order = await db.orders.get(params.orderId)
  if (!order) throw new Error('Pesanan tidak ditemukan')
  if (await getOrderFeedback(params.orderId)) throw new Error('Pesanan ini sudah dinilai.')
  const comment = params.comment.trim().replace(/\s+/g, ' ').slice(0, 300)
  await recordAuditLog({
    ...params.actor,
    action: ACTION,
    entityType: 'feedback',
    entityId: order.id,
    details: `Penilaian tamu ★${rating}/5 untuk ${order.orderNumber}.${comment ? ` Komentar: ${comment}` : ''}`,
  })
}

export interface FeedbackReport {
  count: number
  average: number
  /** Jumlah penilaian per bintang, indeks 0 = ★1 … 4 = ★5. */
  distribution: number[]
  /** Persen penilaian ★4–5. */
  satisfiedPercent: number
  /** Penilaian berkomentar atau ★1–3, terbaru dulu — yang perlu dibaca pengelola. */
  notable: OrderFeedback[]
}

export async function buildFeedbackReport(range: DateRange): Promise<FeedbackReport> {
  const rows = (await allFeedback()).filter((f) => f.createdAt >= range.from && f.createdAt <= range.to)
  const distribution = [0, 0, 0, 0, 0]
  for (const f of rows) distribution[f.rating - 1] += 1
  const count = rows.length
  return {
    count,
    average: count ? rows.reduce((s, f) => s + f.rating, 0) / count : 0,
    distribution,
    satisfiedPercent: count ? ((distribution[3] + distribution[4]) / count) * 100 : 0,
    notable: rows.filter((f) => f.comment || f.rating <= 3).sort((a, b) => b.createdAt - a.createdAt).slice(0, 30),
  }
}
