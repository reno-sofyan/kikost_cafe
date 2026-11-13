import { expect, test, type Page } from '@playwright/test'
import { completeOnboarding, openShift } from './helpers'

/** Semua menu sidebar terlihat utuh di layar (tanpa perlu menggulir sidebar). */
async function expectAllNavVisible(page: Page) {
  const links = page.locator('nav a[href]')
  expect(await links.count()).toBeGreaterThan(5)
  for (const link of await links.all()) await expect(link).toBeInViewport({ ratio: 1 })
}

// Galaxy Tab S5e / Tab A8 landscape ≈ 1280×728 CSS px; 1024×576 = "Zoom layar" Samsung paling besar.
for (const viewport of [
  { width: 1280, height: 728 },
  { width: 1024, height: 576 },
]) {
  test.describe(`minimarket ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport })

    test('sidebar utuh, tombol bayar & tambah produk tak terpotong', async ({ page }) => {
      await completeOnboarding(page, { businessType: 'Minimarket & Ritel', taxPercent: '0' })
      await openShift(page)
      await expectAllNavVisible(page)

      await page.getByRole('link', { name: 'Kasir', exact: true }).click()
      for (const name of [/Air Mineral/, /Beras 5kg/, /Gula Pasir/, /Mie Instan/, /Kopi Kaleng/, /Minyak Goreng/]) {
        await page.getByRole('button', { name: new RegExp(`^Tambah ${name.source}.* ke keranjang`) }).first().click()
      }
      // Harga tidak tertimpa tombol + di kartu produk.
      const card = page.getByRole('button', { name: /^Tambah Air Mineral.* ke keranjang/ }).locator('..')
      const price = await card.locator('p').first().boundingBox()
      const plus = await page.getByRole('button', { name: /^Tambah Air Mineral.* ke keranjang/ }).boundingBox()
      expect(price!.x + price!.width).toBeLessThanOrEqual(plus!.x)

      await page.getByRole('button', { name: /^Bayar/ }).first().click()
      await expect(page.getByRole('button', { name: 'Selesaikan pembayaran' })).toBeInViewport({ ratio: 1 })
      await expect(page.getByRole('button', { name: 'Kembali', exact: true })).toBeInViewport({ ratio: 1 })
      await expectAllNavVisible(page)
    })
  })
}

test('Printer Baru: Simpan menunggu data lengkap, lalu tersimpan', async ({ page }) => {
  await completeOnboarding(page, { businessType: 'Minimarket & Ritel', taxPercent: '0' })
  await page.getByRole('link', { name: 'Pengaturan', exact: true }).click()
  await page.getByRole('button', { name: 'Printer', exact: true }).click()
  await page.getByRole('button', { name: '+ Tambah Printer' }).click()
  await expect(page.getByRole('button', { name: 'Simpan', exact: true })).toBeDisabled()
  await expect(page.getByText('Isi nama printer.')).toBeVisible()
  await page.getByLabel('Koneksi').selectOption('network')
  await page.getByPlaceholder('Nama printer').fill('Kasir 1')
  await expect(page.getByText('Isi alamat IP printer WiFi/LAN.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Simpan', exact: true })).toBeDisabled()
  await page.getByPlaceholder('192.168.1.50').fill('192.168.1.80')
  await page.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(page.getByText('LAN 192.168.1.80:9100')).toBeVisible()
})
