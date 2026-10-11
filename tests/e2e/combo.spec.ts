import { expect, test } from '@playwright/test'
import { completeOnboarding, idbAll, openShift } from './helpers'

const SHOTS = process.env.E2E_SHOTS

test('menu paket: dibuat di form produk, dijual di kasir, stok dipotong dari isinya', async ({ page }) => {
  test.slow()
  await completeOnboarding(page, { taxPercent: '0', servicePercent: '0' })
  await openShift(page)
  type P = { id: string; name: string; sku: string; stockQty: number; trackOwnStock: boolean; comboItems?: { productId: string; qty: number }[] }
  const before = await idbAll<P>(page, 'products')
  const kentang = before.find((p) => p.name === 'Kentang Goreng')!

  await page.getByRole('link', { name: 'Produk', exact: true }).click()
  await page.getByRole('button', { name: '+ Produk Baru' }).click()
  const form = page.locator('div.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Produk Baru' }) })
  await form.getByLabel('Nama Produk').fill('Paket Ngemil')
  await form.getByLabel('SKU').fill('PKT-001')
  await form.getByLabel('Harga Jual').fill('25000')
  await form.getByRole('button', { name: '+ Tambah Isi Paket' }).click()
  await form.getByLabel('Produk isi paket 1').selectOption(kentang.id)
  await form.getByLabel('Jumlah isi paket 1').fill('2')
  await expect(form.getByText(/Harga normal isi Rp30\.000 • hemat Rp5\.000/)).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/15-form-paket.png` })
  await form.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(form).toBeHidden()

  const paket = (await idbAll<P>(page, 'products')).find((p) => p.name === 'Paket Ngemil')!
  expect(paket.trackOwnStock).toBe(false)
  expect(paket.comboItems).toEqual([{ productId: kentang.id, qty: 2 }])

  await page.getByRole('link', { name: 'Kasir' }).click()
  await page.getByRole('button', { name: '+ Pesanan Baru' }).click()
  const nb = page.locator('div.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Pesanan Baru' }) })
  await nb.getByRole('button', { name: 'Takeaway' }).click()
  await nb.getByRole('button', { name: 'Mulai Pesanan' }).click()
  await page.getByPlaceholder(/Cari produk/).fill('Paket Ngemil')
  await page.getByRole('button', { name: /Paket Ngemil/ }).click()
  await expect(page.getByText('Isi paket: 2× Kentang Goreng')).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/16-kasir-paket.png` })

  await page.getByRole('button', { name: /^Bayar •/ }).click()
  await page.getByRole('button', { name: 'Tunai', exact: true }).click()
  const cash = page.locator('div.rounded-2xl.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Pembayaran Tunai' }) })
  await cash.getByRole('button', { name: 'Uang Pas' }).click()
  await cash.getByRole('button', { name: 'Konfirmasi' }).click()
  await page.getByRole('button', { name: 'Selesaikan Pembayaran' }).click()
  await expect(page.getByRole('heading', { name: 'Pembayaran Berhasil' })).toBeVisible({ timeout: 10_000 })

  const after = (await idbAll<P>(page, 'products')).find((p) => p.id === kentang.id)!
  expect(after.stockQty).toBe(kentang.stockQty - 2)
})
