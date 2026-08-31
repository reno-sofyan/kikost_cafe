import { db } from '@/db/schema'
import { newId } from '@/lib/id'
import { hashPin, verifyPin } from '@/lib/pinHash'
import type { Role, User } from '@/types/domain'

export async function createUser(input: { name: string; role: Role; pin: string }): Promise<User> {
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
  await db.users.add(user)
  return user
}

export async function listUsers(): Promise<User[]> {
  return db.users.orderBy('name').toArray()
}

export async function listActiveUsers(): Promise<User[]> {
  return db.users.filter((u) => u.active).toArray()
}

export async function setUserActive(userId: string, active: boolean): Promise<void> {
  await db.users.update(userId, { active, updatedAt: Date.now() })
}

export async function updateUserPin(userId: string, newPin: string): Promise<void> {
  const { hash, salt } = await hashPin(newPin)
  await db.users.update(userId, { pinHash: hash, pinSalt: salt, updatedAt: Date.now() })
}

export async function updateUser(
  userId: string,
  patch: Partial<Pick<User, 'name' | 'role'>>,
): Promise<void> {
  await db.users.update(userId, { ...patch, updatedAt: Date.now() })
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

/** Memverifikasi PIN milik supervisor/administrator untuk otorisasi tindakan sensitif. */
export async function verifySupervisorPin(pin: string): Promise<User | null> {
  const approvers = await db.users
    .filter((u) => u.active && (u.role === 'administrator' || u.role === 'supervisor'))
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
