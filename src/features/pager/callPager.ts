import { getSettings } from '@/db/repositories/settings'
import { resolvePagerDriver, PagerNotConfiguredError } from '@/features/pager/pagerDrivers'

/**
 * Membunyikan sebuah pager secara manual (dipakai tombol "Tes Panggil" di
 * Pengaturan, dan bisa dipakai ulang untuk tombol "panggil ulang" nanti).
 * Melempar bila pager belum aktif/dikonfigurasi atau perangkat gagal merespons.
 */
export async function callPagerManually(pagerNumber: number): Promise<void> {
  const { pagerConfig } = await getSettings()
  if (pagerConfig.connectionType === 'none') {
    throw new PagerNotConfiguredError('Pager Retekess belum diaktifkan di Pengaturan → Pager.')
  }
  await resolvePagerDriver(pagerConfig).call(pagerNumber)
}
