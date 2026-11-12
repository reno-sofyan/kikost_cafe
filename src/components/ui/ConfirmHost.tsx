import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useConfirmStore } from '@/state/confirmStore'

/** Menampilkan dialog `notify.confirm` satu per satu (antrean). Dipasang sekali di root. */
export function ConfirmHost() {
  const current = useConfirmStore((s) => s.queue[0])
  const settle = useConfirmStore((s) => s.settle)
  if (!current) return null
  const { id, resolve: _resolve, ...props } = current
  return <ConfirmDialog key={id} {...props} onCancel={() => settle(id, false)} onConfirm={() => settle(id, true)} />
}
