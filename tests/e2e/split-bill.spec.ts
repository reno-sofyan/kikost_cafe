import { expect, test } from '@playwright/test'
import { completeOnboarding, idbAll, openShift } from './helpers'

interface OrderRow { id: string; status: string; lifecycleStatus: string; grandTotal: number }
interface BillRow { id: string; orderId: string; itemIds: string[] | 'all'; paymentStatus: string; grandTotal: number }
interface ProductRow { name: string; stockQty: number }

test('pisah tagihan per item: bayar tiap tagihan → order COMPLETED sekali, stok berkurang sekali', async ({ page }) => {
  test.slow()
  await completeOnboarding(page)
  await openShift(page)

  await page.getByRole('link', { name: 'Kasir' }).click()
  await page.getByRole('button', { name: '+ Pesanan Baru' }).click()
  const nb = page.locator('div.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Pesanan Baru' }) })
  await nb.getByRole('button', { name: 'Takeaway' }).click()
  await nb.getByRole('button', { name: 'Mulai Pesanan' }).click()
  await page.getByRole('button', { name: 'Snack' }).click()
  await page.getByRole('button', { name: /Kentang Goreng/ }).click()
  await page.getByRole('button', { name: /Pisang Goreng/ }).click()

  const grand = (await idbAll<OrderRow>(page, 'orders'))[0].grandTotal
  expect(grand).toBeGreaterThan(0)

  await page.getByRole('button', { name: /^Bayar •/ }).click()

  // Pecah: pindahkan Pisang ke Tagihan 2.
  await page.getByRole('button', { name: 'Pisah per Item' }).click()
  const modal = page.locator('div.fixed.inset-0.z-50').filter({ has: page.getByRole('heading', { name: 'Pisah Tagihan per Item' }) })
  await modal.locator('div.bg-ink-800').filter({ hasText: 'Pisang Goreng' }).getByRole('button', { name: 'Tagihan 2' }).click()
  await modal.getByRole('button', { name: 'Buat Tagihan Terpisah' }).click()

  // Dua kartu tagihan.
  await expect(page.getByRole('button', { name: 'Bayar Tagihan 1' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Bayar Tagihan 2' })).toBeVisible()

  // Bayar Tagihan 1 (Kentang, 15000) tunai.
  const card1 = page.locator('div.card').filter({ has: page.getByRole('button', { name: 'Bayar Tagihan 1' }) })
  await card1.getByRole('button', { name: 'Tunai', exact: true }).click()
  let cash = page.locator('div.rounded-2xl.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Pembayaran Tunai' }) })
  await cash.getByRole('button', { name: 'Uang Pas' }).click()
  await cash.getByRole('button', { name: 'Konfirmasi' }).click()
  await page.getByRole('button', { name: 'Bayar Tagihan 1' }).click()

  // Order belum selesai.
  let orders = await idbAll<OrderRow>(page, 'orders')
  expect(orders[0].lifecycleStatus).not.toBe('COMPLETED')

  // Bayar Tagihan 2 (Pisang, 17000) tunai → order selesai.
  const card2 = page.locator('div.card').filter({ has: page.getByRole('button', { name: 'Bayar Tagihan 2' }) })
  await card2.getByRole('button', { name: 'Tunai', exact: true }).click()
  cash = page.locator('div.rounded-2xl.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Pembayaran Tunai' }) })
  await cash.getByRole('button', { name: 'Uang Pas' }).click()
  await cash.getByRole('button', { name: 'Konfirmasi' }).click()
  await page.getByRole('button', { name: 'Bayar Tagihan 2' }).click()

  await expect(page.getByRole('heading', { name: 'Pembayaran Berhasil' })).toBeVisible({ timeout: 10_000 })

  orders = await idbAll<OrderRow>(page, 'orders')
  expect(orders[0].lifecycleStatus).toBe('COMPLETED')

  const bills = await idbAll<BillRow>(page, 'bills')
  const active = bills.filter((b) => b.grandTotal > 0)
  expect(active).toHaveLength(2)
  expect(active.every((b) => b.paymentStatus === 'PAID')).toBe(true)
  expect(active.reduce((s, b) => s + b.grandTotal, 0)).toBe(grand)

  const products = await idbAll<ProductRow>(page, 'products')
  expect(products.find((p) => p.name === 'Kentang Goreng')?.stockQty).toBe(59)
  expect(products.find((p) => p.name === 'Pisang Goreng Keju')?.stockQty).toBe(39)
})
