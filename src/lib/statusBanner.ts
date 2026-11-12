export type BannerTone = 'warning' | 'error' | 'info'

export interface BannerCondition {
  /** Kunci kondisi (mis. `offline`, `sync-failed:3`). Ditutup manual = tersembunyi sampai kuncinya berubah. */
  key: string
  tone: BannerTone
  message: string
  action?: { label: string; onAction: () => void }
}

/** Kondisi banner dari status sinkron & antrean cetak yang sudah ada (murni, mudah dites). */
export function bannerConditions(input: {
  backendConfigured: boolean
  isOnline: boolean
  failedSync: number
  printFailures: number
  onRetrySync: () => void
  onOpenPrintQueue: () => void
}): BannerCondition[] {
  const out: BannerCondition[] = []
  if (input.backendConfigured && !input.isOnline) {
    out.push({ key: 'offline', tone: 'warning', message: 'Offline — transaksi tetap tersimpan di perangkat dan dikirim otomatis saat internet kembali.' })
  }
  if (input.backendConfigured && input.isOnline && input.failedSync > 0) {
    out.push({
      key: `sync-failed:${input.failedSync}`,
      tone: 'error',
      message: `${input.failedSync} data gagal disinkronkan ke server.`,
      action: { label: 'Coba lagi', onAction: input.onRetrySync },
    })
  }
  if (input.printFailures > 0) {
    out.push({
      key: `print:${input.printFailures}`,
      tone: 'warning',
      message: `${input.printFailures} cetakan bermasalah — periksa printer.`,
      action: { label: 'Lihat', onAction: input.onOpenPrintQueue },
    })
  }
  return out
}
