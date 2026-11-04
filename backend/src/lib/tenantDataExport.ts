import type { Pool } from 'pg'
import { buildXlsx, type Cell, type Sheet } from './xlsx.js'
import { buildTenantExport, loadCancellationReport, loadSalesReport, numField, parseWibRange } from './tenantReports.js'
import { loadAttendanceLog } from './staffAttendance.js'
import { ownerConsoleAreaFor } from './ownerConsole.js'

/**
 * Ekspor data mentah satu usaha ke Excel (.xlsx) untuk konsol Pemilik & operator.
 * `kind` = satu jenis data, atau `all` = semua jenis sekaligus (satu sheet per jenis).
 * Periode tanggal WIB; `from = 'all'` = sejak data pertama usaha ini.
 */

export const DATA_EXPORT_KINDS = {
  all: 'Semua data',
  summary: 'Ringkasan',
  transactions: 'Transaksi',
  items: 'Item terjual',
  products: 'Rekap menu',
  payments: 'Pembayaran',
  cancellations: 'Pembatalan',
  shifts: 'Shift',
  expenses: 'Pengeluaran & kas',
  payLater: 'Tagihan Tertunda',
  proofs: 'Bukti bayar',
  attendance: 'Absensi',
  hppPricing: 'KOL & Compliment',
} as const
export type DataExportKind = keyof typeof DATA_EXPORT_KINDS

/** Jenis data yang relevan per area konsol (kantin vs kafe). */
export function dataExportKindsFor(businessType: string | null): DataExportKind[] {
  const area = ownerConsoleAreaFor(businessType)
  const common: DataExportKind[] = ['all', 'summary', 'transactions', 'items', 'products', 'payments', 'cancellations', 'shifts', 'expenses']
  if (area === 'kantin') return [...common, 'payLater', 'proofs']
  if (area === 'kafe') return [...common, 'attendance', 'hppPricing']
  return common
}

/** Rentang maksimal untuk ekspor Excel — jauh lebih longgar dari PDF (92 hari). */
const MAX_EXPORT_DAYS = 3 * 366

// Payload tersinkron = JSON bebas dari tablet; dibaca defensif lewat num()/String().
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type P = Record<string, any>
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const WIB = 7 * 3600_000
const wibDate = (ms: unknown) => (num(ms) ? new Date(num(ms) + WIB).toISOString().slice(0, 10) : '')
const wibTime = (ms: unknown) => (num(ms) ? new Date(num(ms) + WIB).toISOString().slice(11, 16) : '')
const wibDateTime = (ms: unknown) => (num(ms) ? `${wibDate(ms)} ${wibTime(ms)}` : '')
const METHOD: Record<string, string> = { cash: 'Tunai', qris: 'QRIS', transfer: 'Transfer', card: 'Kartu', deposit: 'Saldo Member', giftcard: 'Voucher', platform: 'Via Aplikasi' }
const TYPE: Record<string, string> = { dine_in: 'Makan di tempat', takeaway: 'Bawa pulang', delivery: 'Online' }
const isPayLater = (o: P) => !!o.payLater && typeof o.payLater === 'object'
const recognized = (o: P) => ['paid', 'completed'].includes(o.status) || (o.status === 'open' && isPayLater(o))
const statusLabel = (o: P) => (o.status === 'void' ? 'Batal' : ['paid', 'completed'].includes(o.status) ? 'Lunas' : isPayLater(o) ? 'Tagihan Tertunda' : 'Terbuka')

async function entityRows(pool: Pool, tenantId: string, entity: string, timeField: string | null, sinceMs: number, untilMs: number): Promise<P[]> {
  const { rows } = await pool.query<{ payload: P }>(
    `SELECT payload - 'photoDataUrl' - 'logoDataUrl' AS payload FROM sync_entity_state
      WHERE tenant_id = $1 AND entity = $2 AND deleted = FALSE
        ${timeField ? `AND ${numField(timeField)} >= $3 AND ${numField(timeField)} < $4` : ''}
      ORDER BY ${numField(timeField ?? 'createdAt')} ASC NULLS LAST`,
    timeField ? [tenantId, entity, sinceMs, untilMs] : [tenantId, entity],
  )
  return rows.map((r) => r.payload)
}

