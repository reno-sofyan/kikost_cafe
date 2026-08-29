import { useCallback, useRef, useState } from 'react'

/** Mencegah eksekusi ganda suatu aksi async akibat klik/tap berulang. */
export function useSubmitGuard<TArgs extends unknown[]>(
  action: (...args: TArgs) => Promise<void>,
): [boolean, (...args: TArgs) => void] {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const runningRef = useRef(false)

  const guarded = useCallback(
    (...args: TArgs) => {
      if (runningRef.current) return
      runningRef.current = true
      setIsSubmitting(true)
      void action(...args).finally(() => {
        runningRef.current = false
        setIsSubmitting(false)
      })
    },
    [action],
  )

  return [isSubmitting, guarded]
}
