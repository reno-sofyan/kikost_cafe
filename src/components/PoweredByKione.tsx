import { PRODUCT_NAME, PRODUCT_VERSION } from '@/lib/brand'

/**
 * Jejak merek produk di layar yang didominasi merek pemilik usaha.
 * Sengaja kecil dan redup: ini aplikasi mereka, Kione hanya mesinnya.
 */
export function PoweredByKione({ showVersion = false }: { showVersion?: boolean }) {
  return (
    <p className="text-center text-[0.7rem] font-medium text-ink-400">
      Ditenagai {PRODUCT_NAME}
      {showVersion ? ` · v${PRODUCT_VERSION}` : ''}
    </p>
  )
}
