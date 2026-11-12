import { expect, test, type Page } from '@playwright/test'
import { completeOnboarding, idbAll, openShift } from './helpers'

// Laundry: alur harian dari onboarding sampai tutup shift; gagal bila ada error JS/konsol.
function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(`console: ${m.text()}`)
  })
  return errors
}
const dialogWith = (page: Page, heading: string | RegExp) =>
  page.locator('div.rounded-2xl.bg-ink-900').filter({ has: page.getByRole('heading', { name: heading }) })

/** Tutup shift — juga mode "tutup buta" minimarket (kas seharusnya disembunyikan dulu). */
async function closeShift(page: Page) {
  const shifts = await idbAll<{ status: string; expectedCash: number }>(page, 'shifts')
  const expected = shifts.find((s) => s.status === 'open')!.expectedCash
  await page.getByRole('link', { name: 'Shift', exact: true }).click()
  await page.getByRole('button', { name: 'Tutup Shift', exact: true }).click()
  const dialog = dialogWith(page, 'Tutup Shift')
  await dialog.getByLabel('Kas Aktual (hasil hitung fisik)').fill(String(expected))
  const next = dialog.getByRole('button', { name: 'Lanjut', exact: true })
  if (await next.isVisible()) await next.click()
  await dialog.getByRole('button', { name: /Tutup Shift & Cetak/ }).click()
  await expect(dialog).toBeHidden()
  expect((await idbAll<{ status: string }>(page, 'shifts')).every((s) => s.status === 'closed')).toBe(true)
}

async function tourModules(page: Page) {
  const nav = page.getByRole('navigation').first()
  for (const link of await nav.getByRole('link').all()) {
    await link.click()
    await page.waitForTimeout(250)
  }
}

async function relogin(page: Page, pin: string) {
  await page.reload()
  await page.getByRole('button', { name: /^Masuk sebagai Admin E2E,/ }).click()
  for (const d of '0000') await page.getByRole('button', { name: d, exact: true }).click()
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await expect(page.getByText(/PIN salah\. Sisa percobaan/)).toBeVisible()
  for (const d of pin) await page.getByRole('button', { name: d, exact: true }).click()
  await page.getByRole('button', { name: 'Masuk', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Kasir', exact: true })).toBeVisible({ timeout: 10_000 })
}

test('laundry: nama pelanggan wajib, layanan kiloan, bayar tunai, riwayat, login ulang, tutup shift', async ({ page }) => {
  test.slow()
  const errors = watchErrors(page)
  await completeOnboarding(page, { businessType: 'Laundry', taxPercent: '0' })
  await openShift(page)
  await page.getByRole('link', { name: 'Kasir', exact: true }).click()
  // Gaya kafe (indigo), bukan ritel; menu meja/dapur/QR tak ada.
  expect(await page.evaluate(() => document.documentElement.dataset.theme ?? null)).toBeNull()
  for (const hidden of ['Meja', 'Dapur', 'Pesanan QR']) await expect(page.getByRole('link', { name: hidden, exact: true })).toHaveCount(0)

  const addService = async (name: RegExp) => {
    await page.getByRole('button', { name }).first().click()
    const add = page.getByRole('button', { name: /^Tambah •/ })
    if (await add.isVisible({ timeout: 1500 }).catch(() => false)) await add.click()
  }

  for (const customer of ['Ibu Rina', 'Pak Dedi']) {
    await page.getByRole('button', { name: 'Pesanan Baru', exact: true }).click()
    const nb = dialogWith(page, 'Pesanan Baru')
    await expect(nb.getByRole('button', { name: 'Mulai Pesanan' })).toBeDisabled() // nama wajib
    await expect(nb.getByText('Jenis Tagihan')).toHaveCount(0)
    await nb.getByPlaceholder('mis. "Budi"').fill(customer)
    await nb.getByRole('button', { name: 'Mulai Pesanan' }).click()
    await expect(nb).toBeHidden()
    await addService(/Cuci Setrika \(per kg\)/)
    // Layanan laundry tak lewat dapur: tanpa label "Dapur", dan Kosongkan benar-benar mengosongkan.
    await expect(page.getByText(/^Dapur:/)).toHaveCount(0)
    await page.getByRole('button', { name: 'Kosongkan', exact: true }).click()
    await page.getByRole('button', { name: 'Ya, Kosongkan' }).click()
    await expect(page.getByText('Keranjang kosong — tap produk di kiri.')).toBeVisible()
    await expect(page.getByText(/harus dibatalkan satu per satu/)).toHaveCount(0)
    await addService(/Cuci Setrika \(per kg\)/)
    await addService(/Cuci Setrika \(per kg\)/)
    await page.getByRole('button', { name: /^Bayar •/ }).click()
    await page.getByRole('button', { name: 'Tunai', exact: true }).click()
    const cash = dialogWith(page, 'Pembayaran Tunai')
    await cash.getByRole('button', { name: 'Uang Pas' }).click()
    await cash.getByRole('button', { name: 'Konfirmasi' }).click()
    await page.getByRole('button', { name: 'Selesaikan Pembayaran' }).click()
    await expect(page.getByRole('heading', { name: 'Pembayaran Berhasil' })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(customer).first()).toBeVisible()
    await page.getByRole('link', { name: 'Kasir', exact: true }).click()
  }

  const orders = await idbAll<{ status: string; notes: string; queueNumber: number | null; grandTotal: number }>(page, 'orders')
  const paid = orders.filter((o) => o.status === 'paid')
  expect(paid.map((o) => o.notes).sort()).toEqual(['Ibu Rina', 'Pak Dedi'])
  expect(paid.every((o) => o.queueNumber != null && o.grandTotal === 18000)).toBe(true)

  await tourModules(page)
  await page.getByRole('link', { name: 'Riwayat', exact: true }).click()
  await expect(page.getByRole('button', { name: /Rp18\.000 Lunas$/ })).toHaveCount(2)

  await relogin(page, '246810')
  await closeShift(page)
  expect(errors).toEqual([])
})
