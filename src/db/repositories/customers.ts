import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import type { Customer, MarketingSalesProfile, Order } from '@/types/domain'
import { getTrustedNow } from '@/lib/clockGuard'

export async function listCustomers(): Promise<Customer[]> {
  // Voucher hadiah & sales marketing disimpan di tabel yang sama — bukan pelanggan sungguhan.
  return (await db.customers.orderBy('name').toArray()).filter(isRealCustomer)
}

export async function searchCustomers(query: string): Promise<Customer[]> {
  const lowered = query.trim().toLowerCase()
  if (!lowered) return listCustomers()
  return db.customers
    .filter((c) => isRealCustomer(c) && (c.name.toLowerCase().includes(lowered) || c.phone.includes(lowered)))
    .toArray()
}

/** Bukan voucher hadiah & bukan sales tim marketing. */
export function isRealCustomer(c: Customer): boolean {
  return !c.giftCard && !c.marketingSales
}

/** Sales tim marketing (Pelanggan → Tim Marketing). `activeOnly` untuk pilihan kasir. */
export async function listMarketingSales(activeOnly = false): Promise<Customer[]> {
  return (await db.customers.orderBy('name').toArray()).filter((c) => !!c.marketingSales && (!activeOnly || c.marketingSales.active))
}

export async function saveMarketingSales(
  id: string | null,
  input: { name: string; phone: string; note: string } & MarketingSalesProfile,
): Promise<Customer> {
  const name = input.name.trim()
  if (!name) throw new Error('Nama sales wajib diisi')
  const now = getTrustedNow()
  return db.transaction('rw', db.customers, db.syncQueue, async () => {
    const existing = id ? await db.customers.get(id) : undefined
    const sales: Customer = {
      ...(existing ?? { id: newId(), createdAt: now }),
      name,
      phone: input.phone.trim(),
      note: input.note.trim(),
      marketingSales: { division: input.division.trim(), photoDataUrl: input.photoDataUrl, active: input.active },
      updatedAt: now,
    }
    await db.customers.put(sales)
    await enqueueSync('customers', sales.id, sales)
    return sales
  })
}

export async function createCustomer(input: { name: string; phone: string; note: string; birthDate?: string | null }): Promise<Customer> {
  const now = getTrustedNow()
  const customer: Customer = { ...input, id: newId(), createdAt: now, updatedAt: now }
  await db.transaction('rw', db.customers, db.syncQueue, async () => {
    await db.customers.add(customer)
    await enqueueSync('customers', customer.id, customer)
  })
  return customer
}

export async function updateCustomer(id: string, patch: Partial<Pick<Customer, 'name' | 'phone' | 'note' | 'birthDate'>>): Promise<void> {
  await db.transaction('rw', db.customers, db.syncQueue, async () => {
    await db.customers.update(id, { ...patch, updatedAt: getTrustedNow() })
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
