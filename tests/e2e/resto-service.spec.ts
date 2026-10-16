import { expect, test } from '@playwright/test'
import { completeOnboarding, idbAll, openShift } from './helpers'

const SHOTS = process.env.E2E_SHOTS

test('layanan resto: pelayan, cetak tagihan, tip saat bayar, dan reservasi', async ({ page }) => {
  test.slow()
  await completeOnboarding(page)
  await openShift(page)

  await page.getByRole('link', { name: 'Kasir' }).click()
  await page.getByRole('button', { name: 'Pesanan Baru', exact: true }).click()
  const nb = page.locator('div.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Pesanan Baru' }) })
  await nb.getByRole('button', { name: 'Takeaway' }).click()
  await nb.getByRole('button', { name: 'Mulai Pesanan' }).click()
  await page.getByRole('button', { name: 'Snack' }).click()
  await page.getByRole('button', { name: /Kentang Goreng/ }).click()

  // Pelayan dipilih dari keranjang.
  await page.getByRole('button', { name: 'Pilih pelayan' }).click()
  await page.getByRole('button', { name: /Admin E2E/ }).last().click()
  await expect(page.getByRole('button', { name: 'Pelayan: Admin E2E' })).toBeVisible()

  // Tagihan sementara (pre-bill) — pratinjau menandai BELUM DIBAYAR.
  await page.getByRole('button', { name: 'Cetak Tagihan' }).click()
  await expect(page.getByText(/belum dibayar/i).first()).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/7-pre-bill.png` })
  await page.keyboard.press('Escape')

  // Bayar tunai dengan tip.
  await page.getByRole('button', { name: /^Bayar •/ }).click()
  await page.getByRole('button', { name: 'Tunai', exact: true }).click()
  const cash = page.locator('div.rounded-2xl.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Pembayaran Tunai' }) })
  await cash.getByRole('button', { name: 'Uang Pas' }).click()
  await cash.getByRole('button', { name: 'Konfirmasi' }).click()
  await page.getByRole('button', { name: '+ Tip' }).click()
  await page.getByRole('button', { name: '5rb' }).click()
  await page.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(page.getByText('+ Tip Rp5.000')).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/8-bayar-tip.png` })
  await page.getByRole('button', { name: 'Selesaikan Pembayaran' }).click()
  await expect(page.getByRole('heading', { name: 'Pembayaran Berhasil' })).toBeVisible({ timeout: 10_000 })

  const [order] = await idbAll<{ waiterName: string; billPrintCount?: number; grandTotal: number }>(page, 'orders')
  expect(order.waiterName).toBe('Admin E2E')
  const [payment] = await idbAll<{ amount: number; tipAmount: number }>(page, 'payments')
  expect(payment).toMatchObject({ amount: order.grandTotal, tipAmount: 5000 })

  // Reservasi baru tercatat.
  await page.getByRole('link', { name: 'Meja', exact: true }).click()
  await page.getByRole('button', { name: 'Reservasi', exact: true }).click()
  await page.getByRole('button', { name: 'Reservasi Baru' }).click()
  await page.getByLabel('Nama Pemesan').fill('Bu Sari')
  await page.getByRole('button', { name: 'Simpan Reservasi' }).click()
  await expect(page.getByText('Bu Sari').first()).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/9-reservasi.png` })
  const reservations = await idbAll<{ customerName: string; status: string }>(page, 'reservations')
  expect(reservations).toHaveLength(1)
  expect(reservations[0].customerName).toBe('Bu Sari')
})
