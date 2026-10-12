import { db } from '@/db/schema'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { createExpense } from '@/db/repositories/expenses'
import { getSettings, updateSettings } from '@/db/repositories/settings'
import { getOpenShift } from '@/db/repositories/shifts'
import { isValidRosterTime } from '@/lib/roster'
import type { StaffPay, StaffRoster } from '@/types/domain'

type Actor = { userId: string; userName: string }

export const PAYROLL_EXPENSE_CATEGORY = 'Gaji & Upah'

/** Menyimpan (atau menghapus dengan `null`) tarif gaji seorang karyawan. */
export async function saveStaffPay(userId: string, pay: StaffPay | null, actor: Actor): Promise<void> {
  if (pay && !(pay.rate > 0)) throw new Error('Tarif harus lebih dari 0.')
  const current = { ...((await getSettings()).staffPay ?? {}) }
  if (pay) current[userId] = { name: pay.name.trim(), type: pay.type, rate: Math.round(pay.rate) }
  else delete current[userId]
  await updateSettings({ staffPay: current })
  await recordAuditLog({
    ...actor,
    action: 'staff.pay_rate',
    entityType: 'settings',
    entityId: 'singleton',
    details: pay ? `Tarif gaji ${pay.name} diatur Rp${Math.round(pay.rate).toLocaleString('id-ID')} ${pay.type === 'hourly' ? 'per jam' : 'per hari'}.` : 'Tarif gaji seorang karyawan dihapus.',
  })
}

/** Menyimpan jadwal mingguan seorang karyawan (hari tanpa jam = libur; semua kosong = jadwal dihapus). */
export async function saveStaffRoster(userId: string, roster: StaffRoster, actor: Actor): Promise<void> {
  const days: StaffRoster['days'] = {}
  for (const [day, slot] of Object.entries(roster.days)) {
    if (!slot) continue
    if (!isValidRosterTime(slot.start) || !isValidRosterTime(slot.end)) throw new Error('Jam jadwal harus berformat JJ:MM.')
    if (slot.start === slot.end) throw new Error('Jam mulai dan selesai tidak boleh sama.')
    days[Number(day)] = { start: slot.start, end: slot.end }
  }
  const current = { ...((await getSettings()).staffRoster ?? {}) }
  if (Object.keys(days).length) current[userId] = { name: roster.name.trim(), days }
  else delete current[userId]
  await updateSettings({ staffRoster: current })
  await recordAuditLog({ ...actor, action: 'staff.roster', entityType: 'settings', entityId: 'singleton', details: `Jadwal kerja ${roster.name} diubah (${Object.keys(days).length} hari kerja per minggu).` })
}

export function payrollExpenseNote(userName: string, periodKey: string): string {
  return `Gaji ${userName} periode ${periodKey}`
}

/** Gaji yang SUDAH dicatat sebagai pengeluaran untuk periode ini: nama karyawan → total. */
export async function listRecordedPayroll(periodKey: string): Promise<Map<string, number>> {
  const suffix = ` periode ${periodKey}`
  const map = new Map<string, number>()
  await db.expenses.each((e) => {
    if (e.category !== PAYROLL_EXPENSE_CATEGORY || !e.note.startsWith('Gaji ') || !e.note.endsWith(suffix)) return
    const name = e.note.slice(5, e.note.length - suffix.length)
    map.set(name, (map.get(name) ?? 0) + e.amount)
  })
  return map
}

/**
 * Mencatat gaji sebagai pengeluaran "Gaji & Upah". `fromDrawer` = dibayar tunai dari
 * laci kasir (mengurangi kas seharusnya shift yang sedang buka); selain itu hanya dicatat.
 */
export async function recordPayrollExpense(params: { userName: string; amount: number; periodKey: string; fromDrawer: boolean; actor: Actor }): Promise<void> {
  const amount = Math.round(params.amount)
  if (!(amount > 0)) throw new Error('Nominal gaji harus lebih dari 0.')
  let shiftId: string | null = null
  if (params.fromDrawer) {
    const shift = await getOpenShift()
    if (!shift) throw new Error('Buka shift terlebih dahulu untuk membayar gaji dari laci kasir.')
    shiftId = shift.id
  }
  const expense = await createExpense({ category: PAYROLL_EXPENSE_CATEGORY, amount, note: payrollExpenseNote(params.userName, params.periodKey), shiftId, userId: params.actor.userId })
  await recordAuditLog({
    ...params.actor,
    action: 'staff.payroll_paid',
    entityType: 'expense',
    entityId: expense.id,
    details: `Gaji ${params.userName} periode ${params.periodKey} dicatat Rp${amount.toLocaleString('id-ID')}${params.fromDrawer ? ' (dari laci kasir)' : ''}.`,
  })
}
