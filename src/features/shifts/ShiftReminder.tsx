import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '@/components/ui/Modal'
import { Icon } from '@/components/ui/Icon'
import { formatRupiah } from '@/lib/currency'
import { durationSince, formatDateTime } from '@/lib/datetime'
import { getShiftReminderAck, setShiftReminderAck, shouldShowShiftReminder } from '@/lib/shiftReminder'
import type { Shift } from '@/types/domain'

/**
 * Popup pukul 21.00 WIB (kantin): "shift masih terbuka — lanjutkan atau tutup?".
 * Dicek tiap menit; "Lanjutkan" menunda sampai 21.00 berikutnya, "Tutup Shift"
 * membuka layar Shift untuk hitung kas & tutup seperti biasa.
 */
export function ShiftReminder({ shift }: { shift: Shift }) {
  const navigate = useNavigate()
  const [now, setNow] = useState(() => Date.now())
  const [ackAt, setAckAt] = useState(() => getShiftReminderAck(shift.id))

  useEffect(() => {
    setAckAt(getShiftReminderAck(shift.id))
    const t = setInterval(() => setNow(Date.now()), 60 * 1000)
    return () => clearInterval(t)
  }, [shift.id])

  if (!shouldShowShiftReminder({ shiftOpenedAt: shift.openedAt, acknowledgedAt: ackAt, now })) return null

  const acknowledge = () => {
    const at = Date.now()
    setShiftReminderAck(shift.id, at)
    setAckAt(at)
  }

  return (
    <Modal onClose={acknowledge} className="w-full max-w-sm rounded-2xl bg-ink-900 p-6 text-center">
      <Icon name="clock" size={36} className="mx-auto mb-3 text-brand-400" />
      <h2 className="mb-1 text-lg font-bold text-ink-50">Shift masih berjalan</h2>
      <p className="mb-4 text-sm text-ink-300">
        Dibuka {shift.cashierName} • {formatDateTime(shift.openedAt)} ({durationSince(shift.openedAt, now)}).
        <br />
        Kas seharusnya {formatRupiah(shift.expectedCash)}. Lanjutkan shift atau tutup sekarang?
      </p>
      <div className="flex gap-3">
        <button className="btn-secondary flex-1" onClick={acknowledge}>
          Lanjutkan Shift
        </button>
        <button
          className="btn-primary flex-1"
          onClick={() => {
            acknowledge()
            navigate('/shift')
          }}
        >
          Tutup Shift
        </button>
      </div>
    </Modal>
  )
}
