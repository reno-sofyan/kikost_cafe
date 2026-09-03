import { expect, test, type Page } from '@playwright/test'
import { completeOnboarding, idbAll, openShift } from './helpers'

interface OrderItemRow { id: string; voided: boolean }
interface ProductRow { id: string; sku: string; stockQty: number }
interface ReturnRow { orderId: string; refundAmount: number; restocked: boolean }
interface AuditRow { action: string }

const PIN = '246810'

async function typePin(page: Page, dialog: ReturnType<Page['locator']>, pin: string) {
  for (const d of pin.split('')) await dialog.getByRole('button', { name: d, exact: true }).click()
  await dialog.getByRole('button', { name: 'Masuk' }).click()
}

test('retur sebagian: stok kembali, item ditandai voided, ada audit log', async ({ page }) => {
  test.slow()
  await completeOnboarding(page, { pin: PIN })
  await openShift(page)

  // Order takeaway + Kentang Goreng, bayar tunai.
  await page.getByRole('link', { name: 'Kasir' }).click()
  await page.getByRole('button', { name: '+ Pesanan Baru' }).click()
  const nb = page.locator('div.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Pesanan Baru' }) })
  await nb.getByRole('button', { name: 'Takeaway' }).click()
  await nb.getByRole('button', { name: 'Mulai Pesanan' }).click()
  await page.getByRole('button', { name: 'Snack' }).click()
  await page.getByRole('button', { name: /Kentang Goreng/ }).click()
  await page.getByRole('button', { name: /^Bayar •/ }).click()
  await page.getByRole('button', { name: 'Tunai', exact: true }).click()
  const cash = page.locator('div.rounded-2xl.bg-ink-900').filter({
    has: page.getByRole('heading', { name: 'Pembayaran Tunai' }),
  })
  await cash.getByRole('button', { name: 'Uang Pas' }).click()
  await cash.getByRole('button', { name: 'Konfirmasi' }).click()
  await page.getByRole('button', { name: 'Selesaikan Pembayaran' }).click()
  await expect(page.getByRole('heading', { name: 'Pembayaran Berhasil' })).toBeVisible({ timeout: 10_000 })

  const sku = 'SNACK-002'
  const afterSale = (await idbAll<ProductRow>(page, 'products')).find((p) => p.sku === sku)!
  expect(afterSale.stockQty).toBe(59)

  // Riwayat → buka transaksi → Retur.
  await page.getByRole('link', { name: 'Riwayat' }).click()
  await page.getByRole('button', { name: /KKP-00001/ }).click()
  const panel = page.locator('div.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'KKP-00001' }) })
  await panel.getByRole('button', { name: 'Retur', exact: true }).click()

  // Pilih item + centang "Kembalikan bahan ke stok" (default OFF, admin punya izin) → Lanjut.
  await panel.getByText(/Kentang Goreng/).locator('input[type=checkbox]').first().check()
  await panel.getByRole('checkbox', { name: /Kembalikan bahan ke stok/ }).check()
  await panel.getByRole('button', { name: 'Lanjut' }).click()

  // Alasan retur.
  const reason = page.locator('div.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Alasan Retur' }) })
  await reason.getByPlaceholder('Tulis alasan...').fill('barang salah')
  await reason.getByRole('button', { name: 'Lanjut' }).click()

  // PIN supervisor (admin).
  const pinModal = page.locator('div.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Konfirmasi Retur' }) })
  await typePin(page, pinModal, PIN)
  await expect(pinModal).toBeHidden()

  // Verifikasi.
  const returns = await idbAll<ReturnRow>(page, 'returns')
  expect(returns).toHaveLength(1)
  expect(returns[0].restocked).toBe(true)
  expect(returns[0].refundAmount).toBeGreaterThan(0)

  const backInStock = (await idbAll<ProductRow>(page, 'products')).find((p) => p.sku === sku)!
  expect(backInStock.stockQty).toBe(60) // dikembalikan

  const items = await idbAll<OrderItemRow>(page, 'orderItems')
  expect(items.every((i) => i.voided)).toBe(true)

  const audit = await idbAll<AuditRow>(page, 'auditLogs')
  expect(audit.some((a) => a.action === 'order.return')).toBe(true)

  // Order tidak dihapus.
  const orders = await idbAll<{ status: string }>(page, 'orders')
  expect(orders).toHaveLength(1)
  expect(orders[0].status).toBe('paid')
})