async function rowsByOrderIds(pool: Pool, tenantId: string, entity: string, orderIds: string[]): Promise<P[]> {
  if (!orderIds.length) return []
  const { rows } = await pool.query<{ payload: P }>(
    `SELECT payload - 'photoDataUrl' AS payload FROM sync_entity_state
      WHERE tenant_id = $1 AND entity = $2 AND deleted = FALSE AND payload->>'orderId' = ANY($3::text[])`,
    [tenantId, entity, orderIds],
  )
  return rows.map((r) => r.payload)
}

/** Data pertama usaha ini (epoch ms), untuk periode "Semua data". */
export async function firstDataAt(pool: Pool, tenantId: string): Promise<number | null> {
  const { rows } = await pool.query<{ first: string | null }>(
    `SELECT min(CASE WHEN entity = 'shifts' THEN ${numField('openedAt')} ELSE ${numField('createdAt')} END) AS first
       FROM sync_entity_state
      WHERE tenant_id = $1 AND deleted = FALSE AND entity IN ('orders', 'payments', 'shifts', 'expenses')`,
    [tenantId],
  )
  return rows[0]?.first == null ? null : Number(rows[0].first)
}

export type DataExport = { ok: true; body: Buffer; filename: string } | { ok: false; status: number; error: string }

export async function buildTenantDataExport(pool: Pool, tenantId: string, kind: string, from: string | undefined, to: string | undefined): Promise<DataExport> {
  const settings = (await pool.query<{ payload: P }>(`SELECT payload - 'logoDataUrl' AS payload FROM sync_entity_state WHERE tenant_id = $1 AND entity = 'settings' AND entity_id = 'singleton' AND deleted = FALSE`, [tenantId])).rows[0]?.payload ?? {}
  const allowed = dataExportKindsFor(settings.businessType ?? null)
  if (!(allowed as string[]).includes(kind)) return { ok: false, status: 404, error: 'Jenis data tidak dikenal untuk usaha ini' }

  let fromDate = from
  let toDate = to
  if (from === 'all') {
    const first = await firstDataAt(pool, tenantId)
    fromDate = wibDate(first ?? Date.now())
    toDate = wibDate(Date.now())
  }
  const range = parseWibRange(fromDate, toDate, Date.now(), MAX_EXPORT_DAYS)
  if ('error' in range) return { ok: false, status: 400, error: range.error }
  const { sinceMs, untilMs } = range
  const want = (k: DataExportKind) => kind === 'all' ? allowed.includes(k) && k !== 'all' : kind === k

  // Data dasar dimuat sekali dan dipakai beberapa sheet.
  const needOrders = ['transactions', 'items', 'products', 'payLater', 'hppPricing'].some((k) => want(k as DataExportKind))
  const orders = needOrders ? await entityRows(pool, tenantId, 'orders', 'createdAt', sinceMs, untilMs) : []
  const orderIds = orders.map((o) => String(o.id))
  const items = want('items') || want('products') || want('hppPricing') ? await rowsByOrderIds(pool, tenantId, 'orderItems', orderIds) : []
  const orderPayments = needOrders ? await rowsByOrderIds(pool, tenantId, 'payments', orderIds) : []
  const paidByOrder = new Map<string, number>()
  const methodsByOrder = new Map<string, Set<string>>()
  for (const p of orderPayments) {
    if (num(p.amount) <= 0 || p.reversalOfPaymentId) continue
    paidByOrder.set(p.orderId, (paidByOrder.get(p.orderId) ?? 0) + num(p.amount))
    const m = methodsByOrder.get(p.orderId) ?? new Set<string>()
    m.add(METHOD[p.method] ?? p.method)
    methodsByOrder.set(p.orderId, m)
  }
  const orderById = new Map(orders.map((o) => [String(o.id), o]))
  const categories = new Map((await entityRows(pool, tenantId, 'categories', null, 0, 0)).map((c) => [c.id, c.name]))
  const userNames = new Map<string, string>()

  const sheets: Sheet[] = []

  if (want('summary')) {
    const r = await loadSalesReport(pool, tenantId, sinceMs, untilMs)
    const rows: Cell[][] = [
      ['Usaha', settings.businessName ?? tenantId],
      ['Periode', range.label],
      ['Dibuat', wibDateTime(Date.now()) + ' WIB'],
      ['Dasar pencatatan', 'Akrual: omzet menurut tanggal pesanan; tagihan belum dibayar = piutang'],
      [],
      ['Omzet (penjualan diakui)', r.totals.revenue],
      ['Jumlah transaksi', r.totals.count],
      ['Rata-rata per transaksi', r.totals.avgTicket],
      ['Belum dibayar (piutang)', r.totals.receivable],
      ['Pelunasan piutang (uang masuk dari pesanan tanggal lain)', r.settlements.value],
      ['Diskon', r.totals.discount],
      ...(r.totals.tips ? [['Tip', r.totals.tips] as Cell[]] : []),
      [],
      ['Metode pembayaran', 'Nilai', 'Jumlah'],
      ...r.byMethod.map((m) => [m.label, m.amount, m.count]),
      [],
      ['Jenis pesanan', 'Omzet', 'Transaksi'],
      ...r.byType.map((t) => [t.label, t.revenue, t.count]),
    ]
    sheets.push({ name: 'Ringkasan', header: ['Keterangan', 'Nilai', ''], rows, widths: [52, 36, 14] })
  }

  if (want('transactions')) {
    sheets.push({
      name: 'Transaksi',
      header: ['No. pesanan', 'Tanggal', 'Jam', 'Status', 'Jenis', 'Kasir', 'Pelayan', 'Catatan / pembeli', 'Subtotal', 'Diskon', 'Pajak', 'Service', 'Pembulatan', 'Total', 'Dibayar', 'Sisa', 'Metode bayar', 'Tagihan Tertunda (nama)', 'KOL / Compliment', 'Alasan batal'],
      rows: orders.map((o) => [
        o.orderNumber, wibDate(o.createdAt), wibTime(o.createdAt), statusLabel(o), TYPE[o.type] ?? o.type, o.cashierName, o.waiterName, o.notes,
        num(o.subtotal), num(o.discountAmount), num(o.taxAmount), num(o.serviceChargeAmount), num(o.roundingAdjustment), num(o.grandTotal),
        paidByOrder.get(String(o.id)) ?? 0, o.status === 'void' ? 0 : Math.max(0, num(o.grandTotal) - (paidByOrder.get(String(o.id)) ?? 0)),
        [...(methodsByOrder.get(String(o.id)) ?? [])].join(', '), isPayLater(o) ? o.payLater.name : '',
        o.hppPricing ? `${o.hppPricing.kind === 'kol' ? 'KOL' : 'Compliment'} - ${o.hppPricing.name}` : '', o.voidReason,
      ]),
    })
  }

  if (want('items')) {
    sheets.push({
      name: 'Item terjual',
      header: ['No. pesanan', 'Tanggal', 'Jam', 'Status pesanan', 'Menu', 'Kategori', 'Qty', 'Harga satuan', 'Tambahan', 'Diskon item', 'Total', 'Status item', 'Alasan hapus', 'Catatan'],
      rows: items
        .map((i) => ({ i, o: orderById.get(String(i.orderId)) }))
        .sort((a, b) => num(a.o?.createdAt) - num(b.o?.createdAt))
        .map(({ i, o }) => [
          o?.orderNumber, wibDate(o?.createdAt), wibTime(o?.createdAt), o ? statusLabel(o) : '', i.productName, categories.get(i.categoryId) ?? '', num(i.qty), num(i.unitPrice),
          (i.modifiers ?? []).filter((m: P) => m.groupId !== 'combo').map((m: P) => m.optionName).join(', '), num(i.discountAmount), num(i.lineTotal),
          i.removed ? 'Dihapus' : i.voided ? 'Void' : 'Aktif', i.removedReason ?? i.voidReason ?? '', i.notes,
        ]),
    })
  }

  if (want('products')) {
    const recognizedIds = new Set(orders.filter(recognized).map((o) => String(o.id)))
    const agg = new Map<string, { name: string; cat: string; qty: number; revenue: number; orders: Set<string> }>()
    for (const i of items) {
      if (!recognizedIds.has(String(i.orderId)) || i.removed || i.voided) continue
      const key = String(i.productName ?? 'Tanpa nama').trim()
      const a = agg.get(key) ?? { name: key, cat: categories.get(i.categoryId) ?? '', qty: 0, revenue: 0, orders: new Set<string>() }
      a.qty += num(i.qty)
      a.revenue += num(i.lineTotal)
      a.orders.add(String(i.orderId))
      agg.set(key, a)
    }
    const list = [...agg.values()].sort((a, b) => b.revenue - a.revenue)
    const total = list.reduce((s, a) => s + a.revenue, 0)
    sheets.push({
      name: 'Rekap menu',
      header: ['Menu', 'Kategori', 'Qty terjual', 'Omzet item', 'Jumlah pesanan', 'Porsi omzet (%)'],
      rows: list.map((a) => [a.name, a.cat, a.qty, a.revenue, a.orders.size, total ? Math.round((a.revenue / total) * 1000) / 10 : 0]),
    })
  }

  if (want('payments')) {
    const pays = await entityRows(pool, tenantId, 'payments', 'createdAt', sinceMs, untilMs)
    const payOrders = new Map((await (async () => {
      const ids = [...new Set(pays.map((p) => String(p.orderId)))].filter((id) => !orderById.has(id))
      if (!ids.length) return []
      const { rows } = await pool.query<{ payload: P }>(`SELECT payload FROM sync_entity_state WHERE tenant_id = $1 AND entity = 'orders' AND entity_id = ANY($2::text[])`, [tenantId, ids])
      return rows.map((r) => r.payload)
    })()).map((o) => [String(o.id), o]))
    const orderOf = (id: string) => orderById.get(id) ?? payOrders.get(id)
    sheets.push({
      name: 'Pembayaran',
      header: ['Tanggal', 'Jam', 'No. pesanan', 'Metode', 'Jumlah', 'Uang diterima', 'Kembalian', 'Tip', 'Referensi', 'Tanggal pesanan', 'Pelunasan hari lain?', 'Pembalikan?'],
      rows: pays.map((p) => {
        const o = orderOf(String(p.orderId))
        return [
          wibDate(p.createdAt), wibTime(p.createdAt), o?.orderNumber ?? '', METHOD[p.method] ?? p.method, num(p.amount), p.receivedAmount == null ? '' : num(p.receivedAmount), p.changeAmount == null ? '' : num(p.changeAmount),
          p.tipAmount ? num(p.tipAmount) : '', p.reference ?? '', wibDate(o?.createdAt), o && wibDate(o.createdAt) !== wibDate(p.createdAt) ? 'Ya' : '', p.reversalOfPaymentId ? 'Ya' : '',
        ]
      }),
    })
  }

  if (want('cancellations')) {
    const days = Math.max(1, Math.round((untilMs - sinceMs) / 86_400_000))
    const c = await loadCancellationReport(pool, tenantId, sinceMs, untilMs, days)
    const STAGE: Record<string, string> = { paid: 'Sudah dibayar', kitchen: 'Sudah ke dapur', unprocessed: 'Belum diproses' }
    const APPROVAL: Record<string, string> = { self: 'Sendiri', supervisor: 'Supervisor', owner_code: 'Kode Pemilik' }
    sheets.push({
      name: 'Pembatalan',
      header: ['Tanggal batal', 'Jam', 'No. pesanan', 'Tanggal pesanan', 'Kasir', 'Tahap', 'Alasan', 'Diminta oleh', 'Disetujui oleh', 'Persetujuan', 'Item sebelum batal', 'Nilai', 'Dikosongkan dulu?'],
      rows: [...c.rows].sort((a, b) => num(a.voidedAt) - num(b.voidedAt)).map((r) => [
        wibDate(r.voidedAt), wibTime(r.voidedAt), r.orderNumber, wibDate(r.createdAt), r.cashierName, STAGE[r.stage] ?? r.stage, r.reason, r.requestedBy, r.approvedBy, r.approval ? APPROVAL[r.approval] : '',
        r.corrections.filter((x) => x.kind !== 'reduced').map((x) => `${x.name} x${x.qty}`).join(', '), r.value, r.emptiedFirst ? 'Ya' : '',
      ]),
    })
  }

  if (want('shifts') || want('expenses')) {
    for (const o of await entityRows(pool, tenantId, 'shifts', null, 0, 0)) if (o.cashierId) userNames.set(o.cashierId, o.cashierName)
  }

  if (want('shifts')) {
    const shifts = await entityRows(pool, tenantId, 'shifts', 'openedAt', sinceMs, untilMs)
    sheets.push({
      name: 'Shift',
      header: ['Dibuka', 'Ditutup', 'Kasir', 'Status', 'Modal awal', 'Kas seharusnya', 'Kas aktual', 'Selisih', 'Catatan'],
      rows: shifts.map((s) => {
        const closed = s.status === 'closed'
        return [wibDateTime(s.openedAt), closed ? wibDateTime(s.closedAt) : '', s.cashierName, closed ? 'Ditutup' : 'Masih buka', num(s.openingCash), closed ? num(s.expectedCash) : '', closed ? num(s.closingCashActual) : '', closed ? num(s.variance) : '', s.notes]
      }),
    })
  }

  if (want('expenses')) {
    const [expenses, moves] = await Promise.all([
      entityRows(pool, tenantId, 'expenses', 'createdAt', sinceMs, untilMs),
      entityRows(pool, tenantId, 'cashMovements', 'createdAt', sinceMs, untilMs),
    ])
    const rows = [
      ...expenses.map((e) => ({ at: num(e.createdAt), row: [wibDate(e.createdAt), wibTime(e.createdAt), 'Pengeluaran', e.category ?? '', e.note ?? '', num(e.amount), userNames.get(e.userId) ?? ''] as Cell[] })),
      ...moves.map((m) => ({ at: num(m.createdAt), row: [wibDate(m.createdAt), wibTime(m.createdAt), m.type === 'in' ? 'Kas masuk laci' : 'Kas keluar laci', '', m.reason ?? '', num(m.amount), userNames.get(m.userId) ?? ''] as Cell[] })),
    ].sort((a, b) => a.at - b.at)
    sheets.push({ name: 'Pengeluaran & kas', header: ['Tanggal', 'Jam', 'Jenis', 'Kategori', 'Catatan / alasan', 'Nilai', 'Oleh'], rows: rows.map((r) => r.row) })
  }

  if (want('payLater')) {
    sheets.push({
      name: 'Tagihan Tertunda',
      header: ['Nama', 'No. pesanan', 'Dicatat', 'Dicatat oleh', 'Catatan', 'Nilai', 'Status', 'Dilunasi', 'Sisa', 'Metode pelunasan'],
      rows: orders.filter((o) => isPayLater(o) && o.status !== 'void').map((o) => {
        const paid = paidByOrder.get(String(o.id)) ?? 0
        const lunas = ['paid', 'completed'].includes(o.status)
        return [o.payLater.name, o.orderNumber, wibDateTime(o.payLater.markedAt ?? o.createdAt), o.payLater.markedByName, o.payLater.note, num(o.grandTotal), lunas ? 'Lunas' : 'Belum dibayar', lunas ? wibDateTime(o.paidAt) : '', lunas ? 0 : Math.max(0, num(o.grandTotal) - paid), [...(methodsByOrder.get(String(o.id)) ?? [])].join(', ')]
      }),
    })
  }

  if (want('proofs')) {
    const { rows } = await pool.query<{ p: P; o: P | null; has_photo: boolean }>(
      `SELECT pr.payload - 'photoDataUrl' AS p, coalesce(pr.payload->>'photoDataUrl', '') <> '' AS has_photo, o.payload AS o
         FROM sync_entity_state pr
         LEFT JOIN sync_entity_state o ON o.tenant_id = pr.tenant_id AND o.entity = 'orders' AND o.entity_id = pr.payload->>'orderId'
        WHERE pr.tenant_id = $1 AND pr.entity = 'paymentProofs' AND pr.deleted = FALSE
          AND ${numField('createdAt').replace(/payload/g, 'pr.payload')} >= $2 AND ${numField('createdAt').replace(/payload/g, 'pr.payload')} < $3
        ORDER BY ${numField('createdAt').replace(/payload/g, 'pr.payload')} ASC`,
      [tenantId, sinceMs, untilMs],
    )
    sheets.push({
      name: 'Bukti bayar',
      header: ['Tanggal', 'Jam', 'No. pesanan', 'Total pesanan', 'Diambil oleh', 'Ada foto?', 'Alasan tanpa foto'],
      rows: rows.map((r) => [wibDate(r.p.createdAt), wibTime(r.p.createdAt), r.o?.orderNumber ?? '', num(r.o?.grandTotal), r.p.takenByName ?? '', r.has_photo ? 'Ya' : 'Tidak', r.p.noPhotoReason ?? '']),
    })
  }

  if (want('attendance')) {
    const log = await loadAttendanceLog(pool, tenantId, sinceMs, untilMs)
    const SOURCE: Record<string, string> = { phone: 'HP', manual: 'Manual', pin: 'PIN' }
    sheets.push({
      name: 'Absensi',
      header: ['Tanggal', 'Jam', 'Karyawan', 'Absen', 'Cara', 'HP', 'Selfie?', 'Lokasi (lat,lng)', 'Keterangan'],
      rows: [...log.rows].sort((a, b) => a.createdAt - b.createdAt).map((r) => [
        wibDate(r.createdAt), wibTime(r.createdAt), r.userName, r.type === 'in' ? 'Masuk' : 'Pulang', SOURCE[r.source] ?? r.source, r.phoneLabel ?? '', r.source === 'phone' ? (r.hasSelfie ? 'Ya' : 'Tidak') : '',
        r.location ? `${r.location.latitude.toFixed(6)},${r.location.longitude.toFixed(6)}` : '', r.details,
      ]),
    })
  }

  if (want('hppPricing')) {
    const normalByOrder = new Map<string, number>()
    for (const i of items) {
      if (i.removed || i.voided || !i.normalPrice) continue
      const np = i.normalPrice
      normalByOrder.set(i.orderId, (normalByOrder.get(i.orderId) ?? 0) + Math.max(0, (num(np.unitPrice) + (np.modifierDeltas ?? []).reduce((s: number, d: number) => s + num(d), 0)) * num(i.qty) - num(np.discountAmount)))
    }
    sheets.push({
      name: 'KOL & Compliment',
      header: ['Tanggal', 'Jam', 'No. pesanan', 'Jenis', 'Penerima', 'Alasan', 'Oleh', 'Status', 'Dibayar (HPP)', 'Harga jual normal', 'Nilai diberikan'],
      rows: orders.filter((o) => o.hppPricing).map((o) => {
        const normal = normalByOrder.get(String(o.id)) ?? num(o.grandTotal)
        return [wibDate(o.createdAt), wibTime(o.createdAt), o.orderNumber, o.hppPricing.kind === 'kol' ? 'KOL' : 'Compliment', o.hppPricing.name, o.hppPricing.reason, o.hppPricing.approvedByName, statusLabel(o), num(o.grandTotal), normal, normal - num(o.grandTotal)]
      }),
    })
  }

  const label = kind === 'all' ? 'semua-data' : String(kind).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
  return { ok: true, body: buildXlsx(sheets), filename: `${label}-${tenantId}-${range.fileLabel}.xlsx` }
}

export type AnyExport = { ok: true; body: Buffer; filename: string; contentType: string } | { ok: false; status: number; error: string }

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Satu pintu ekspor untuk /owner & /ops: `<jenis>.xlsx` (data Excel) atau PDF lama (`transactions.pdf`, `cancellations.pdf`). */
export async function buildAnyTenantExport(pool: Pool, tenantId: string, kind: string, from: string | undefined, to: string | undefined): Promise<AnyExport> {
  if (kind.endsWith('.xlsx')) {
    const r = await buildTenantDataExport(pool, tenantId, kind.slice(0, -5), from, to)
    return r.ok ? { ok: true, body: r.body, filename: r.filename, contentType: XLSX_TYPE } : r
  }
  const r = await buildTenantExport(pool, tenantId, kind, from, to)
  return r.ok ? { ok: true, body: Buffer.from(r.pdf), filename: r.filename, contentType: 'application/pdf' } : r
}
