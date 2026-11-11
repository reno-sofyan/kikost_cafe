import { expect, test, type Page } from '@playwright/test'
import { completeOnboarding, openShift } from './helpers'

/**
 * Simulasi pemindai USB mode keyboard (HID), mis. pemindai laser 1D dengan stand
 * auto-sense: kode diketik ±5 ms/karakter lalu Enter — persis seperti yang diterima
 * WebView Android dari pemindai lewat USB OTG.
 */
async function scan(page: Page, code: string) {
  await page.keyboard.type(code, { delay: 5 })
  await page.keyboard.press('Enter')
}

const AIR = '8990000000109' // Air Mineral 600ml (katalog contoh minimarket)
const cartLine = (page: Page, name: string) => page.locator('div.border-b').filter({ has: page.getByText(name, { exact: true }) })

test('pemindai USB: kasir, pengali, layar bayar, transaksi berikutnya, halaman uji', async ({ page }) => {
  test.slow()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await completeOnboarding(page, { businessType: 'Minimarket & Ritel', taxPercent: '0' })
  await openShift(page)
  await page.getByRole('navigation').getByRole('link', { name: 'Kasir' }).click()

  // Fokus di tombol produk lain: pindaian tetap masuk, dan Enter-nya TIDAK menekan tombol itu.
  await page.getByRole('button', { name: 'Tambah Beras 5kg', exact: true }).click()
  await expect(cartLine(page, 'Beras 5kg')).toBeVisible()
  await scan(page, AIR)
  await expect(cartLine(page, 'Air Mineral 600ml')).toBeVisible()
  await expect(cartLine(page, 'Beras 5kg').getByText('1', { exact: true })).toBeVisible()

  // Pindai lagi = qty bertambah (baris sama).
  await scan(page, AIR)
  await expect(cartLine(page, 'Air Mineral 600ml').getByText('2', { exact: true })).toBeVisible()

  // Pengali: ketik "3*" di kolom cari, lalu pindai.
  const search = page.getByLabel('Cari produk atau scan barcode')
  await search.click()
  await search.pressSequentially('3*', { delay: 150 })
  await scan(page, '8990000000116') // Teh Botol
  await expect(cartLine(page, 'Teh Botol 350ml').getByText('3', { exact: true })).toBeVisible()
  await expect(search).toHaveValue('')

  // Tombol Scan = menunggu ALAT pemindai (bukan kamera); kode masuk, panel tertutup.
  await page.getByRole('button', { name: /^Scan/ }).click()
  const panel = page.locator('[data-modal]')
  await expect(panel.getByText('Siap memindai')).toBeVisible()
  await expect(panel.getByText(/Pemindai bekerja/)).toBeVisible()
  await scan(page, '8990000000017') // Keripik Kentang
  await expect(panel).toHaveCount(0)
  await expect(cartLine(page, 'Keripik Kentang 68g')).toBeVisible()
  await expect(page.getByLabel('Pemindai tersambung')).toBeVisible()

  // Barcode tak terdaftar: pesan jelas, keranjang tak berubah.
  await page.getByRole('button', { name: 'Semua', exact: true }).click()
  await scan(page, '1234567890')
  await expect(page.getByText('Barcode 1234567890 belum terdaftar')).toBeVisible()

  // Layar bayar: pindaian tak boleh jadi "uang diterima" / menyelesaikan pembayaran.
  await expect(page.getByRole('button', { name: /^Bayar · / })).toBeEnabled()
  await page.keyboard.press('F9')
  const cash = page.getByLabel('Uang diterima')
  await expect(cash).toBeFocused()
  await scan(page, AIR)
  await expect(page.getByText(/Barcode terbaca di layar pembayaran/)).toBeVisible()
  await expect(cash).toHaveValue('')
  await expect(page.getByRole('heading', { name: 'Pembayaran Berhasil' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Uang pas' }).click()
  await page.getByRole('button', { name: 'Selesaikan pembayaran' }).click()
  await expect(page.getByRole('heading', { name: 'Pembayaran Berhasil' })).toBeVisible()

  // Pelanggan berikutnya: langsung pindai dari layar sukses → transaksi baru berisi barang itu.
  await scan(page, AIR)
  await expect(cartLine(page, 'Air Mineral 600ml')).toBeVisible()
  await expect(page.getByText('1 item')).toBeVisible()

  // Pengaturan → Pemindai Barcode: uji pindaian & diagnosis ketikan lambat.
  await page.getByRole('navigation').getByRole('link', { name: 'Pengaturan' }).click()
  await page.getByRole('button', { name: 'Pemindai Barcode' }).click()
  await scan(page, AIR)
  await expect(page.getByText(AIR, { exact: true })).toBeVisible()
  await expect(page.getByText(/Air Mineral 600ml — Rp4\.000/)).toBeVisible()
  await page.keyboard.type('8990000000116', { delay: 120 })
  await page.keyboard.press('Enter')
  await expect(page.getByText(/tidak dikenali sebagai pindaian/)).toBeVisible()
  await expect(page.getByText(/Terlalu lambat untuk pemindai/)).toBeVisible()

  expect(errors).toEqual([])
})
