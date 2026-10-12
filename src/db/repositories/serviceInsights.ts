import { db } from '@/db/schema'
import { getSettings } from '@/db/repositories/settings'
import type { DateRange } from '@/db/repositories/reports'
import { buildKitchenSpeed, kitchenTargetMinutesOf, prepMinutesOf, waitingMinutesOf, type KitchenSpeed } from '@/lib/kitchenSpeed'
import type { AppSettings, OrderItem, RouteStation } from '@/types/domain'

export const STATION_LABELS: Record<string, string> = { kitchen: 'Dapur', bar: 'Bar', cashier: 'Kasir', direct: 'Langsung' }

/** Pemetaan produk → stasiun (aturan kategori → aturan default → dapur), dimuat sekali. */
async function stationLookup(): Promise<(productId: string) => RouteStation> {
  const [routes, products] = await Promise.all([db.printRoutes.toArray(), db.products.toArray()])
  const categoryOf = new Map(products.map((p) => [p.id, p.categoryId]))
  const byCategory = new Map(routes.filter((r) => r.categoryId !== null).map((r) => [r.categoryId as string, r.station]))
  const fallback = routes.find((r) => r.categoryId === null)?.station ?? 'kitchen'
  return (productId) => byCategory.get(categoryOf.get(productId) ?? '') ?? fallback
}

const isKitchenWork = (i: OrderItem) => !i.voided && !i.removed && !i.skipKitchen

/** Kecepatan dapur untuk item yang SELESAI disiapkan dalam rentang: per stasiun & ketepatan terhadap batas. */
export async function buildKitchenSpeedReport(range: DateRange): Promise<KitchenSpeed> {
  const target = kitchenTargetMinutesOf(await getSettings())
  const stationOf = await stationLookup()
  const rows: { productName: string; station: string; minutes: number }[] = []
  await db.orderItems.each((item) => {
    if (!isKitchenWork(item)) return
    const end = item.readyAt ?? item.servedAt
    if (end == null || end < range.from || end > range.to) return
    const minutes = prepMinutesOf(item)
    // Lebih dari 6 jam = lupa ditandai siap, bukan lama memasak.
    if (minutes == null || minutes > 360) return
    rows.push({ productName: item.productName, station: stationOf(item.productId), minutes })
  })
  return buildKitchenSpeed(rows, target)
}

export interface LateKitchenOrder {
  orderId: string
  orderNumber: string
  /** Meja / antrean / nama pembeli — untuk dikenali pelayan. */
  label: string
  /** Menit menunggu item terlama yang belum siap. */
  minutes: number
  itemCount: number
}

/** Pesanan yang masih dikerjakan dapur/bar melewati batas menit (kosong bila batas dimatikan). */
export async function listLateKitchenOrders(now: number, settings?: AppSettings): Promise<LateKitchenOrder[]> {
  const target = kitchenTargetMinutesOf(settings ?? (await getSettings()))
  if (target <= 0) return []
  const pending = await db.orderItems
    .where('kitchenStatus')
    .anyOf(['new', 'in_progress'])
    // Hanya yang sudah dikirim: item tahap saji yang masih ditahan belum jadi tanggungan dapur.
    .filter((i) => isKitchenWork(i) && (i.kitchenPrintedAt != null || i.kitchenStatus !== 'new'))
    .toArray()
  const byOrder = new Map<string, { minutes: number; count: number }>()
  for (const item of pending) {
    const waited = waitingMinutesOf(item, now)
    if (waited <= target) continue
    const row = byOrder.get(item.orderId) ?? { minutes: 0, count: 0 }
    row.minutes = Math.max(row.minutes, waited)
    row.count += 1
    byOrder.set(item.orderId, row)
  }
  if (byOrder.size === 0) return []
  const orders = await db.orders.where('id').anyOf([...byOrder.keys()]).toArray()
  const tables = new Map((await db.cafeTables.toArray()).map((t) => [t.id, t.name]))
  return orders
    .filter((o) => o.status !== 'void')
    .map((o) => ({
      orderId: o.id,
      orderNumber: o.orderNumber,
      label: (o.tableId && tables.get(o.tableId)) || (o.queueNumber ? `Antrean #${o.queueNumber}` : '') || o.notes || '',
      minutes: byOrder.get(o.id)!.minutes,
      itemCount: byOrder.get(o.id)!.count,
    }))
    .sort((a, b) => b.minutes - a.minutes)
}

// ---------------------------------------------------------------- Perputaran meja

export const DEFAULT_TABLE_LONG_STAY_MINUTES = 90

export function tableLongStayMinutesOf(settings: Pick<AppSettings, 'tableLongStayMinutes'> | null | undefined): number {
  const v = settings?.tableLongStayMinutes
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : DEFAULT_TABLE_LONG_STAY_MINUTES
}

export interface TableTurnoverRow {
  tableId: string
  tableName: string
  visits: number
  guests: number
  avgMinutes: number
  revenue: number
}

export interface TableTurnover {
  visits: number
  avgMinutes: number
  /** Rata-rata berapa kali satu meja terisi per hari dalam rentang. */
  turnsPerTablePerDay: number
  longStayCount: number
  longStayMinutes: number
  rows: TableTurnoverRow[]
}

/** Lama duduk & perputaran meja dari pesanan dine-in bermeja yang LUNAS dalam rentang (buka pesanan → bayar). */
export async function buildTableTurnover(range: DateRange): Promise<TableTurnover> {
  const longStayMinutes = tableLongStayMinutesOf(await getSettings())
  const tables = await db.cafeTables.toArray()
  const nameOf = new Map(tables.map((t) => [t.id, t.name]))
  const orders = await db.orders
    .where('type')
    .equals('dine_in')
    .filter((o) => !!o.tableId && (o.status === 'paid' || o.status === 'completed') && o.paidAt != null && o.paidAt >= range.from && o.paidAt <= range.to)
    .toArray()
  const byTable = new Map<string, TableTurnoverRow & { totalMinutes: number }>()
  let totalMinutes = 0
  let visits = 0
  let longStayCount = 0
  for (const o of orders) {
    const minutes = ((o.paidAt as number) - o.createdAt) / 60_000
    // Di atas 12 jam = pesanan dibiarkan terbuka, bukan lama duduk yang sebenarnya.
    if (!(minutes > 0) || minutes > 720) continue
    const id = o.tableId as string
    const row = byTable.get(id) ?? { tableId: id, tableName: nameOf.get(id) ?? 'Meja terhapus', visits: 0, guests: 0, avgMinutes: 0, revenue: 0, totalMinutes: 0 }
    row.visits += 1
    row.guests += o.guestCount ?? 0
    row.revenue += o.grandTotal
    row.totalMinutes += minutes
    byTable.set(id, row)
    totalMinutes += minutes
    visits += 1
    if (longStayMinutes > 0 && minutes > longStayMinutes) longStayCount += 1
  }
  const days = Math.max(1, Math.ceil((Math.min(range.to, Date.now()) - range.from) / 86_400_000))
  const tableCount = Math.max(1, tables.length)
  return {
    visits,
    avgMinutes: visits ? Math.round(totalMinutes / visits) : 0,
    turnsPerTablePerDay: Math.round((visits / tableCount / days) * 10) / 10,
    longStayCount,
    longStayMinutes,
    rows: Array.from(byTable.values())
      .map(({ totalMinutes: t, ...row }) => ({ ...row, avgMinutes: Math.round(t / row.visits) }))
      .sort((a, b) => b.visits - a.visits),
  }
}
