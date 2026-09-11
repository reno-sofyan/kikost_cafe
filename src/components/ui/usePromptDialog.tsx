import { useCallback, useState } from 'react'
import { PromptDialog, type PromptDialogProps } from '@/components/ui/PromptDialog'

type PromptOptions = Omit<PromptDialogProps, 'onCancel' | 'onConfirm'>

interface PendingPrompt extends PromptOptions {
  resolve: (value: string | null) => void
}

/**
 * Versi promise dari `prompt()` bawaan browser, tampilan konsisten dengan tema
 * aplikasi. Resolusinya `null` bila dibatalkan. Pakai:
 *
 *   const { prompt, dialog } = usePromptDialog()
 *   const next = await prompt({ title: 'Nama baru', initialValue: current })
 *   if (next == null) return
 */
export function usePromptDialog() {
  const [pending, setPending] = useState<PendingPrompt | null>(null)

  const prompt = useCallback((options: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      setPending({ ...options, resolve })
    })
  }, [])

  const dialog = pending ? (
    <PromptDialog
      {...pending}
      onCancel={() => {
        pending.resolve(null)
        setPending(null)
      }}
      onConfirm={(value) => {
        pending.resolve(value)
        setPending(null)
      }}
    />
  ) : null

  return { prompt, dialog }
}
