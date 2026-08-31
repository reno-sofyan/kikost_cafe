import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { createUser, listUsers, setUserActive, updateUser, updateUserPin } from '@/db/repositories/users'
import { ROLE_LABELS } from '@/lib/permissions'
import { isValidPinFormat } from '@/lib/pinHash'
import type { Role, User } from '@/types/domain'

export function UserManager() {
  const users = useLiveQuery(() => listUsers(), []) ?? []
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)

  return (
    <div className="max-w-2xl">
      <button className="btn-primary mb-4" onClick={() => { setEditing(null); setShowForm(true) }}>
        + Pengguna Baru
      </button>
      <div className="space-y-2">
        {users.map((u) => (
          <div key={u.id} className="card flex items-center justify-between p-4">
            <div>
              <p className="font-semibold text-ink-50">{u.name}</p>
              <p className="text-sm text-ink-400">{ROLE_LABELS[u.role]}</p>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-ink-400">
                <input type="checkbox" checked={u.active} onChange={(e) => void setUserActive(u.id, e.target.checked)} />
                Aktif
              </label>
              <button
                className="btn-secondary !min-h-0 !px-3 !py-1.5 text-sm"
                onClick={() => {
                  setEditing(u)
                  setShowForm(true)
                }}
              >
                Edit
              </button>
            </div>
          </div>
        ))}
      </div>

      {showForm && <UserFormModal initial={editing} onClose={() => setShowForm(false)} />}
    </div>
  )
}

function UserFormModal({ initial, onClose }: { initial: User | null; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [role, setRole] = useState<Role>(initial?.role ?? 'kasir')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!name.trim()) {
      setError('Nama wajib diisi')
      return
    }
    if (!initial && !isValidPinFormat(pin)) {
      setError('PIN harus 4-8 digit angka')
      return
    }
    if (initial) {
      await updateUser(initial.id, { name: name.trim(), role })
      if (pin) {
        if (!isValidPinFormat(pin)) {
          setError('PIN harus 4-8 digit angka')
          return
        }
        await updateUserPin(initial.id, pin)
      }
    } else {
      await createUser({ name: name.trim(), role, pin })
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-ink-900 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-ink-50">{initial ? 'Edit Pengguna' : 'Pengguna Baru'}</h2>
        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-ink-300">Nama</span>
          <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-ink-300">Role</span>
          <select className="input-field" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-ink-300">{initial ? 'PIN Baru (kosongkan jika tidak diubah)' : 'PIN (4-8 digit)'}</span>
          <input
            type="password"
            inputMode="numeric"
            className="input-field"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
        </label>
        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
        <div className="flex gap-3">
          <button className="btn-ghost flex-1" onClick={onClose}>
            Batal
          </button>
          <button className="btn-primary flex-[2]" onClick={() => void handleSave()}>
            Simpan
          </button>
        </div>
      </div>
    </div>
  )
}
