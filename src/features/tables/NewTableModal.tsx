import { useState } from 'react'
import { createTable } from '@/db/repositories/tables'
import { Icon } from '@/components/ui/Icon'
import { Modal } from '@/components/ui/Modal'
import type { CafeTable } from '@/types/domain'

interface Props {
  onClose: () => void
  onCreated: (table: CafeTable) => void
}

export function NewTableModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [area, setArea] = useState('')
  const [capacity, setCapacity] = useState(2)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const table = await createTable({ name: name.trim(), area: area.trim(), capacity: Math.max(1, capacity) })
      onCreated(table)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menambah meja')
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-ink-50">Tambah Meja</h2>
        <button className="btn-ghost btn-compact !px-3" aria-label="Tutup" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-400">{error}</p>}

      <div className="space-y-3">
        <label className="block">
          <span className="eyebrow mb-1.5 block">Nama Meja</span>
          <input
            className="input-field"
            placeholder="mis. Meja 1, Bar, VIP 2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        <label className="block">
          <span className="eyebrow mb-1.5 block">Area (opsional)</span>
          <input
            className="input-field"
            placeholder="mis. Indoor, Teras, Lantai 2"
            value={area}
            onChange={(e) => setArea(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="eyebrow mb-1.5 block">Kapasitas</span>
          <input
            className="input-field"
            type="number"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value) || 1)}
          />
        </label>
      </div>

      <button className="btn-primary mt-5 w-full" disabled={!name.trim() || saving} onClick={() => void submit()}>
        {saving ? 'Menyimpan…' : 'Tambah & Buat QR'}
      </button>
    </Modal>
  )
}
