import { expect, test } from '@playwright/test'
import { completeOnboarding } from './helpers'

// PNG 1×1 piksel.
const PHOTO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

test('foto profil pengguna: diunggah di Pengaturan → Pengguna, tampil di daftar & layar masuk', async ({ page }) => {
  await completeOnboarding(page, { businessType: 'Kafe & Restoran' })
  await page.getByRole('link', { name: 'Pengaturan', exact: true }).click()
  await page.getByRole('button', { name: 'Pengguna', exact: true }).click()
  await page.getByRole('button', { name: 'Edit' }).first().click()
  await page.getByLabel('Foto profil').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PHOTO })
  await expect(page.getByRole('button', { name: 'Hapus foto' })).toBeVisible()
  await page.getByRole('button', { name: 'Simpan' }).click()
  await expect(page.locator('.card img[src^="data:image/"]').first()).toBeVisible()

  // Layar masuk (muat ulang = keluar dari sesi): kartu akun memakai foto.
  await page.reload()
  const card = page.getByRole('button', { name: /^Masuk sebagai Admin E2E,/ })
  await expect(card).toBeVisible({ timeout: 15_000 })
  await expect(card.locator('img[src^="data:image/"]')).toBeVisible()
})
