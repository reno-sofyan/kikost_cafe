import { useState, type ReactNode } from 'react'
import { cancelEmptyOrder, emptyOrderCancelRequirements } from '@/db/repositories/orders'
import { ORDER_CANCEL_REASONS } from '@/lib/orderState'
import { useSessionStore } from '@/state/sessionStore'
import { useConfirmDialog } from '@/components/ui/useConfirmDialog'
import { ReasonPromptModal } from '@/components/ui/ReasonPromptModal'
import { OwnerCancelCodeModal } from '@/components/ui/OwnerCancelCodeModal'
import { toast } from '@/state/toastStore'
import type { OwnerApproval } from '@/db/repositories/cancelCodes'
import type { Order } from '@/types/domain'

type Step = null | { order: Order; step: 'reason'; needsOwnerCode: boolean } | { order: Order; step: 'owner'; reason: string }

/**
 * Alur "Batalkan Pesanan Kosong". Pesanan yang tak pernah berisi item cukup
 * dikonfirmasi; di kantin, pesanan yang PERNAH berisi item wajib alasan, plus kode
 * Pemilik bila itemnya dihapus tanpa persetujuan Pemilik (lihat
 * `emptyOrderCancelRequirements`).
 */
export function useEmptyOrderCancel(onCancelled?: (order: Order) => void): { start: (order: Order) => Promise<void>; dialogs: ReactNode } {
  const currentUser = useSessionStore((s) => s.currentUser)!
  const { confirm, dialog: confirmDialog } = useConfirmDialog()
  const [flow, setFlow] = useState<Step>(null)
  const actor = { userId: currentUser.id, userName: currentUser.name }

  async function run(order: Order, reason?: string, ownerApproval?: OwnerApproval) {
    setFlow(null)
    try {
      await cancelEmptyOrder(order.id, actor, { reason, ownerApproval })
      toast.success(`Pesanan ${order.orderNumber} dibatalkan.`)
      onCancelled?.(order)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal membatalkan pesanan')
    }
  }

  async function start(order: Order) {
    const req = await emptyOrderCancelRequirements(order.id)
    if (req.needsReason) {
      setFlow({ order, step: 'reason', needsOwnerCode: req.needsOwnerCode })
      return
    }
    const ok = await confirm({
      title: 'Batalkan Pesanan Kosong?',
      description: `Pesanan ${order.orderNumber} belum berisi item dan akan dibatalkan. Meja (bila ada) akan dilepas.`,
      confirmLabel: 'Ya, Batalkan',
      tone: 'danger',
    })
    if (ok) await run(order)
  }

  const dialogs = (
    <>
      {confirmDialog}
      {flow?.step === 'reason' && (
        <ReasonPromptModal
          title={`Batalkan ${flow.order.orderNumber}`}
          description={
            flow.needsOwnerCode
              ? 'Item pesanan ini sudah dihapus. Alasan wajib diisi dan pembatalan butuh kode sekali pakai dari Pemilik.'
              : 'Item pesanan ini sudah dihapus. Alasan wajib diisi.'
          }
          presets={ORDER_CANCEL_REASONS}
          confirmLabel={flow.needsOwnerCode ? 'Lanjut ke Kode Pemilik' : 'Batalkan Pesanan'}
          onCancel={() => setFlow(null)}
          onConfirm={(reason) => {
            if (flow.needsOwnerCode) setFlow({ order: flow.order, step: 'owner', reason })
            else void run(flow.order, reason)
          }}
        />
      )}
      {flow?.step === 'owner' && (
        <OwnerCancelCodeModal
          title={`Batalkan ${flow.order.orderNumber}`}
          description={`Alasan: ${flow.reason}`}
          onCancel={() => setFlow(null)}
          onApproved={(approval) => void run(flow.order, flow.reason, approval)}
        />
      )}
    </>
  )

  return { start, dialogs }
}
