import { expect, test, type Page } from '@playwright/test'
import { completeOnboarding, idbAll, openShift } from './helpers'

const PIN = '246810'

async function payTakeawayKentang(page: Page) {
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
}

async function typePin(dialog: ReturnType<Page['locator']>, pin: string) {
  for (const d of pin.split('')) await dialog.getByRole('button', { name: d, exact: true }).click()
  await dialog.getByRole('button', { name: 'Masuk' }).click()
}

test('pembatalan transaksi via UI (PIN admin): status void, pembayaran pembalik, audit log', async ({ page }) => {
  test.slow()
  await completeOnboarding(page, { pin: PIN })
  await openShift(page)
  await payTakeawayKentang(page)
  expect((await idbAll<{ sku: string; stockQty: number }>(page, 'products')).find((p) => p.sku === 'SNACK-002')!.stockQty).toBe(59)

  await page.getByRole('link', { name: 'Riwayat' }).click()
  await page.getByRole('button', { name: /KKP-00001/ }).click()
  const panel = page.locator('div.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'KKP-00001' }) })
  await panel.getByRole('button', { name: 'Batalkan Transaksi' }).click()

  const reason = page.locator('div.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Batalkan Transaksi' }) })
  await reason.getByPlaceholder('Tulis alasan...').fill('uji pembatalan')
  await reason.getByRole('button', { name: 'Lanjut' }).click()

  const pinModal = page.locator('div.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Konfirmasi Pembatalan' }) })
  await typePin(pinModal, PIN)
  await expect(pinModal).toBeHidden()

  const orders = await idbAll<{ status: string; lifecycleStatus: string; voidReason: string | null }>(page, 'orders')
  expect(orders).toHaveLength(1)
  expect(orders[0].status).toBe('void')
  expect(orders[0].lifecycleStatus).toBe('VOIDED')
  expect(orders[0].voidReason).toContain('uji pembatalan')

  // Void TIDAK mengembalikan stok (makanan mungkin sudah dibuat) — koreksi lewat pembayaran pembalik.
  expect((await idbAll<{ sku: string; stockQty: number }>(page, 'products')).find((p) => p.sku === 'SNACK-002')!.stockQty).toBe(59)
  const pays = await idbAll<{ amount: number }>(page, 'payments')
  expect(pays.some((p) => p.amount < 0)).toBe(true)
  const audit = await idbAll<{ action: string }>(page, 'auditLogs')
  expect(audit.some((a) => a.action === 'order.void')).toBe(true)
})

test('laporan Hari Ini: omzet, jumlah transaksi, laba kotor (HPP), produk terlaris', async ({ page }) => {
  test.slow()
  await completeOnboarding(page)
  await openShift(page)
  await payTakeawayKentang(page)

  await page.getByRole('link', { name: 'Laporan' }).click()
  await page.getByRole('button', { name: 'Hari Ini' }).click()

  // Nilai StatCard = <p.text-xs>label</p> lalu <p.text-lg>value</p>.
  const statValue = (label: string) =>
    page.locator('p.text-xs', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::p[1]')

  await expect(statValue('Omzet')).toContainText(/\d/)
  await expect(statValue('Jumlah Transaksi')).toHaveText('1')

  const omzet = Number((await statValue('Omzet').innerText()).replace(/\D/g, ''))
  const laba = Number((await statValue('Laba Kotor').innerText()).replace(/\D/g, ''))
  expect(laba).toBeGreaterThan(0)
  expect(laba).toBeLessThan(omzet) // HPP dipotong

  // Kentang Goreng terjual (Produk Terlaris) dengan qty 1x.
  await expect(page.getByRole('heading', { name: 'Produk Terlaris' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Kentang Goreng' }).first()).toBeVisible()
  await expect(page.getByRole('cell', { name: '1x' }).first()).toBeVisible()

  // Laporan Stok ter-render (tak crash — regresi indeks Dexie).
  await expect(page.getByRole('heading', { name: 'Laporan Stok' })).toBeVisible()
})
