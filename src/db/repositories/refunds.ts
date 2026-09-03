import { db } from '@/db/schema'
import type { Refund } from '@/types/domain'

export async function listRefunds(range?: { from: number; to: number }): Promise<Refund[]> {
  if (range) {
    return db.refunds.where('createdAt').between(range.from, range.to, true, true).reverse().sortBy('createdAt')
  }
  return db.refunds.orderBy('createdAt').reverse().toArray()
}

export async function listRefundsForOrder(orderId: string): Promise<Refund[]> {
  return db.refunds.where('orderId').equals(orderId).sortBy('createdAt')
}
