import { db } from '@/db/schema'
import { enqueueSync } from '@/sync/outbox'
import { newId } from '@/lib/id'
import type { ModifierGroup, ModifierOption } from '@/types/domain'

export async function listModifierGroups(): Promise<ModifierGroup[]> {
  return db.modifierGroups.orderBy('sortOrder').toArray()
}

export async function listModifierOptions(groupId: string): Promise<ModifierOption[]> {
  return db.modifierOptions.where('groupId').equals(groupId).sortBy('sortOrder')
}

export async function listModifierOptionsForGroups(groupIds: string[]): Promise<Record<string, ModifierOption[]>> {
  const all = await db.modifierOptions.where('groupId').anyOf(groupIds).sortBy('sortOrder')
  const grouped: Record<string, ModifierOption[]> = {}
  for (const option of all) {
    grouped[option.groupId] ??= []
    grouped[option.groupId]!.push(option)
  }
  return grouped
}

export async function createModifierGroup(input: Omit<ModifierGroup, 'id' | 'createdAt' | 'updatedAt'>): Promise<ModifierGroup> {
  const now = Date.now()
  const group: ModifierGroup = { ...input, id: newId(), createdAt: now, updatedAt: now }
  await db.transaction('rw', db.modifierGroups, db.syncQueue, async () => {
    await db.modifierGroups.add(group)
    await enqueueSync('modifierGroups', group.id, group)
  })
  return group
}

export async function createModifierOption(input: Omit<ModifierOption, 'id'>): Promise<ModifierOption> {
  const option: ModifierOption = { ...input, id: newId() }
  await db.transaction('rw', db.modifierOptions, db.syncQueue, async () => {
    await db.modifierOptions.add(option)
    await enqueueSync('modifierOptions', option.id, option)
  })
  return option
}

export async function updateModifierGroup(id: string, patch: Partial<Omit<ModifierGroup, 'id'>>): Promise<void> {
  await db.transaction('rw', db.modifierGroups, db.syncQueue, async () => {
    await db.modifierGroups.update(id, { ...patch, updatedAt: Date.now() })
    const updated = await db.modifierGroups.get(id)
    if (updated) await enqueueSync('modifierGroups', id, updated)
  })
}

export async function updateModifierOption(id: string, patch: Partial<Omit<ModifierOption, 'id'>>): Promise<void> {
  await db.transaction('rw', db.modifierOptions, db.syncQueue, async () => {
    await db.modifierOptions.update(id, patch)
    const updated = await db.modifierOptions.get(id)
    if (updated) await enqueueSync('modifierOptions', id, updated)
  })
}

// Catatan: penghapusan modifier tidak disinkronkan (aksi admin, jarang).
// Katalog QR membaca state terkini; opsi terhapus yang masih ter-cache di server
// tersaring saat validasi harga di endpoint publik.
export async function deleteModifierOption(id: string): Promise<void> {
  await db.modifierOptions.delete(id)
}

export async function deleteModifierGroup(id: string): Promise<void> {
  await db.transaction('rw', db.modifierGroups, db.modifierOptions, async () => {
    await db.modifierGroups.delete(id)
    await db.modifierOptions.where('groupId').equals(id).delete()
  })
}
