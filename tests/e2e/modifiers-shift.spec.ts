import { expect, test, type Page } from '@playwright/test'
import { completeOnboarding, idbAll, openShift } from './helpers'

interface OrderItemRow {
  productName: string
  qty: number
  lineTotal: number
  modifiers: { groupName: string; optionName: string; priceDelta: number }[]
}
interface ShiftRow { status: string; variance: number | null }

async function startTakeaway(page: Page) {
  await page.getByRole('link', { name: 'Kasir' }).click()
  await page.getByRole('button', { name: '+ Pesanan Baru' }).click()
  const modal = page.locator('div.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Pesanan Baru' }) })
  await modal.getByRole('button', { name: 'Takeaway' }).click()
  await modal.getByRole('button', { name: 'Mulai Pesanan' }).click()
  await expect(modal).toBeHidden()
}

test('modifier picker: Large + Boba menambah harga & tersimpan di item', async ({ page }) => {
  test.slow()
  await completeOnboarding(page)
  await openShift(page)
  await startTakeaway(page)

  await page.getByRole('button', { name: 'Kopi', exact: true }).click()
  await page.getByRole('button', { name: /Cappuccino/ }).click()

  await expect(page.getByRole('heading', { name: 'Cappuccino' })).toBeVisible()
  await page.getByRole('button', { name: /^Large/ }).click()
  await page.getByRole('button', { name: /^Boba/ }).click()
  await page.getByRole('button', { name: /^Tambah •/ }).click()

  // Tunggu picker tertutup DAN item benar-benar masuk keranjang (bukan cuma judul picker).
  await expect(page.getByRole('button', { name: /^Tambah •/ })).toBeHidden()
  await expect(page.getByText(/Ukuran: Large/)).toBeVisible()

  const items = await idbAll<OrderItemRow>(page, 'orderItems')
  expect(items).toHaveLength(1)
  expect(items[0].lineTotal).toBe(35000) // 25.000 + Large 5.000 + Boba 5.000
  const opts = items[0].modifiers.map((m) => m.optionName)
  expect(opts).toContain('Large')
  expect(opts).toContain('Boba')
  expect(items[0].modifiers.reduce((s, m) => s + m.priceDelta, 0)).toBe(10000)
})

test('tutup shift DITOLAK bila masih ada open bill', async ({ page }) => {
  test.slow()
  await completeOnboarding(page)
  await openShift(page)
  await startTakeaway(page)

  await page.getByRole('button', { name: 'Snack' }).click()
  await page.getByRole('button', { name: /Kentang Goreng/ }).click()
  await page.getByRole('button', { name: 'Simpan', exact: true }).click()

  await page.getByRole('link', { name: 'Shift' }).click()
  await page.getByRole('button', { name: 'Tutup Shift', exact: true }).click()
  const dialog = page.locator('div.rounded-2xl.bg-ink-900').filter({
    has: page.getByRole('heading', { name: 'Tutup Shift' }),
  })
  await dialog.getByRole('button', { name: /Tutup Shift & Cetak/ }).click()

  await expect(page.getByText(/Masih ada open bill/)).toBeVisible()
  const shifts = await idbAll<ShiftRow>(page, 'shifts')
  expect(shifts.filter((s) => s.status === 'open')).toHaveLength(1)
})

test('tutup shift setelah dibayar: selisih dihitung, shift closed', async ({ page }) => {
  test.slow()
  await completeOnboarding(page)
  await openShift(page, '500000')
  await startTakeaway(page)

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

  await page.getByRole('link', { name: 'Shift' }).click()
  await page.getByRole('button', { name: 'Tutup Shift', exact: true }).click()
  const dialog = page.locator('div.rounded-2xl.bg-ink-900').filter({
    has: page.getByRole('heading', { name: 'Tutup Shift' }),
  })
  const actualInput = dialog.getByLabel('Kas Aktual (hasil hitung fisik)')
  const seharusnya = Number((await actualInput.inputValue()).replace(/\D/g, ''))
  expect(seharusnya).toBeGreaterThan(500000) // modal awal + penjualan tunai
  await actualInput.fill(String(seharusnya - 5000))
  await expect(dialog.getByText(/Selisih/)).toContainText('5.000')
  await dialog.getByRole('button', { name: /Tutup Shift & Cetak/ }).click()

  await expect(dialog).toBeHidden()
  const shifts = await idbAll<ShiftRow>(page, 'shifts')
  const closed = shifts.filter((s) => s.status === 'closed')
  expect(closed).toHaveLength(1)
  expect(closed[0].variance).toBe(-5000)
})
