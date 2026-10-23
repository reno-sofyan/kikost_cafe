import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'

/** Pilihan cepat — ditambahkan ke catatan; kasir tetap bisa mengetik bebas. */
const QUICK_NOTES = ['Tidak pedas', 'Pedas', 'Tanpa saos', 'Tanpa sambal', 'Tanpa bawang', 'Kurang manis', 'Tanpa es', 'Es dipisah', 'Dibungkus']

interface Props {
  productName: string
  initialNote: string
  onCancel: () => void
  onSave: (note: string) => void
}

/** Catatan per item pesanan (mis. "tidak pakai saos") — tercetak di tiket dapur & struk. */
export function ItemNoteModal({ productName, initialNote, onCancel, onSave }: Props) {
  const [note, setNote] = useState(initialNote)

  function addQuick(text: string) {
    setNote((current) => {
      const parts = current.split(',').map((p) => p.trim()).filter(Boolean)
      return parts.some((p) => p.toLowerCase() === text.toLowerCase()) ? current : [...parts, text].join(', ')
    })
  }

  return (
    <Modal onClose={onCancel}>
      <h2 className="mb-1 text-lg font-bold text-ink-50">Catatan Item</h2>
      <p className="mb-3 text-sm text-ink-400">{productName}</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {QUICK_NOTES.map((q) => (
          <button key={q} type="button" className="btn-secondary !min-h-[2.25rem] !px-3 !py-1 text-sm" onClick={() => addQuick(q)}>
            {q}
          </button>
        ))}
      </div>
      <textarea
        className="input-field mb-4"
        rows={3}
        maxLength={200}
        autoFocus
        aria-label="Catatan item"
        placeholder="mis. tidak pakai saos, sambal dipisah"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-3">
        {initialNote && (
          <button className="btn-ghost flex-1 text-red-500" onClick={() => onSave('')}>
            Hapus
          </button>
        )}
        <button className="btn-ghost flex-1" onClick={onCancel}>
          Batal
        </button>
        <button className="btn-primary flex-[2]" onClick={() => onSave(note.trim())}>
          Simpan Catatan
        </button>
      </div>
    </Modal>
  )
}
