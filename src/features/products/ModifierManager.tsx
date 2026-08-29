import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  createModifierGroup,
  createModifierOption,
  deleteModifierGroup,
  deleteModifierOption,
  listModifierGroups,
  listModifierOptions,
} from '@/db/repositories/modifiers'
import { formatRupiah } from '@/lib/currency'
import { Icon } from '@/components/ui/Icon'
import type { ModifierGroupType } from '@/types/domain'

const TYPE_LABELS: Record<ModifierGroupType, string> = {
  size: 'Ukuran',
  sugar: 'Level Gula',
  ice: 'Level Es',
  topping: 'Topping',
  spice: 'Kepedasan',
  note: 'Catatan',
}

export function ModifierManager() {
  const groups = useLiveQuery(() => listModifierGroups(), []) ?? []
  const [showNewGroup, setShowNewGroup] = useState(false)

  return (
    <div>
      <button className="btn-primary mb-4" onClick={() => setShowNewGroup(true)}>
        + Grup Modifier Baru
      </button>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {groups.map((group) => (
          <ModifierGroupCard key={group.id} groupId={group.id} name={group.name} type={group.type} required={group.required} />
        ))}
      </div>
      {showNewGroup && <NewGroupModal onClose={() => setShowNewGroup(false)} />}
    </div>
  )
}

function ModifierGroupCard({ groupId, name, type, required }: { groupId: string; name: string; type: ModifierGroupType; required: boolean }) {
  const options = useLiveQuery(() => listModifierOptions(groupId), [groupId]) ?? []
  const [newOptionName, setNewOptionName] = useState('')
  const [newOptionPrice, setNewOptionPrice] = useState(0)

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-ink-50">{name}</h3>
          <p className="text-xs text-ink-500">
            {TYPE_LABELS[type]} • {required ? 'Wajib' : 'Opsional'}
          </p>
        </div>
        <button
          className="text-red-400"
          onClick={() => {
            if (confirm(`Hapus grup modifier "${name}"?`)) void deleteModifierGroup(groupId)
          }}
        >
          Hapus
        </button>
      </div>
      <div className="space-y-1">
        {options.map((option) => (
          <div key={option.id} className="flex items-center justify-between rounded-lg bg-ink-800 px-3 py-1.5 text-sm">
            <span className="text-ink-200">
              {option.name} {option.priceDelta > 0 && <span className="text-ink-500">(+{formatRupiah(option.priceDelta)})</span>}
            </span>
            <button className="text-red-400" onClick={() => void deleteModifierOption(option.id)}>
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input className="input-field flex-1 !py-2 text-sm" placeholder="Opsi baru" value={newOptionName} onChange={(e) => setNewOptionName(e.target.value)} />
        <input
          type="number"
          className="input-field w-20 !py-2 text-sm"
          placeholder="+Rp"
          value={newOptionPrice}
          onChange={(e) => setNewOptionPrice(Number(e.target.value))}
        />
        <button
          className="btn-secondary !min-h-0 !px-3 !py-2 text-sm"
          onClick={async () => {
            if (!newOptionName.trim()) return
            await createModifierOption({ groupId, name: newOptionName.trim(), priceDelta: newOptionPrice, sortOrder: options.length })
            setNewOptionName('')
            setNewOptionPrice(0)
          }}
        >
          +
        </button>
      </div>
    </div>
  )
}

function NewGroupModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [type, setType] = useState<ModifierGroupType>('size')
  const [required, setRequired] = useState(true)
  const [multiSelect, setMultiSelect] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-ink-900 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-ink-50">Grup Modifier Baru</h2>
        <input className="input-field mb-3" placeholder="Nama grup" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="input-field mb-3" value={type} onChange={(e) => setType(e.target.value as ModifierGroupType)}>
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="mb-2 flex items-center gap-2 text-sm text-ink-300">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          Wajib dipilih
        </label>
        <label className="mb-4 flex items-center gap-2 text-sm text-ink-300">
          <input type="checkbox" checked={multiSelect} onChange={(e) => setMultiSelect(e.target.checked)} />
          Bisa pilih lebih dari satu
        </label>
        <div className="flex gap-3">
          <button className="btn-ghost flex-1" onClick={onClose}>
            Batal
          </button>
          <button
            className="btn-primary flex-[2]"
            onClick={async () => {
              if (!name.trim()) return
              await createModifierGroup({ name: name.trim(), type, required, multiSelect, sortOrder: 99 })
              onClose()
            }}
          >
            Simpan
          </button>
        </div>
      </div>
    </div>
  )
}
