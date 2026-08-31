import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { createCategory, listCategories, updateCategory } from '@/db/repositories/categories'

export function CategoryManager() {
  const categories = useLiveQuery(() => listCategories(), []) ?? []
  const [newName, setNewName] = useState('')

  return (
    <div className="max-w-md">
      <div className="mb-4 flex gap-2">
        <input className="input-field flex-1" placeholder="Nama kategori baru" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button
          className="btn-primary"
          onClick={async () => {
            if (!newName.trim()) return
            await createCategory(newName.trim())
            setNewName('')
          }}
        >
          Tambah
        </button>
      </div>
      <div className="space-y-2">
        {categories.map((c) => (
          <div key={c.id} className="card flex items-center justify-between p-3">
            <span className="text-ink-100">{c.name}</span>
            <label className="flex items-center gap-2 text-sm text-ink-400">
              <input type="checkbox" checked={c.active} onChange={(e) => void updateCategory(c.id, { active: e.target.checked })} />
              Aktif
            </label>
          </div>
        ))}
      </div>
    </div>
  )
}
