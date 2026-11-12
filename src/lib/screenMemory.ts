import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

/**
 * Ingatan layar selama aplikasi terbuka: filter & posisi scroll tetap sama saat kasir
 * pindah modul lalu kembali (Kasir → Laporan → Kasir). Hanya di memori — dimuat ulang
 * = mulai bersih. Bukan untuk data bisnis (keranjang & pesanan ada di store/database).
 */
const memory = new Map<string, unknown>()

/** Seperti `useState`, tapi nilainya bertahan saat layar di-unmount lalu dibuka lagi. */
export function useScreenState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() =>
    memory.has(key) ? (memory.get(key) as T) : typeof initial === 'function' ? (initial as () => T)() : initial,
  )
  useEffect(() => {
    memory.set(key, value)
  }, [key, value])
  return [value, setValue]
}

/**
 * Ref callback untuk elemen yang di-scroll: mencatat posisinya dan mengembalikannya saat
 * layar dibuka lagi. `ready` = isi sudah termuat (supaya posisi tak terpotong tinggi 0).
 */
export function useScrollMemory(key: string, ready = true): (el: HTMLElement | null) => void {
  const elRef = useRef<HTMLElement | null>(null)
  const restored = useRef(false)
  const onScroll = useCallback(() => {
    if (elRef.current) memory.set(`scroll:${key}`, elRef.current.scrollTop)
  }, [key])

  useEffect(() => {
    const el = elRef.current
    if (!ready || restored.current || !el) return
    restored.current = true
    const top = memory.get(`scroll:${key}`)
    if (typeof top === 'number') el.scrollTop = top
  }, [key, ready])

  return useCallback(
    (el: HTMLElement | null) => {
      elRef.current?.removeEventListener('scroll', onScroll)
      elRef.current = el
      el?.addEventListener('scroll', onScroll, { passive: true })
    },
    [onScroll],
  )
}

/** Hanya untuk tes. */
export function clearScreenMemory(): void {
  memory.clear()
}
