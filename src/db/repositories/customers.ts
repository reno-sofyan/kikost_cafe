import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import type { Customer, Order } from '@/types/domain'

export async function listCustomers(): Promise<Customer[]> {
  return db.customers.orderBy('name').toArray()
}

export async function searchCustomers(query: string): Promise<Customer[]> {
  const lowered = query.trim().toLowerCase()
  if (!lowered) return listCustomers()
  return db.customers
    .filter((c) => c.name.toLowerCase().includes(lowered) || c.phone.includes(lowered))
    .toArray()
}

export async function createCustomer(input: { name: string; phone: string; note: string }): Promise<Customer> {
  const now = Date.now()
  const customer: Customer = { ...input, id: newId(), createdAt: now, updatedAt: now }
  await db.transaction('rw', db.customers, db.syncQueue, async () => {
    await db.customers.add(customer)
    await enqueueSync('customers', customer.id, customer)
  })
  return customer
}

export async function updateCustomer(id: string, patch: Partial<Pick<Customer, 'name' | 'phone' | 'note'>>): Promise<void> {
  await db.transaction('rw', db.customers, db.syncQueue, async () => {
    await db.customers.update(id, { ...patch, updatedAt: Date.now() })
    const updated = await db.customers.get(id)
    if (updated) await enqueueSync('customers', id, updated)
  })
}

export async function purchaseHistoryForCustomer(customerId: string): Promise<Order[]> {
  return db.orders
    .where('status')
    .anyOf(['paid', 'completed'])
    .filter((o) => o.customerId === customerId)
    .reverse()
    .sortBy('createdAt')
}
