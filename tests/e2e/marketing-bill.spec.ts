import { expect, test } from '@playwright/test'
import { completeOnboarding, idbAll, openShift } from './helpers'
import type { Order } from '../../src/types/domain'

test('kafe: Tagihan Marketing dari Pesanan Baru sampai laporan, dan pesanan Kalibrasi berharga HPP', async ({ page }) => {
  test.slow()
  await completeOnboarding(page, { businessType: 'Kafe & Restoran', taxPercent: '0', servicePercent: '0' })
  await openShift(page)

  // --- Pelanggan → Tim Marketing: daftarkan sales.
  await page.getByRole('link', { name: 'Pelanggan', exact: true }).click()
  await page.getByRole('button', { name: 'Tim Marketing' }).click()
  await page.getByRole('button', { name: '+ Sales Baru' }).click()
  await page.getByLabel('Nama sales').fill('Budi Santoso')
  await page.getByLabel('Divisi').fill('Marketing Korporat')
  await page.getByRole('button', { name: 'Simpan' }).click()
  await expect(page.getByRole('button', { name: /Budi Santoso/ })).toBeVisible()
  // Sales bukan pelanggan biasa.
  await page.getByRole('button', { name: 'Pelanggan', exact: true }).click()
  await expect(page.getByText('Belum ada pelanggan')).toBeVisible()

  // --- Kasir: Pesanan Baru → Marketing → pilih sales.
  await page.getByRole('link', { name: 'Kasir' }).click()
  await page.getByRole('button', { name: 'Pesanan Baru', exact: true }).click()
  const nb = page.locator('div.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Pesanan Baru' }) })
  await nb.getByRole('button', { name: 'Takeaway' }).click()
  await nb.getByRole('button', { name: 'Marketing', exact: true }).click()
  await expect(nb.getByRole('button', { name: 'Mulai Pesanan' })).toBeDisabled()
  await nb.getByRole('button', { name: /Budi Santoso/ }).click()
  await nb.getByLabel('Nama klien').fill('PT Maju Jaya')
  await nb.getByRole('button', { name: 'Mulai Pesanan' }).click()
  await page.getByRole('button', { name: 'Snack' }).click()
  await page.getByRole('button', { name: /Kentang Goreng/ }).click()
  await expect(page.getByText('Tagihan Marketing • Budi Santoso — klien PT Maju Jaya')).toBeVisible()
  // Pilihan KOL/Compliment tidak lagi ada di keranjang.
  await expect(page.getByRole('button', { name: 'Compliment' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Simpan Tagihan Marketing' }).click()
  await page.getByRole('button', { name: 'Simpan Tagihan', exact: true }).click()
  await expect(page.getByText('Tagihan Marketing Budi Santoso tersimpan.')).toBeVisible()

  const marketing = (await idbAll<Order>(page, 'orders')).find((o) => o.marketingBill)!
  expect(marketing.status).toBe('open')
  expect(marketing.payLater?.name).toBe('Budi Santoso')
  expect(marketing.marketingBill).toMatchObject({ salesName: 'Budi Santoso', salesDivision: 'Marketing Korporat', clientName: 'PT Maju Jaya' })

  await page.getByRole('button', { name: 'Pesanan Terbuka' }).click()
  await page.getByRole('button', { name: /Tagihan Tertunda \(1\)/ }).click()
  await expect(page.getByText('Tagihan Marketing • Budi Santoso')).toBeVisible()
  await page.getByRole('button', { name: 'Tutup' }).first().click()

  // --- Laporan: bagian Tagihan Marketing terpisah.
  await page.getByRole('link', { name: 'Laporan', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Tagihan Marketing' })).toBeVisible()
  await expect(page.getByText('Belum dibayar kantor', { exact: true }).last()).toBeVisible()

  // --- Kantor melunasi: Pesanan Terbuka → Tagihan Tertunda → Bayar.
  await page.getByRole('link', { name: 'Kasir' }).click()
  await page.getByRole('button', { name: 'Pesanan Terbuka', exact: true }).click()
  await page.getByRole('button', { name: /Tagihan Tertunda \(1\)/ }).click()
  await page.getByRole('button', { name: /Tagihan Marketing • Budi Santoso/ }).click()
  await page.getByRole('button', { name: /^Bayar •/ }).click()
  await page.getByRole('button', { name: 'Tunai', exact: true }).click()
  const cash = page.locator('div.rounded-2xl.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Pembayaran Tunai' }) })
  await cash.getByRole('button', { name: 'Uang Pas' }).click()
  await cash.getByRole('button', { name: 'Konfirmasi' }).click()
  await page.getByRole('button', { name: 'Selesaikan Pembayaran' }).click()
  await expect(page.getByRole('heading', { name: 'Pembayaran Berhasil' })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('link', { name: 'Laporan', exact: true }).click()
  await expect(page.getByText('Lunas', { exact: true })).toBeVisible()
  expect((await idbAll<Order>(page, 'orders')).find((o) => o.marketingBill)!.status).toBe('paid')

  // --- Kalibrasi: harga HPP, atas nama kasir.
  await page.getByRole('link', { name: 'Kasir' }).click()
  await page.getByRole('button', { name: 'Pesanan Baru', exact: true }).click()
  await nb.getByRole('button', { name: 'Takeaway' }).click()
  await nb.getByRole('button', { name: 'Kalibrasi', exact: true }).click()
  await nb.getByRole('button', { name: 'Mulai Pesanan' }).click()
  await page.getByRole('button', { name: 'Snack' }).click()
  await page.getByRole('button', { name: /Kentang Goreng/ }).click()
  await expect(page.getByText('Kalibrasi — Admin E2E')).toBeVisible()
  const calibration = (await idbAll<Order>(page, 'orders')).find((o) => o.hppPricing?.kind === 'calibration')!
  expect(calibration.grandTotal).toBeLessThan(marketing.grandTotal)

  // "Lepas" mengembalikan harga jual normal.
  await page.getByRole('button', { name: 'Lepas' }).click()
  await expect(page.getByText('Kalibrasi — Admin E2E')).toHaveCount(0)
  await expect
    .poll(async () => (await idbAll<Order>(page, 'orders')).find((o) => o.id === calibration.id)!.grandTotal)
    .toBe(marketing.grandTotal)
})

test('kantin: dialog Pesanan Baru tanpa pilihan jenis tagihan kafe', async ({ page }) => {
  await completeOnboarding(page, { businessType: 'Kantin', taxPercent: '0' })
  await openShift(page)
  await page.getByRole('link', { name: 'Kasir' }).click()
  await page.getByRole('button', { name: 'Pesanan Baru', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Pesanan Baru' })).toBeVisible()
  await expect(page.getByText('Jenis Tagihan')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Marketing', exact: true })).toHaveCount(0)
})
