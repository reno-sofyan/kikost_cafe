import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import { getSettings, updateSettings } from '@/db/repositories/settings'
import { recordAuditLog } from '@/db/repositories/auditLog'
import type { Outlet } from '@/types/domain'

export async function listOutlets(): Promise<Outlet[]> {
  return db.outlets.orderBy('id').toArray()
}

/** Outlet aktif di perangkat ini. Membuat satu default bila belum ada. */
export async function getActiveOutlet(): Promise<Outlet> {
  const settings = await getSettings()
  const all = await db.outlets.toArray()
  const active = all.find((o) => o.id === settings.activeOutletId) ?? all.find((o) => o.active) ?? all[0]
  if (active) return active

  const now = Date.now()
  const outlet: Outlet = {
    id: `outlet_${now.toString(36)}`,
    name: settings.cafeName || 'Kikost Cafe',
    address: settings.address || '',
    phone: settings.phone || '',
    timezone: 'Asia/Jakarta',
    active: true,
    createdAt: now,
    updatedAt: now,
  }
  await db.transaction('rw', db.outlets, db.settings, db.syncQueue, async () => {
    await db.outlets.add(outlet)
    await enqueueSync('outlets', outlet.id, outlet)
    await updateSettings({ activeOutletId: outlet.id })
  })
  return outlet
}

export async function getActiveOutletId(): Promise<string> {
  return (await getActiveOutlet()).id
}

export async function saveOutlet(
  input: Omit<Outlet, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
  actor: { userId: string; userName: string },
): Promise<Outlet> {
  const now = Date.now()
  const id = input.id ?? newId()
  const existing = await db.outlets.get(id)
  const outlet: Outlet = {
    id,
    name: input.name.trim(),
    address: input.address.trim(),
    phone: input.phone.trim(),
    timezone: input.timezone || 'Asia/Jakarta',
    active: input.active,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await db.transaction('rw', db.outlets, db.syncQueue, db.auditLogs, async () => {
    await db.outlets.put(outlet)
    await enqueueSync('outlets', id, outlet)
    await recordAuditLog({
      userId: actor.userId,
      userName: actor.userName,
      action: existing ? 'outlet.update' : 'outlet.create',
      entityType: 'outlet',
      entityId: id,
      details: `${existing ? 'Ubah' : 'Buat'} outlet ${outlet.name}`,
    })
  })
  return outlet
}

export async function setActiveOutlet(outletId: string): Promise<void> {
  const outlet = await db.outlets.get(outletId)
  if (!outlet) throw new Error('Outlet tidak ditemukan')
  await updateSettings({ activeOutletId: outletId })
}
