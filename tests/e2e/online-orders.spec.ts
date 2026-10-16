import { expect, test } from '@playwright/test'
import { completeOnboarding, idbAll, openShift } from './helpers'

const SHOTS = process.env.E2E_SHOTS

test('pesanan online: platform di kasir → bayar via aplikasi → tiga halaman laporan', async ({ page }) => {
  test.slow()
  await completeOnboarding(page)
  await openShift(page)

  // Pesanan online GoFood dengan nomor pesanan aplikasi.
  await page.getByRole('link', { name: 'Kasir' }).click()
  await page.getByRole('button', { name: 'Pesanan Baru', exact: true }).click()
  const nb = page.locator('div.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Pesanan Baru' }) })
  await nb.getByRole('button', { name: 'Online', exact: true }).click()
  await nb.getByRole('button', { name: 'GoFood' }).click()
  await nb.getByPlaceholder(/F-123456/).fill('F-777')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-pesanan-baru-online.png` })
  await nb.getByRole('button', { name: 'Mulai Pesanan' }).click()
  await expect(page.getByText('Pesanan Online • GoFood #F-777')).toBeVisible()

  await page.getByRole('button', { name: 'Snack' }).click()
  await page.getByRole('button', { name: /Kentang Goreng/ }).click()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-kasir-online.png` })
  await page.getByRole('button', { name: /^Bayar •/ }).click()
  await page.getByRole('button', { name: 'Dibayar via GoFood' }).click()
  if (SHOTS) await page.waitForTimeout(400)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/3-bayar-online.png` })
  await page.getByRole('button', { name: 'Selesaikan Pembayaran' }).click()
  await expect(page.getByRole('heading', { name: 'Pembayaran Berhasil' })).toBeVisible({ timeout: 10_000 })

  const [order] = await idbAll<{ type: string; onlinePlatform: string; onlineOrderRef: string; taxAmount: number; serviceChargeAmount: number; subtotal: number; grandTotal: number }>(page, 'orders')
  expect(order).toMatchObject({ type: 'delivery', onlinePlatform: 'gofood', onlineOrderRef: 'F-777', taxAmount: 0, serviceChargeAmount: 0 })
  expect(order.grandTotal).toBe(order.subtotal)
  const [payment] = await idbAll<{ method: string; amount: number }>(page, 'payments')
  expect(payment).toMatchObject({ method: 'platform', amount: order.grandTotal })

  const statValue = (label: string) =>
    page.locator('p.text-xs', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::p[1]')

  // Halaman gabungan: ada pesanan online + rincian kanal, stok tetap tampil.
  await page.getByRole('link', { name: 'Laporan', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Laporan Keseluruhan' })).toBeVisible()
  await expect(statValue('Transaksi')).toHaveText('1')
  await expect(page.getByRole('heading', { name: 'Kanal Penjualan' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Laporan Stok' })).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4-laporan-keseluruhan.png`, fullPage: true })

  // Halaman online: rekap per platform.
  await page.getByRole('link', { name: 'Pesanan Online' }).click()
  await expect(page.getByRole('heading', { name: 'Laporan Pesanan Online' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Pesanan Online' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('link', { name: 'Keseluruhan' })).not.toHaveAttribute('aria-current', 'page')
  await expect(statValue('Transaksi')).toHaveText('1')
  await expect(page.getByRole('heading', { name: 'Rekap per Platform' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'GoFood' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Laporan Stok' })).toBeHidden()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/5-laporan-online.png`, fullPage: true })

  // Halaman dine-in & takeaway: pesanan online tidak ikut.
  await page.getByRole('link', { name: 'Dine-in & Takeaway' }).click()
  await expect(page.getByRole('heading', { name: 'Laporan Dine-in & Takeaway' })).toBeVisible()
  await expect(statValue('Transaksi')).toHaveText('0')
  if (SHOTS) await page.waitForTimeout(400)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/6-laporan-toko.png`, fullPage: true })
})
