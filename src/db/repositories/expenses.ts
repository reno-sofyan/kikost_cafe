import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import { addExpectedCash } from '@/db/repositories/shifts'
import type { Expense } from '@/types/domain'

export const EXPENSE_CATEGORIES = [
  'Belanja Bahan Baku',
  'Operasional',
  'Gaji & Upah',
  'Listrik & Air',
  'Sewa',
  'Perbaikan & Perawatan',
  'Lain-lain',
] as const

export async function createExpense(input: {
  category: string
  amount: number
  note: string
  photoDataUrl?: string | null
  shiftId?: string | null
  userId: string
}): Promise<Expense> {
  return db.transaction('rw', db.expenses, db.shifts, db.syncQueue, async () => {
    const expense: Expense = {
      id: newId(),
      category: input.category,
      amount: input.amount,
      note: input.note,
      photoDataUrl: input.photoDataUrl ?? null,
      shiftId: input.shiftId ?? null,
      userId: input.userId,
      createdAt: Date.now(),
    }
    await db.expenses.add(expense)
    await enqueueSync('expenses', expense.id, expense)
    if (expense.shiftId) {
      await addExpectedCash(expense.shiftId, -expense.amount)
    }
    return expense
  })
}

export async function listExpenses(range?: { from: number; to: number }): Promise<Expense[]> {
  if (!range) return db.expenses.orderBy('createdAt').reverse().toArray()
  return db.expenses
    .where('createdAt')
    .between(range.from, range.to, true, true)
    .reverse()
    .sortBy('createdAt')
}
