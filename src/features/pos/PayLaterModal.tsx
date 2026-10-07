import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { formatRupiah } from '@/lib/currency'

interface Props {
  orderLabel: string
  total: number
  initialName: string
  onCancel: () => void
  onConfirm: (params: { name: string; note: string }) => void
}

/** Kantin: catat pesanan sebagai "Tagihan Tertunda" — dibuat sekarang, dibayar nanti. */
export function PayLaterModal({ orderLabel, total, initialName, onCancel, onConfirm }: Props) {
  const [name, setName] = useState(initialName)
  const [note, setNote] = useState('')
  const canConfirm = name.trim().length > 0

  return (
    <Modal onClose={onCancel}>
      <h2 className="mb-1 text-lg font-bold text-ink-50">Tagihan Tertunda • {orderLabel}</h2>
      <p className="mb-4 text-sm text-ink-400">
        Pesanan tetap diproses sekarang, tagihan {formatRupiah(total)} dibayar nanti. Tagihan tertunda tidak menghalangi tutup shift dan
        bisa dilunasi dari "Pesanan Terbuka → Tagihan Tertunda".
      </p>
      <label className="mb-3 block">
        <span className="mb-1 block text-sm text-ink-300">
          Atas nama <span className="text-red-400">*</span>
        </span>
        <input
          className="input-field"
          autoFocus
          placeholder="mis. Pak Budi (Gudang), Divisi Keuangan"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="mb-4 block">
        <span className="mb-1 block text-sm text-ink-300">Catatan (opsional)</span>
        <textarea
          className="input-field"
          rows={2}
          placeholder="mis. dibayar saat gajian, rapat divisi"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="flex gap-3">
        <button className="btn-ghost flex-1" onClick={onCancel}>
          Batal
        </button>
        <button className="btn-primary flex-[2]" disabled={!canConfirm} onClick={() => onConfirm({ name: name.trim(), note: note.trim() })}>
          Simpan Tagihan Tertunda
        </button>
      </div>
    </Modal>
  )
}
