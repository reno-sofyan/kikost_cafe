import { expect, test } from '@playwright/test'
import { completeOnboarding, idbAll, openShift, waitForOrderItems } from './helpers'

interface OrderRow {
  id: string
  status: string
  pagerNumber?: number | null
}

test('Fitur & Akses: menu yang dimatikan hilang dari samping dan rutenya dijaga', async ({ page }) => {
  await completeOnboarding(page)
  const nav = page.getByRole('navigation')
  await expect(nav.getByRole('link', { name: 'Pelanggan' })).toBeVisible()

  await page.getByRole('link', { name: 'Pengaturan' }).click()
  await page.getByRole('button', { name: 'Fitur & Akses', exact: true }).click()
  await page.getByRole('switch', { name: 'Pakai menu Pelanggan' }).uncheck()
  await page.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(nav.getByRole('link', { name: 'Pelanggan' })).toBeHidden()

  // Membuka alamatnya langsung pun dialihkan (navigasi di dalam app; reload = logout).
  await page.evaluate(() => {
    history.pushState({}, '', '/pelanggan')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page).not.toHaveURL(/\/pelanggan/)

  await page.getByRole('link', { name: 'Pengaturan' }).click()
  await expect(page.getByRole('textbox', { name: 'Nama Usaha' })).toBeVisible()
  await page.getByRole('button', { name: 'Fitur & Akses', exact: true }).click()
  await page.getByRole('button', { name: 'Kembalikan ke Bawaan' }).click()
  await page.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(nav.getByRole('link', { name: 'Pelanggan' })).toBeVisible()
})

test('tap produk tanpa pesanan → Pesanan Baru; nomor pager; lunas → Kasir siap pesanan baru', async ({ page }) => {
  test.slow()
  await completeOnboarding(page)

  // Logo struk bisa dimatikan di Pengaturan → Printer.
  await page.getByRole('link', { name: 'Pengaturan' }).click()
  await page.getByRole('button', { name: 'Printer', exact: true }).click()
  await expect(page.getByText('Cetak logo di struk')).toBeVisible()

  // Aktifkan pager (manual) supaya chip nomor pager muncul di Kasir.
  await page.getByRole('button', { name: 'Pager', exact: true }).click()
  await page.locator('select').first().selectOption('manual')
  await page.getByRole('button', { name: 'Simpan', exact: true }).click()

  await openShift(page)
  await page.getByRole('link', { name: 'Kasir' }).click()
  await expect(page.getByText('Siap untuk pesanan baru')).toBeVisible()

  // Tap produk tanpa pesanan aktif → dialog Pesanan Baru → produk langsung masuk.
  await page.getByRole('button', { name: 'Snack' }).click()
  await page.getByRole('button', { name: /Kentang Goreng/ }).click()
  const newOrder = page.locator('div.rounded-2xl.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Pesanan Baru' }) })
  await newOrder.getByRole('button', { name: 'Takeaway' }).click()
  await newOrder.getByRole('button', { name: 'Mulai Pesanan' }).click()
  await waitForOrderItems(page, 1)

  // Nomor pager diisi di kasir.
  await page.getByRole('button', { name: 'Nomor pager' }).click()
  await page.getByRole('textbox', { name: 'Nomor Pager' }).fill('5')
  await page.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Nomor pager' })).toHaveText(/Pager #5/)
  await expect.poll(async () => (await idbAll<OrderRow>(page, 'orders'))[0]?.pagerNumber).toBe(5)

  // Bayar tunai.
  await page.getByRole('button', { name: /^Bayar •/ }).click()
  await page.getByRole('button', { name: 'Tunai', exact: true }).click()
  const cash = page.locator('div.rounded-2xl.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Pembayaran Tunai' }) })
  await cash.getByRole('button', { name: 'Uang Pas' }).click()
  await cash.getByRole('button', { name: 'Konfirmasi' }).click()
  await page.getByRole('button', { name: 'Selesaikan Pembayaran' }).click()

  await expect(page.getByRole('heading', { name: 'Pembayaran Berhasil' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Pager #5')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cetak Struk ke Dapur/Bar' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Cetak (Ulang )?Struk Pelanggan/ })).toBeVisible()

  // Membuka Kasir lewat menu samping (bukan "Transaksi Baru") → langsung siap pesanan baru.
  await page.getByRole('link', { name: 'Kasir' }).click()
  await expect(page.getByText('Siap untuk pesanan baru')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Bayar •/ })).toBeHidden()

  // Pesanan yang selesai ada di Riwayat.
  await page.getByRole('link', { name: 'Riwayat' }).click()
  await expect(page.getByText('TRX-00001').first()).toBeVisible()
})
