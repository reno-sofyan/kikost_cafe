import { expect, test } from '@playwright/test'
import { completeOnboarding, unlockDeveloperModeMocked } from './helpers'

test('pengaturan teknis tersembunyi sampai Mode Developer dibuka dengan token, dan terkunci lagi saat keluar akun', async ({ page }) => {
  await completeOnboarding(page, { businessType: 'Kafe & Restoran' })
  await page.getByRole('link', { name: 'Pengaturan', exact: true }).click()
  await page.getByRole('button', { name: 'QRIS', exact: true }).click()
  await expect(page.getByText('penyedia QRIS diatur oleh developer')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pager', exact: true })).toHaveCount(0)
  // Sinkronisasi & Backup tersembunyi total, walau perangkat belum terpasang ke server.
  await expect(page.getByRole('button', { name: 'Sinkronisasi', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Backup', exact: true })).toHaveCount(0)
  // Tablet belum terpasang: kartu Mode Developer meminta kode pasang, bukan token.
  await page.getByRole('button', { name: 'Tentang', exact: true }).click()
  await expect(page.getByLabel('Kode pasang')).toBeVisible()

  // Token salah dari server → tetap terkunci dengan pesan jelas.
  await page.route('**/api/sync/developer-code/consume', (r) => r.fulfill({ json: { ok: false, reason: 'invalid', attemptsLeft: 4 } }))
  await page.evaluate(() => {
    localStorage.setItem('kione.sync.apiBaseUrl', 'http://e2e-backend.invalid')
    localStorage.setItem('kione.sync.deviceKey', 'e2e-device-key')
  })
  await page.getByRole('button', { name: 'Tentang', exact: true }).click()
  await page.getByLabel('Token developer').fill('9999')
  await page.getByRole('button', { name: 'Buka', exact: true }).click()
  await expect(page.getByText('Token salah. Sisa percobaan: 4.')).toBeVisible()
  await page.unroute('**/api/sync/developer-code/consume')

  await unlockDeveloperModeMocked(page)
  await expect(page.getByRole('button', { name: 'Pager', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Backup', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sinkronisasi', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Backup', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pilih File Backup untuk Dipulihkan' })).toBeVisible()

  // Kunci sekarang → tab teknis hilang lagi.
  await page.getByRole('button', { name: 'Kunci', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pager', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sinkronisasi', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Backup', exact: true })).toHaveCount(0)
})
