import { expect, test } from '@playwright/test'
import { completeOnboarding, idbAll, openShift } from './helpers'

interface OrderRow { id: string; status: string; lifecycleStatus: string; grandTotal: number }
interface BillRow { orderId: string; paymentStatus: string; amountPaid: number; grandTotal: number }
interface PaymentRow { orderId: string; amount: number }

test('pembayaran sebagian: DP dulu → pesanan tetap terbuka → pelunasan menyelesaikan', async ({ page }) => {
  test.slow()
  await completeOnboarding(page)
  await openShift(page)

  // Aktifkan pembayaran sebagian.
  await page.getByRole('link', { name: 'Pengaturan' }).click()
  await page.getByRole('button', { name: 'Pajak & Struk' }).click()
  await page.getByRole('checkbox', { name: /Izinkan pembayaran sebagian/ }).check()
  await page.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(page.getByText('Tersimpan')).toBeVisible()

  // Buat pesanan.
  await page.getByRole('link', { name: 'Kasir' }).click()
  await page.getByRole('button', { name: '+ Pesanan Baru' }).click()
  const nb = page.locator('div.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Pesanan Baru' }) })
  await nb.getByRole('button', { name: 'Takeaway' }).click()
  await nb.getByRole('button', { name: 'Mulai Pesanan' }).click()
  await page.getByRole('button', { name: 'Snack' }).click()
  await page.getByRole('button', { name: /Kentang Goreng/ }).click()

  const grand = (await idbAll<OrderRow>(page, 'orders'))[0].grandTotal

  // Bayar sebagian (setengah, dibulatkan ke bawah).
  await page.getByRole('button', { name: /^Bayar •/ }).click()
  await page.getByRole('button', { name: 'Tunai', exact: true }).click()
  const cash = page.locator('div.rounded-2xl.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Pembayaran Tunai' }) })
  await cash.getByLabel('Jumlah untuk tagihan ini').fill('5000')
  await cash.getByRole('button', { name: 'Konfirmasi' }).click()
  await page.getByRole('button', { name: /Bayar Sebagian/ }).click()

  // Kembali ke kasir; pesanan belum selesai.
  await expect(page).toHaveURL(/\/kasir$/)
  let orders = await idbAll<OrderRow>(page, 'orders')
  expect(orders[0].status).toBe('open')
  expect(orders[0].lifecycleStatus).not.toBe('COMPLETED')
  let bill = (await idbAll<BillRow>(page, 'bills'))[0]
  expect(bill.paymentStatus).toBe('PARTIALLY_PAID')
  expect(bill.amountPaid).toBe(5000)

  // Lunasi sisa lewat "Pesanan Terbuka".
  await page.getByRole('button', { name: 'Pesanan Terbuka' }).click()
  const drawer = page.locator('div.fixed.inset-0.z-50').filter({ has: page.getByRole('heading', { name: 'Pesanan Terbuka' }) })
  await drawer.locator('button.card').first().click()
  await page.getByRole('button', { name: /^Bayar •/ }).click()
  await expect(page.getByText('Sudah dibayar sebelumnya')).toBeVisible()
  await page.getByRole('button', { name: 'Tunai', exact: true }).click()
  const cash2 = page.locator('div.rounded-2xl.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Pembayaran Tunai' }) })
  await cash2.getByRole('button', { name: 'Uang Pas' }).click()
  await cash2.getByRole('button', { name: 'Konfirmasi' }).click()
  await page.getByRole('button', { name: 'Selesaikan Pembayaran' }).click()
  await expect(page.getByRole('heading', { name: 'Pembayaran Berhasil' })).toBeVisible({ timeout: 10_000 })

  orders = await idbAll<OrderRow>(page, 'orders')
  expect(orders[0].lifecycleStatus).toBe('COMPLETED')
  bill = (await idbAll<BillRow>(page, 'bills'))[0]
  expect(bill.paymentStatus).toBe('PAID')

  const pays = await idbAll<PaymentRow>(page, 'payments')
  expect(pays.filter((p) => p.amount > 0).reduce((s, p) => s + p.amount, 0)).toBe(grand)
})
