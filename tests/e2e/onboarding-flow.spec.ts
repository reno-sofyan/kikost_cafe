import { expect, test } from '@playwright/test'

/**
 * Alur inti: onboarding sekali → login admin otomatis → data contoh ter-seed →
 * POS langsung terbuka → buka shift → grid menu siap.
 *
 * Setiap test memakai context bersih (IndexedDB kosong) sehingga onboarding muncul.
 */

test.describe('Onboarding → Shift → Kasir', () => {
  test('menyelesaikan onboarding lalu membuka layar kasir dengan produk contoh', async ({ page }) => {
    await page.goto('/')

    // 1. Welcome
    await expect(page.getByRole('heading', { name: 'Selamat Datang' })).toBeVisible()
    await page.getByRole('button', { name: 'Lanjut' }).click()

    // 2. Profil Kafe
    await expect(page.getByRole('heading', { name: 'Profil Kafe' })).toBeVisible()
    await page.getByLabel('Nama Kafe').fill('Kafe Uji E2E')
    await page.getByLabel('Telepon').fill('081200000000')
    await page.getByRole('button', { name: 'Lanjut' }).click()

    // 3. Pajak & Biaya
    await expect(page.getByRole('heading', { name: 'Pajak' })).toBeVisible()
    await page.getByLabel('Pajak (%)').fill('11')
    await page.getByLabel('Service Charge (%)').fill('5')
    await page.getByRole('button', { name: 'Lanjut' }).click()

    // 4. QRIS & Ukuran Struk (biarkan default 58mm)
    await expect(page.getByRole('heading', { name: 'QRIS' })).toBeVisible()
    await page.getByRole('button', { name: '80mm', exact: true }).click()
    await page.getByRole('button', { name: 'Lanjut' }).click()

    // 5. Printer (biarkan default: cetak lewat browser)
    await expect(page.getByRole('heading', { name: 'Konfigurasi Printer' })).toBeVisible()
    await page.getByRole('button', { name: 'Lanjut' }).click()

    // 6. Admin
    await expect(page.getByRole('heading', { name: 'Akun Administrator' })).toBeVisible()
    await page.getByLabel('Nama Administrator').fill('Admin Uji')
    await page.getByLabel('PIN (4-8 digit)').fill('246810')
    await page.getByLabel('Konfirmasi PIN').fill('246810')
    await page.getByRole('button', { name: /Selesai/ }).click()

    // 7. Setelah selesai: login otomatis sebagai admin → POS.
    //    Kasir butuh shift, jadi muncul gate "Belum Ada Shift Aktif".
    await expect(page.getByRole('heading', { name: 'Belum Ada Shift Aktif' })).toBeVisible({ timeout: 15_000 })

    // Navigasi utama harus tampil (bukan landing page).
    await expect(page.getByRole('link', { name: 'Kasir' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Laporan' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Pengaturan' })).toBeVisible()

    // 8. Buka shift: gate kasir → layar Shift → modal → konfirmasi.
    await page.getByRole('button', { name: 'Buka Shift' }).click() // gate kasir → /shift
    await expect(page).toHaveURL(/\/shift$/)
    await page.getByRole('button', { name: 'Buka Shift' }).click() // buka modal
    const dialog = page.locator('div.rounded-2xl.bg-ink-900').filter({
      has: page.getByRole('heading', { name: 'Buka Shift' }),
    })
    await dialog.getByLabel('Modal Awal').fill('500000')
    await dialog.getByRole('button', { name: 'Buka Shift' }).click()

    // 9. Shift aktif → kasir menampilkan grid menu dari data contoh.
    await expect(dialog).toBeHidden()
    await page.getByRole('link', { name: 'Kasir' }).click()
    await expect(page.getByRole('heading', { name: 'Belum Ada Shift Aktif' })).toHaveCount(0)
    // Kategori contoh dari seed (Kopi, Non-Kopi, Makanan, ...).
    await expect(page.getByText('Non-Kopi', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
  })

  test('onboarding hanya muncul sekali (reload tetap di POS/login, bukan wizard)', async ({ page }) => {
    await page.goto('/')
    // Jalur cepat: isi minimal lalu selesai.
    await page.getByRole('button', { name: 'Lanjut' }).click() // welcome
    await page.getByLabel('Nama Kafe').fill('Sekali Saja')
    await page.getByRole('button', { name: 'Lanjut' }).click() // profile
    await page.getByRole('button', { name: 'Lanjut' }).click() // fiscal
    await page.getByRole('button', { name: 'Lanjut' }).click() // qris
    await page.getByRole('button', { name: 'Lanjut' }).click() // printer
    await page.getByLabel('Nama Administrator').fill('Admin')
    await page.getByLabel('PIN (4-8 digit)').fill('1357')
    await page.getByLabel('Konfirmasi PIN').fill('1357')
    await page.getByRole('button', { name: /Selesai/ }).click()

    await expect(page.getByRole('heading', { name: 'Belum Ada Shift Aktif' })).toBeVisible({ timeout: 15_000 })

    await page.reload()
    // Tidak kembali ke wizard (onboardingCompleted tersimpan di IndexedDB).
    await expect(page.getByRole('heading', { name: 'Pengaturan Awal Kikost Cafe POS' })).toHaveCount(0)
  })
})
