import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { createCategory, createKantinStarterCategories, KANTIN_STARTER_CATEGORIES, listCategories, updateCategory } from '@/db/repositories/categories'
import { setPrintRoute, stationForCategory } from '@/db/repositories/printers'
import { getSettings } from '@/db/repositories/settings'
import { featuresForBusinessType } from '@/lib/businessType'
import { RouteStationSelect } from '@/features/printing/RouteStationSelect'
import { toast } from '@/state/toastStore'

export function CategoryManager() {
  const categories = useLiveQuery(() => listCategories(), []) ?? []
  const settings = useLiveQuery(() => getSettings(), [])
  const [newName, setNewName] = useState('')
  const businessType = settings?.businessType ?? 'lainnya'
  const hasKitchen = featuresForBusinessType(businessType).kitchen
  const existingNames = new Set(categories.map((c) => c.name.trim().toLowerCase()))
  const missingStarter = KANTIN_STARTER_CATEGORIES.filter((c) => !existingNames.has(c.name.toLowerCase()))

  return (
    <div className="max-w-xl">
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
      {businessType === 'kantin' && missingStarter.length > 0 && (
        <button
          className="btn-secondary mb-4 w-full"
          onClick={async () => {
            const created = await createKantinStarterCategories()
            toast.success(`${created} kategori standar kantin ditambahkan`)
          }}
        >
          + Kategori standar kantin ({missingStarter.map((c) => c.name).join(', ')})
        </button>
      )}
      {hasKitchen && categories.length > 0 && (
        <p className="mb-2 text-xs text-ink-500">
          "Disiapkan di" — pilih <b>Langsung (tanpa dapur)</b> untuk barang siap jual (minuman botol, es krim, kerupuk) supaya tidak
          masuk Layar Dapur.
        </p>
      )}
      <div className="space-y-2">
        {categories.map((c) => (
          <div key={c.id} className="card flex flex-wrap items-center justify-between gap-2 p-3">
            <span className="text-ink-100">{c.name}</span>
            <div className="flex items-center gap-3">
              {hasKitchen && <CategoryStation categoryId={c.id} />}
              <label className="flex items-center gap-2 text-sm text-ink-400">
                <input type="checkbox" checked={c.active} onChange={(e) => void updateCategory(c.id, { active: e.target.checked })} />
                Aktif
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CategoryStation({ categoryId }: { categoryId: string }) {
  const station = useLiveQuery(() => stationForCategory(categoryId), [categoryId])
  if (!station) return null
  return (
    <label className="flex items-center gap-2 text-sm text-ink-400">
      Disiapkan di
      <RouteStationSelect value={station} onChange={(s) => void setPrintRoute(categoryId, s)} />
    </label>
  )
}
