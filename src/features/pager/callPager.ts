import { getSettings } from '@/db/repositories/settings'
import { resolvePagerDriver, PagerNotConfiguredError } from '@/features/pager/pagerDrivers'

/**
 * Membunyikan sebuah pager lewat transport digital (dipakai tombol "Tes Panggil"
 * di Pengaturan, mode `usb-serial` saja — mode `manual` tidak punya transport
 * apa pun untuk dites, lihat pagerEngine.ts). Melempar bila pager belum
 * aktif/dikonfigurasi, mode-nya tidak mendukung tes digital, atau perangkat
 * gagal merespons.
 */
export async function callPagerManually(pagerNumber: number): Promise<void> {
  const { pagerConfig } = await getSettings()
  if (pagerConfig.connectionType === 'none') {
    throw new PagerNotConfiguredError('Pager belum diaktifkan di Pengaturan → Pager.')
  }
  if (pagerConfig.connectionType === 'manual') {
    throw new PagerNotConfiguredError(
      'Mode manual tidak punya sambungan ke base station — panggil langsung di keypad transmitter Anda.',
    )
  }
  await resolvePagerDriver(pagerConfig).call(pagerNumber)
}
