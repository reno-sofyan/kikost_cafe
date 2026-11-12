import { useToastStore, type ToastAction, type ToastTone } from '@/state/toastStore'
import { useConfirmStore, type ConfirmOptions } from '@/state/confirmStore'

export interface NotifyOptions {
  /** ms; bawaan per jenis di TOAST_DURATION (error = menetap). 0 = menetap. */
  duration?: number
  action?: ToastAction
}

const push = (tone: ToastTone) => (message: string, options: NotifyOptions = {}) =>
  useToastStore.getState().push({ message, tone, duration: options.duration, action: options.action })

/**
 * Satu API notifikasi untuk seluruh aplikasi kasir:
 *
 *   notify.success('Pesanan disimpan')
 *   notify.error('Printer tak terhubung', { action: { label: 'Coba lagi', onAction: retry } })
 *   if (!(await notify.confirm({ title: 'Batalkan pesanan?', tone: 'danger' }))) return
 *
 * Toast: maks. 3 tampil (sisanya antre), pesan sama dalam 3 detik tak diulang.
 * Bisa dipanggil di luar komponen React. `toast.*` lama tetap berjalan lewat antrean yang sama.
 */
export const notify = {
  success: push('success'),
  info: push('info'),
  warning: push('warning'),
  error: push('error'),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
  /** Dialog konfirmasi bergaya aplikasi; `true` hanya bila pengguna menekan tombol lanjut. */
  confirm: (options: ConfirmOptions): Promise<boolean> => useConfirmStore.getState().open(options),
}
