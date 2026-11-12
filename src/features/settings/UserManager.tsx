import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { createUser, listUsers, LastUserManagerError, setUserActive, updateUser, updateUserPin } from '@/db/repositories/users'
import { ROLE_LABELS } from '@/lib/permissions'
import { isValidPinFormat } from '@/lib/pinHash'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { AccountAvatar } from '@/features/auth/AccountAvatar'
import { readFileAsResizedDataUrl } from '@/lib/image'
import { useSessionStore } from '@/state/sessionStore'
import { toast } from '@/state/toastStore'
import type { Role, User } from '@/types/domain'

export function UserManager() {
  const users = useLiveQuery(() => listUsers(), []) ?? []
  const currentUser = useSessionStore((s) => s.currentUser)!
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)

  async function handleToggleActive(user: User, active: boolean) {
    try {
      await setUserActive(user.id, active, { userId: currentUser.id, userName: currentUser.name })
    } catch (err) {
      toast.error(err instanceof LastUserManagerError ? err.message : 'Gagal mengubah status pengguna.')
    }
  }

  return (
    <div className="max-w-2xl">
      <button className="btn-primary mb-4" onClick={() => { setEditing(null); setShowForm(true) }}>
        + Pengguna Baru
      </button>
      <div className="space-y-2">
        {users.map((u) => (
          <div key={u.id} className="card flex items-center justify-between p-4">
            <div className="flex min-w-0 items-center gap-3">
              <AccountAvatar name={u.name} photoDataUrl={u.photoDataUrl} size="sm" />
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink-50">{u.name}</p>
                <p className="text-sm text-ink-400">{ROLE_LABELS[u.role]}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-ink-400">
                <input type="checkbox" checked={u.active} onChange={(e) => void handleToggleActive(u, e.target.checked)} />
                Aktif
              </label>
              <button
                className="btn-secondary !min-h-[2.75rem] !px-3 !py-1.5 text-sm"
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
  const currentUser = useSessionStore((s) => s.currentUser)!
  const [name, setName] = useState(initial?.name ?? '')
  const [role, setRole] = useState<Role>(initial?.role ?? 'kasir')
  const [pin, setPin] = useState('')
  const [photo, setPhoto] = useState<string | null>(initial?.photoDataUrl ?? null)
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
    const actor = { userId: currentUser.id, userName: currentUser.name }
    try {
      if (initial) {
        await updateUser(initial.id, { name: name.trim(), role, photoDataUrl: photo }, actor)
        if (pin) {
          if (!isValidPinFormat(pin)) {
            setError('PIN harus 4-8 digit angka')
            return
          }
          await updateUserPin(initial.id, pin, actor)
        }
      } else {
        await createUser({ name: name.trim(), role, pin, photoDataUrl: photo }, actor)
      }
    } catch (err) {
      setError(err instanceof LastUserManagerError ? err.message : 'Gagal menyimpan pengguna.')
      return
    }
    onClose()
  }

  return (
    <Modal onClose={onClose}>
        <h2 className="mb-4 text-lg font-bold text-ink-50">{initial ? 'Edit Pengguna' : 'Pengguna Baru'}</h2>
        <div className="mb-4 flex items-center gap-4">
          <AccountAvatar name={name || '?'} photoDataUrl={photo} size="lg" />
          <div className="flex flex-col items-start gap-1">
            <label className="kbtn kbtn-secondary kbtn-sm cursor-pointer">
              {photo ? 'Ganti Foto' : 'Ambil / Pilih Foto'}
              <input
                type="file"
                accept="image/*"
                capture="user"
                className="sr-only"
                aria-label="Foto profil"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  // Kecil saja: dipakai sebagai avatar di layar masuk.
                  if (file) setPhoto(await readFileAsResizedDataUrl(file, 256, 0.82))
                }}
              />
            </label>
            {photo && (
              <Button variant="ghost" size="sm" className="text-red-400" onClick={() => setPhoto(null)}>
                Hapus foto
              </Button>
            )}
            <span className="text-xs text-ink-300">Tampil di layar masuk. Tanpa foto, inisial yang dipakai.</span>
          </div>
        </div>
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
    </Modal>
  )
}
