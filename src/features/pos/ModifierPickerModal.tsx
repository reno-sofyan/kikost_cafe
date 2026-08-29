import { useEffect, useMemo, useState } from 'react'
import { db } from '@/db/schema'
import { listModifierOptionsForGroups } from '@/db/repositories/modifiers'
import { formatRupiah } from '@/lib/currency'
import type { ModifierGroup, ModifierOption, OrderItemModifierSnapshot, Product } from '@/types/domain'

interface Props {
  product: Product
  initialQty?: number
  initialNotes?: string
  initialModifiers?: OrderItemModifierSnapshot[]
  onCancel: () => void
  onConfirm: (params: { qty: number; notes: string; modifiers: OrderItemModifierSnapshot[] }) => void
}

export function ModifierPickerModal({ product, initialQty, initialNotes, initialModifiers, onCancel, onConfirm }: Props) {
  const [groups, setGroups] = useState<ModifierGroup[]>([])
  const [optionsByGroup, setOptionsByGroup] = useState<Record<string, ModifierOption[]>>({})
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [qty, setQty] = useState(initialQty ?? 1)
  const [notes, setNotes] = useState(initialNotes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void (async () => {
      const allGroups = await db.modifierGroups.where('id').anyOf(product.modifierGroupIds).sortBy('sortOrder')
      const options = await listModifierOptionsForGroups(product.modifierGroupIds)
      setGroups(allGroups)
      setOptionsByGroup(options)

      const initial: Record<string, string[]> = {}
      if (initialModifiers && initialModifiers.length > 0) {
        for (const group of allGroups) {
          initial[group.id] = initialModifiers.filter((m) => m.groupId === group.id).map((m) => m.optionId)
        }
      } else {
        for (const group of allGroups) {
          const firstOption = options[group.id]?.[0]
          initial[group.id] = group.required && firstOption ? [firstOption.id] : []
        }
      }
      setSelected(initial)
      setLoaded(true)
    })()
  }, [product.id, product.modifierGroupIds, initialModifiers])

  const addOnTotal = useMemo(() => {
    let sum = 0
    for (const group of groups) {
      const chosenIds = selected[group.id] ?? []
      const options = optionsByGroup[group.id] ?? []
      for (const id of chosenIds) {
        const option = options.find((o) => o.id === id)
        if (option) sum += option.priceDelta
      }
    }
    return sum
  }, [groups, optionsByGroup, selected])

  function toggleOption(group: ModifierGroup, optionId: string) {
    setSelected((prev) => {
      const current = prev[group.id] ?? []
      if (group.multiSelect) {
        const next = current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId]
        return { ...prev, [group.id]: next }
      }
      return { ...prev, [group.id]: [optionId] }
    })
  }

  function handleConfirm() {
    for (const group of groups) {
      if (group.required && (selected[group.id] ?? []).length === 0) {
        setError(`Pilih ${group.name} terlebih dahulu`)
        return
      }
    }
    const modifiers: OrderItemModifierSnapshot[] = []
    for (const group of groups) {
      const options = optionsByGroup[group.id] ?? []
      for (const optionId of selected[group.id] ?? []) {
        const option = options.find((o) => o.id === optionId)
        if (option) {
          modifiers.push({
            groupId: group.id,
            groupName: group.name,
            optionId: option.id,
            optionName: option.name,
            priceDelta: option.priceDelta,
          })
        }
      }
    }
    onConfirm({ qty, notes, modifiers })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onCancel}>
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-2xl bg-ink-900 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-none border-b border-ink-800 px-5 py-4">
          <h2 className="text-lg font-bold text-ink-50">{product.name}</h2>
          <p className="text-sm text-ink-400">{formatRupiah(product.price)}</p>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {!loaded && <p className="text-ink-400">Memuat pilihan...</p>}
          {groups.map((group) => (
            <div key={group.id}>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="font-semibold text-ink-100">{group.name}</h3>
                {group.required && <span className="rounded bg-brew-600/30 px-1.5 py-0.5 text-[10px] text-brew-400">Wajib</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                {(optionsByGroup[group.id] ?? []).map((option) => {
                  const active = (selected[group.id] ?? []).includes(option.id)
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => toggleOption(group, option.id)}
                      className={`rounded-full border px-4 py-2 text-sm font-medium ${
                        active ? 'border-brew-500 bg-brew-600 text-white' : 'border-ink-700 bg-ink-800 text-ink-200'
                      }`}
                    >
                      {option.name}
                      {option.priceDelta > 0 && <span className="ml-1 text-xs opacity-80">+{formatRupiah(option.priceDelta)}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          <div>
            <h3 className="mb-2 font-semibold text-ink-100">Catatan Khusus</h3>
            <textarea
              className="input-field"
              rows={2}
              placeholder="Contoh: less sweet, tanpa cabai, dst."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-ink-100">Jumlah</h3>
            <div className="flex items-center gap-3">
              <button className="btn-secondary !min-h-0 !px-4 !py-2" onClick={() => setQty((q) => Math.max(1, q - 1))}>
                −
              </button>
              <span className="w-8 text-center text-lg font-bold">{qty}</span>
              <button className="btn-secondary !min-h-0 !px-4 !py-2" onClick={() => setQty((q) => q + 1)}>
                +
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <div className="flex flex-none items-center gap-3 border-t border-ink-800 px-5 py-4">
          <button className="btn-ghost flex-1" onClick={onCancel}>
            Batal
          </button>
          <button className="btn-primary flex-[2]" onClick={handleConfirm}>
            Tambah • {formatRupiah((product.price + addOnTotal) * qty)}
          </button>
        </div>
      </div>
    </div>
  )
}
