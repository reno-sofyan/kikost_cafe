import { expect, test } from '@playwright/test'
import { completeOnboarding, idbAll, openShift } from './helpers'
import type { Order } from '../../src/types/domain'

test('kafe: klien Tagihan Marketing dipilih dari pelanggan terdaftar → bill gantung dilunasi dengan saldo member', async ({ page }) => {
  test.slow()
  await completeOnboarding(page, { businessType: 'Kafe & Restoran', taxPercent: '0', servicePercent: '0' })
  await openShift(page)

  await page.getByRole('link', { name: 'Member', exact: true }).click()
  await page.getByLabel('Program member aktif').check()
  await page.getByLabel('Saldo member aktif').check()
  await page.getByRole('button', { name: 'Simpan Pengaturan Member' }).click()
  await expect(page.getByText('Pengaturan member disimpan.')).toBeVisible()

  await page.getByRole('link', { name: 'Pelanggan', exact: true }).click()
  await page.getByRole('button', { name: 'Tim Marketing' }).click()
  await page.getByRole('button', { name: '+ Sales Baru' }).click()
  await page.getByLabel('Nama sales').fill('Budi Santoso')
  await page.getByRole('button', { name: 'Simpan' }).click()
  await page.getByRole('button', { name: 'Pelanggan', exact: true }).click()
  await page.getByRole('button', { name: '+ Pelanggan Baru' }).click()
  await page.getByPlaceholder('Nama', { exact: true }).fill('Bu Sari')
  await page.getByPlaceholder('Telepon', { exact: true }).fill('08123')
  await page.getByRole('button', { name: 'Simpan', exact: true }).click()
  await page.getByRole('button', { name: 'Isi Saldo' }).click()
  await page.getByRole('button', { name: '100rb' }).click()
  await page.getByRole('button', { name: 'Isi Saldo' }).last().click()
  await expect(page.getByText('Saldo diisi.')).toBeVisible()

  // --- Pesanan Baru → Marketing: klien dipilih dari dropdown pelanggan terdaftar.
  await page.getByRole('link', { name: 'Kasir' }).click()
  await page.getByRole('button', { name: 'Pesanan Baru', exact: true }).click()
  const nb = page.locator('div.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Pesanan Baru' }) })
  await nb.getByRole('button', { name: 'Takeaway' }).click()
  await nb.getByRole('button', { name: 'Marketing', exact: true }).click()
  await nb.getByRole('button', { name: /Budi Santoso/ }).click()
  await nb.getByLabel('Nama klien').fill('sari')
  await nb.getByRole('button', { name: /Bu Sari • 08123 • saldo Rp100\.000/ }).click()
  await expect(nb.getByText('Terdaftar • saldo Rp100.000')).toBeVisible()
  await nb.getByRole('button', { name: 'Mulai Pesanan' }).click()
  await page.getByRole('button', { name: 'Snack' }).click()
  await page.getByRole('button', { name: /Kentang Goreng/ }).click()
  await expect(page.getByRole('button', { name: /Bu Sari.*saldo Rp100\.000/ })).toBeVisible()
  await page.getByRole('button', { name: 'Simpan Tagihan Marketing' }).click()
  await page.getByRole('button', { name: 'Simpan Tagihan', exact: true }).click()
  await expect(page.getByText('Tagihan Marketing Budi Santoso tersimpan.')).toBeVisible()

  // --- Bill gantung dibuka lagi → bayar dengan Saldo Member.
  await page.getByRole('button', { name: 'Pesanan Terbuka', exact: true }).click()
  await page.getByRole('button', { name: /Tagihan Tertunda \(1\)/ }).click()
  await page.getByRole('button', { name: /Tagihan Marketing • Budi Santoso/ }).click()
  await page.getByRole('button', { name: /^Bayar •/ }).click()
  await page.getByRole('button', { name: /Saldo Member \(Rp100\.000\)/ }).click()
  await page.getByRole('button', { name: 'Selesaikan Pembayaran' }).click()
  await expect(page.getByRole('heading', { name: 'Pembayaran Berhasil' })).toBeVisible({ timeout: 10_000 })
  const order = (await idbAll<Order>(page, 'orders')).find((o) => o.marketingBill)!
  expect(order.marketingBill?.clientName).toBe('Bu Sari')
  const payments = await idbAll<{ method: string; amount: number; customerId?: string }>(page, 'payments')
  expect(payments).toEqual([expect.objectContaining({ method: 'deposit', amount: 15000, customerId: order.customerId })])
})
