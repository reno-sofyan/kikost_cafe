import { db } from '@/db/schema'
import { newId } from '@/lib/id'
import { hashPin, verifyPin } from '@/lib/pinHash'
import { recordAuditLog } from '@/db/repositories/auditLog'
import { roleHasPermission, ROLE_LABELS, SUPERVISOR_APPROVAL_ROLES } from '@/lib/permissions'
import type { Role, User } from '@/types/domain'

type Actor = { userId: string; userName: string }

/** Dilempar bila suatu perubahan akan menyisakan nol akun yang bisa mengelola pengguna (users.manage). */
export class LastUserManagerError extends Error {
  constructor() {
    super('Tidak dapat mengubah pengguna ini — akun ini satu-satunya yang bisa mengelola pengguna. Aktifkan/tunjuk pengelola lain terlebih dahulu.')
    this.name = 'LastUserManagerError'
  }
}

async function countOtherActiveUserManagers(excludeUserId: string): Promise<number> {
  const others = await db.users
    .filter((u) => u.id !== excludeUserId && u.active && roleHasPermission(u.role, 'users.manage'))
    .count()
  return others
}

export async function createUser(input: { name: string; role: Role; pin: string }, actor?: Actor): Promise<User> {
  const { hash, salt } = await hashPin(input.pin)
  const now = Date.now()
  const user: User = {
    id: newId(),
    name: input.name,
    role: input.role,
    pinHash: hash,
    pinSalt: salt,
    active: true,
    createdAt: now,
    updatedAt: now,
  }
  await db.transaction('rw', db.users, db.syncQueue, db.auditLogs, async () => {
    await db.users.add(user)
    await recordAuditLog({
      userId: actor?.userId ?? user.id,
      userName: actor?.userName ?? user.name,
      action: 'user.create',
      entityType: 'user',
      entityId: user.id,
      details: `Pengguna "${user.name}" (${ROLE_LABELS[user.role]}) dibuat`,
    })
  })
  return user
}

export async function listUsers(): Promise<User[]> {
  return db.users.orderBy('name').toArray()
}

export async function listActiveUsers(): Promise<User[]> {
  return db.users.filter((u) => u.active).toArray()
}

export async function setUserActive(userId: string, active: boolean, actor: Actor): Promise<void> {
  await db.transaction('rw', db.users, db.syncQueue, db.auditLogs, async () => {
    const user = await db.users.get(userId)
    if (!user) return
    if (!active && user.active && roleHasPermission(user.role, 'users.manage')) {
      if ((await countOtherActiveUserManagers(userId)) === 0) throw new LastUserManagerError()
    }
    await db.users.update(userId, { active, updatedAt: Date.now() })
    await recordAuditLog({
      userId: actor.userId,
      userName: actor.userName,
      action: active ? 'user.activate' : 'user.deactivate',
      entityType: 'user',
      entityId: userId,
      details: `Pengguna "${user.name}" ${active ? 'diaktifkan' : 'dinonaktifkan'}`,
    })
  })
}

export async function updateUserPin(userId: string, newPin: string, actor: Actor): Promise<void> {
  const { hash, salt } = await hashPin(newPin)
  await db.transaction('rw', db.users, db.syncQueue, db.auditLogs, async () => {
    const user = await db.users.get(userId)
    if (!user) return
    await db.users.update(userId, { pinHash: hash, pinSalt: salt, updatedAt: Date.now() })
    await recordAuditLog({
      userId: actor.userId,
      userName: actor.userName,
      action: 'user.pin_reset',
      entityType: 'user',
      entityId: userId,
      details: `PIN pengguna "${user.name}" diubah`,
    })
  })
}

export async function updateUser(userId: string, patch: Partial<Pick<User, 'name' | 'role'>>, actor: Actor): Promise<void> {
  await db.transaction('rw', db.users, db.syncQueue, db.auditLogs, async () => {
    const user = await db.users.get(userId)
    if (!user) return
    if (
      user.active &&
      patch.role &&
      patch.role !== user.role &&
      roleHasPermission(user.role, 'users.manage') &&
      !roleHasPermission(patch.role, 'users.manage')
    ) {
      if ((await countOtherActiveUserManagers(userId)) === 0) throw new LastUserManagerError()
    }
    await db.users.update(userId, { ...patch, updatedAt: Date.now() })
    const changes: string[] = []
    if (patch.name && patch.name !== user.name) changes.push(`nama "${user.name}" → "${patch.name}"`)
    if (patch.role && patch.role !== user.role) changes.push(`role ${ROLE_LABELS[user.role]} → ${ROLE_LABELS[patch.role]}`)
    await recordAuditLog({
      userId: actor.userId,
      userName: actor.userName,
      action: 'user.update',
      entityType: 'user',
      entityId: userId,
      details: changes.length ? `Pengguna "${user.name}" diubah: ${changes.join(', ')}` : `Pengguna "${user.name}" disimpan`,
    })
  })
}

/** Mencoba login PIN terhadap seluruh pengguna aktif (PIN unik per pengguna). */
export async function findUserByPin(pin: string): Promise<User | null> {
  const activeUsers = await listActiveUsers()
  for (const user of activeUsers) {
    const matches = await verifyPin(pin, user.pinSalt, user.pinHash)
    if (matches) return user
  }
  return null
}

/** Memverifikasi PIN untuk satu pengguna yang sudah dipilih (mis. dari daftar pengguna). */
export async function verifyUserPin(userId: string, pin: string): Promise<User | null> {
  const user = await db.users.get(userId)
  if (!user || !user.active) return null
  const matches = await verifyPin(pin, user.pinSalt, user.pinHash)
  return matches ? user : null
}

/** Memverifikasi PIN milik supervisor/administrator untuk otorisasi tindakan sensitif. */
export async function verifySupervisorPin(pin: string): Promise<User | null> {
  const approvers = await db.users
    .filter((u) => u.active && SUPERVISOR_APPROVAL_ROLES.includes(u.role))
    .toArray()
  for (const user of approvers) {
    const matches = await verifyPin(pin, user.pinSalt, user.pinHash)
    if (matches) return user
  }
  return null
}

export async function hasAnyAdministrator(): Promise<boolean> {
  const count = await db.users.filter((u) => u.role === 'administrator' && u.active).count()
  return count > 0
}
