import { db } from '@/db/schema'
import { buildSalesReport } from '@/db/repositories/reports'
import { businessDisplayName, getSettings } from '@/db/repositories/settings'
import { buildShiftSummary } from '@/db/repositories/shifts'
import { formatDate, formatTime, startOfJakartaDay } from '@/lib/datetime'
import { dailySummaryMessage, type DailySummaryInput } from '@/lib/dailySummary'
import type { Shift } from '@/types/domain'

/** Shift terakhir yang sudah ditutup di perangkat ini (untuk mengirim ulang ringkasannya). */
export async function getLastClosedShift(): Promise<Shift | null> {
  const closed = await db.shifts.where('status').equals('closed').toArray()
  return closed.sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))[0] ?? null
}

export async function buildDailySummaryInput(shiftId: string): Promise<DailySummaryInput> {
  const [summary, settings] = await Promise.all([buildShiftSummary(shiftId), getSettings()])
  const { shift } = summary
  const paidIds = (await db.orders.where('shiftId').equals(shiftId).toArray()).filter((o) => o.status === 'paid' || o.status === 'completed').map((o) => o.id)
  const qtyByProduct = new Map<string, number>()
  if (paidIds.length) {
    await db.orderItems
      .where('orderId')
      .anyOf(paidIds)
      .each((i) => {
        if (!i.voided && !i.removed) qtyByProduct.set(i.productName, (qtyByProduct.get(i.productName) ?? 0) + i.qty)
      })
  }
  const dailyTarget = settings.salesTargets?.daily ?? 0
  const todaySales = dailyTarget > 0 ? (await buildSalesReport({ from: startOfJakartaDay(0), to: Date.now() })).revenue : undefined
  return {
    businessName: businessDisplayName(settings),
    dateLabel: formatDate(shift.openedAt),
    cashierName: shift.cashierName,
    openedLabel: formatTime(shift.openedAt),
    closedLabel: formatTime(shift.closedAt ?? Date.now()),
    totalSales: summary.totalSales,
    transactionCount: summary.transactionCount,
    cashSales: summary.cashSales,
    nonCashSales: summary.nonCashSales,
    discountTotal: summary.discountTotal,
    returnTotal: summary.returnTotal,
    totalExpenses: summary.totalExpenses,
    voidCount: summary.voidCount,
    expectedCash: shift.expectedCash,
    actualCash: shift.closingCashActual,
    variance: shift.variance,
    topProducts: Array.from(qtyByProduct.entries())
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5),
    todaySales,
    dailyTarget,
    notes: shift.notes,
  }
}

export async function buildDailySummaryMessage(shiftId: string): Promise<string> {
  return dailySummaryMessage(await buildDailySummaryInput(shiftId))
}
