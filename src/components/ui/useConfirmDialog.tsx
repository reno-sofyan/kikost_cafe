import { useCallback, useState } from 'react'
import { ConfirmDialog, type ConfirmDialogProps } from '@/components/ui/ConfirmDialog'

type ConfirmOptions = Omit<ConfirmDialogProps, 'onCancel' | 'onConfirm'>

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void
}

/**
 * Versi promise dari `confirm()` bawaan browser, tapi tampilannya konsisten
 * dengan tema aplikasi. Pakai:
 *
 *   const { confirm, dialog } = useConfirmDialog()
 *   if (!(await confirm({ title: 'Hapus?', tone: 'danger' }))) return
 *   ...
 *   return <>{dialog}...</>
 */
export function useConfirmDialog() {
  const [pending, setPending] = useState<PendingConfirm | null>(null)

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve })
    })
  }, [])

  const dialog = pending ? (
    <ConfirmDialog
      {...pending}
      onCancel={() => {
        pending.resolve(false)
        setPending(null)
      }}
      onConfirm={() => {
        pending.resolve(true)
        setPending(null)
      }}
    />
  ) : null

  return { confirm, dialog }
}
