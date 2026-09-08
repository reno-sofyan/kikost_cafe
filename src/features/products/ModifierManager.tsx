import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  createModifierGroup,
  createModifierOption,
  deleteModifierGroup,
  deleteModifierOption,
  listModifierGroups,
  listModifierOptions,
  updateModifierGroup,
  updateModifierOption,
} from '@/db/repositories/modifiers'
import { formatRupiah } from '@/lib/currency'
import { Icon } from '@/components/ui/Icon'
import type { ModifierGroup, ModifierGroupType, ModifierOption } from '@/types/domain'

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
  const [editGroup, setEditGroup] = useState<ModifierGroup | 'new' | null>(null)

  return (
    <div>
      <button className="btn-primary mb-4" onClick={() => setEditGroup('new')}>
        + Grup Modifier Baru
      </button>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {groups.map((group) => (
          <ModifierGroupCard key={group.id} group={group} onEdit={() => setEditGroup(group)} />
        ))}
      </div>
      {editGroup && <GroupModal group={editGroup === 'new' ? null : editGroup} onClose={() => setEditGroup(null)} />}
    </div>
  )
}

function ModifierGroupCard({ group, onEdit }: { group: ModifierGroup; onEdit: () => void }) {
  const options = useLiveQuery(() => listModifierOptions(group.id), [group.id]) ?? []
  const [newOptionName, setNewOptionName] = useState('')
  const [newOptionPrice, setNewOptionPrice] = useState(0)

  async function swap(a: ModifierOption, b: ModifierOption) {
    await updateModifierOption(a.id, { sortOrder: b.sortOrder })
    await updateModifierOption(b.id, { sortOrder: a.sortOrder })
  }

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-ink-50">{group.name}</h3>
          <p className="text-xs text-ink-500">
            {TYPE_LABELS[group.type]} • {group.required ? 'Wajib' : 'Opsional'} •{' '}
            {group.multiSelect ? 'Pilih banyak' : 'Pilih satu'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="text-ink-400 hover:text-ink-100" title="Ubah grup" onClick={onEdit}>
            <Icon name="edit" size={15} />
          </button>
          <button
            className="text-red-400"
            title="Hapus grup"
            onClick={() => {
              if (confirm(`Hapus grup modifier "${group.name}" beserta semua opsinya?`)) void deleteModifierGroup(group.id)
            }}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      </div>

      <div className="space-y-1">
        {options.map((option, i) => (
          <OptionRow
            key={option.id}
            option={option}
            canUp={i > 0}
            canDown={i < options.length - 1}
            onUp={() => void swap(option, options[i - 1]!)}
            onDown={() => void swap(option, options[i + 1]!)}
          />
        ))}
        {options.length === 0 && <p className="py-1 text-xs text-ink-400">Belum ada opsi.</p>}
      </div>

      <div className="mt-2 flex gap-2">
        <input
          className="input-field flex-1 !py-2 text-sm"
          placeholder="Opsi baru"
          value={newOptionName}
          onChange={(e) => setNewOptionName(e.target.value)}
        />
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
            await createModifierOption({
              groupId: group.id,
              name: newOptionName.trim(),
              priceDelta: newOptionPrice,
              sortOrder: options.length,
            })
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

function OptionRow({
  option,
  canUp,
  canDown,
  onUp,
  onDown,
}: {
  option: ModifierOption
  canUp: boolean
  canDown: boolean
  onUp: () => void
  onDown: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(option.name)
  const [price, setPrice] = useState(option.priceDelta)

  if (editing) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-ink-800 px-2 py-1.5">
        <input className="input-field flex-1 !py-1.5 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
        <input
          type="number"
          className="input-field w-20 !py-1.5 text-sm"
          value={price}
          onChange={(e) => setPrice(Number(e.target.value))}
        />
        <button
          className="text-sage-500 hover:text-sage-600"
          title="Simpan"
          onClick={async () => {
            if (!name.trim()) return
            await updateModifierOption(option.id, { name: name.trim(), priceDelta: price })
            setEditing(false)
          }}
        >
          <Icon name="check" size={16} />
        </button>
        <button
          className="text-ink-400 hover:text-ink-100"
          title="Batal"
          onClick={() => {
            setName(option.name)
            setPrice(option.priceDelta)
            setEditing(false)
          }}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between rounded-lg bg-ink-800 px-3 py-1.5 text-sm">
      <span className="text-ink-200">
        {option.name}{' '}
        {option.priceDelta > 0 && <span className="text-ink-500">(+{formatRupiah(option.priceDelta)})</span>}
      </span>
      <span className="flex items-center gap-1.5">
        <button disabled={!canUp} className="text-ink-400 hover:text-ink-100 disabled:opacity-25" title="Naik" onClick={onUp}>
          <Icon name="chevronUp" size={14} />
        </button>
        <button disabled={!canDown} className="text-ink-400 hover:text-ink-100 disabled:opacity-25" title="Turun" onClick={onDown}>
          <Icon name="chevronDown" size={14} />
        </button>
        <button className="text-ink-400 hover:text-ink-100" title="Ubah" onClick={() => setEditing(true)}>
          <Icon name="edit" size={14} />
        </button>
        <button className="text-red-400" title="Hapus" onClick={() => void deleteModifierOption(option.id)}>
          <Icon name="close" size={14} />
        </button>
      </span>
    </div>
  )
}

function GroupModal({ group, onClose }: { group: ModifierGroup | null; onClose: () => void }) {
  const [name, setName] = useState(group?.name ?? '')
  const [type, setType] = useState<ModifierGroupType>(group?.type ?? 'size')
  const [required, setRequired] = useState(group?.required ?? true)
  const [multiSelect, setMultiSelect] = useState(group?.multiSelect ?? false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-ink-900 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-ink-50">{group ? 'Ubah Grup Modifier' : 'Grup Modifier Baru'}</h2>
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
              if (group) {
                await updateModifierGroup(group.id, { name: name.trim(), type, required, multiSelect })
              } else {
                await createModifierGroup({ name: name.trim(), type, required, multiSelect, sortOrder: 99 })
              }
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
