import { expect, test, type Page } from '@playwright/test'
import { completeOnboarding, idbAll, openShift } from './helpers'

const SHOTS = process.env.E2E_SHOTS
const shot = async (page: Page, name: string, fullPage = false) => {
  if (!SHOTS) return
  await page.waitForTimeout(350)
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage })
}

test('beli X gratis Y, saldo member, promo ulang tahun, dan pembayaran komisi KOL', async ({ page }) => {
  test.slow()
  await completeOnboarding(page, { taxPercent: '0', servicePercent: '0' })
  await openShift(page)

  // --- Promo beli 2 gratis 1 (semua item).
  await page.getByRole('link', { name: 'Promo', exact: true }).click()
  await page.getByRole('button', { name: '+ Promo Otomatis' }).click()
  await page.getByLabel('Nama Promo').fill('Beli 2 Gratis 1')
  await page.getByRole('button', { name: 'Beli X Gratis Y' }).click()
  await shot(page, '20-form-promo-bxgy', true)
  await page.getByRole('button', { name: 'Simpan Promo' }).click()
  await expect(page.getByText('Beli 2 gratis 1', { exact: true })).toBeVisible()

  // --- KOL + voucher Rp2.000.
  await page.getByRole('button', { name: 'KOL / Influencer' }).click()
  await page.getByRole('button', { name: '+ KOL Baru' }).click()
  await page.getByLabel('Nama KOL').fill('Dina Kuliner')
  await page.getByLabel('Komisi (%)').fill('10')
  await page.getByRole('button', { name: 'Simpan KOL' }).click()
  await page.getByRole('button', { name: '+ kode' }).click()
  await page.getByLabel('Nama Voucher').fill('Voucher Dina')
  await page.getByLabel('Kode Voucher').fill('dina2k')
  await page.getByRole('button', { name: 'Rupiah' }).click()
  await page.getByLabel('Nilai Potongan').fill('2000')
  await page.getByRole('button', { name: 'Simpan Voucher' }).click()
  await expect(page.getByText('DINA2K')).toBeVisible()

  // --- Program member + saldo + masa berlaku poin.
  await page.getByRole('button', { name: 'Member & Poin' }).click()
  await page.getByLabel('Program member aktif').check()
  await page.getByLabel('Saldo member aktif').check()
  await page.getByLabel('Masa berlaku poin').fill('12')
  await page.getByRole('button', { name: 'Simpan Pengaturan Member' }).click()
  await expect(page.getByText('Pengaturan member disimpan.')).toBeVisible()
  await shot(page, '21-pengaturan-member', true)

  // --- Pelanggan baru dengan tanggal lahir bulan ini, lalu isi saldo tunai Rp100.000.
  const month = String(new Date().getMonth() + 1).padStart(2, '0')
  await page.getByRole('link', { name: 'Pelanggan' }).click()
  await page.getByRole('button', { name: '+ Pelanggan Baru' }).click()
  await page.getByPlaceholder('Nama', { exact: true }).fill('Bu Sari')
  await page.getByPlaceholder('Telepon', { exact: true }).fill('08123')
  await page.getByLabel('Tanggal lahir').fill(`1990-${month}-15`)
  await page.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(page.locator('span', { hasText: 'Ulang tahun bulan ini' })).toBeVisible()
  await page.getByRole('button', { name: 'Isi Saldo' }).click()
  await page.getByRole('button', { name: '100rb' }).click()
  await page.getByRole('button', { name: 'Isi Saldo' }).last().click()
  await expect(page.getByText('Saldo diisi.')).toBeVisible()
  await expect(page.getByText('Rp100.000').first()).toBeVisible()
  await shot(page, '22-pelanggan-saldo')

  // --- Kasir: 3 kentang → 1 gratis; voucher KOL; member dengan saldo.
  await page.getByRole('link', { name: 'Kasir' }).click()
  await page.getByRole('button', { name: 'Pesanan Baru', exact: true }).click()
  const nb = page.locator('div.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Pesanan Baru' }) })
  await nb.getByRole('button', { name: 'Takeaway' }).click()
  await nb.getByRole('button', { name: 'Mulai Pesanan' }).click()
  await page.getByRole('button', { name: 'Snack' }).click()
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /Kentang Goreng/ }).first().click()
  await expect(page.getByText('Promo Beli 2 Gratis 1')).toBeVisible()
  await page.getByRole('button', { name: 'Kode Voucher', exact: true }).click()
  await page.getByLabel('Kode voucher').fill('DINA2K')
  await page.getByRole('button', { name: 'Pasang Voucher' }).click()
  await expect(page.getByText('Voucher DINA2K').first()).toBeVisible()
  await page.getByRole('button', { name: 'Tambah member' }).click()
  await page.getByRole('button', { name: /Bu Sari/ }).click()
  await expect(page.getByRole('button', { name: /Bu Sari.*saldo Rp100\.000.*ulang tahun bulan ini/ })).toBeVisible()
  await shot(page, '23-kasir-bxgy-saldo')

  // --- Bayar penuh dengan saldo member: 45.000 − 15.000 (gratis) − 2.000 = 28.000.
  await page.getByRole('button', { name: /^Bayar •/ }).click()
  await shot(page, '24-bayar-saldo')
  await page.getByRole('button', { name: /Saldo Member \(Rp100\.000\)/ }).click()
  await page.getByRole('button', { name: 'Selesaikan Pembayaran' }).click()
  await expect(page.getByRole('heading', { name: 'Pembayaran Berhasil' })).toBeVisible({ timeout: 10_000 })
  const [order] = await idbAll<{ grandTotal: number; discountAmount: number }>(page, 'orders')
  expect(order).toMatchObject({ grandTotal: 28000, discountAmount: 17000 })
  const payments = await idbAll<{ method: string; amount: number; customerId?: string }>(page, 'payments')
  expect(payments).toEqual([expect.objectContaining({ method: 'deposit', amount: 28000 })])
  expect(payments[0].customerId).toBeTruthy()

  await page.getByRole('link', { name: 'Pelanggan' }).click()
  await page.getByRole('button', { name: /Bu Sari/ }).click()
  await expect(page.getByText('Rp72.000').first()).toBeVisible()

  // --- Komisi KOL 10% × 28.000 = 2.800 → dicatat lunas.
  await page.getByRole('link', { name: 'Promo', exact: true }).click()
  await page.getByRole('button', { name: 'KOL / Influencer' }).click()
  await page.getByRole('button', { name: 'Bayar Komisi' }).click()
  await expect(page.getByLabel('Nominal dibayar')).toHaveValue('Rp2.800')
  await shot(page, '25-bayar-komisi-kol')
  await page.getByRole('button', { name: 'Catat Pembayaran' }).click()
  await expect(page.getByText('dibayar Rp2.800')).toBeVisible()
  await shot(page, '26-kol-terutang')

  // --- Laporan: saldo member sebagai titipan.
  await page.getByRole('link', { name: 'Laporan', exact: true }).click()
  await expect(page.getByText('Isi Saldo Member')).toBeVisible()
  await expect(page.getByText('Titipan Saldo Saat Ini')).toBeVisible()
  await shot(page, '27-laporan-saldo', true)
})
