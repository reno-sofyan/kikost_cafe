import { expect, test } from '@playwright/test'

/**
 * Smoke test: aplikasi harus langsung membuka POS (bukan landing page),
 * berjalan offline (app shell dari service worker), dan tidak menampilkan
 * tombol mati / placeholder "coming soon".
 */

test('membuka onboarding/POS, bukan landing page', async ({ page }) => {
  await page.goto('/')
  // Perangkat baru: onboarding. Perangkat terkonfigurasi: layar login PIN.
  await expect(page.locator('body')).toContainText(/Pengaturan Awal|Selamat Datang|Masuk|PIN/i)
  // Tidak ada placeholder pengembangan.
  await expect(page.locator('body')).not.toContainText(/coming soon|lorem ipsum|TODO/i)
})

test('onboarding menampilkan langkah wajib', async ({ page }) => {
  await page.goto('/')
  const body = page.locator('body')
  if (await body.textContent().then((t) => /Selamat Datang|Pengaturan Awal/i.test(t ?? ''))) {
    await expect(body).toContainText(/Profil Kafe|Pajak|QRIS|Printer|Administrator/i)
  }
})

test('shell tetap termuat setelah offline (service worker)', async ({ page, context }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  // SW mengambil alih app shell.
  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('body')).toContainText(/Pengaturan Awal|Selamat Datang|Masuk|PIN|Memuat/i)
  await context.setOffline(false)
})

test('tidak ada tombol dengan teks nonaktif/palsu di layar pertama', async ({ page }) => {
  await page.goto('/')
  const buttons = page.locator('button')
  const count = await buttons.count()
  for (let i = 0; i < count; i++) {
    const label = (await buttons.nth(i).textContent())?.trim() ?? ''
    expect(label.toLowerCase()).not.toMatch(/coming soon|belum tersedia|dummy/)
  }
})
