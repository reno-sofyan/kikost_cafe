import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

/**
 * Indikator tab aktif yang BERGESER ke pilihan baru (bukan langsung pindah). Hanya
 * `transform` yang dianimasikan (kelas `.kione-indicator`): posisi lewat translate,
 * lebar lewat scaleX dari basis 100 px — tak pernah menganimasikan width/left/top.
 *
 * `container` = elemen ber-`position: relative` yang memuat tab; tab aktif dicari
 * dengan `activeSelector` (mis. `[aria-current="page"]`). `axis` = arah susunan tab.
 * Indikator disembunyikan sampai posisi pertama terukur (tanpa geser dari pojok).
 */
export function useSlidingIndicator(
  container: RefObject<HTMLElement>,
  activeSelector: string,
  deps: unknown[],
  axis: 'x' | 'y' = 'x',
): CSSProperties {
  const [box, setBox] = useState<{ offset: number; size: number; cross: number } | null>(null)

  useLayoutEffect(() => {
    const root = container.current
    if (!root) return
    const measure = () => {
      const active = root.querySelector<HTMLElement>(activeSelector)
      if (!active) return setBox(null)
      setBox(
        axis === 'x'
          ? { offset: active.offsetLeft, size: active.offsetWidth, cross: active.offsetTop + active.offsetHeight }
          : { offset: active.offsetTop, size: active.offsetHeight, cross: active.offsetLeft },
      )
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `deps` = pemicu ukur ulang dari pemanggil
  }, [container, activeSelector, axis, ...deps])

  if (!box) return { opacity: 0 }
  return axis === 'x'
    ? // Garis bawah: basis 100 px lalu diskalakan ke lebar tab.
      { width: 100, top: box.cross - 2, left: 0, transformOrigin: '0 0', transform: `translateX(${box.offset}px) scaleX(${box.size / 100})` }
    : // Pil vertikal (menu samping): tinggi tab seragam, cukup digeser.
      { height: box.size, top: 0, transform: `translateY(${box.offset}px)` }
}
