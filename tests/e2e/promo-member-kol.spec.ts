import { expect, test, type Page } from '@playwright/test'
import { completeOnboarding, idbAll, openShift } from './helpers'

const SHOTS = process.env.E2E_SHOTS
const shot = async (page: Page, name: string, fullPage = false) => {
  if (!SHOTS) return
  await page.waitForTimeout(350)
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage })
}

test('promo otomatis, voucher KOL, dan poin member dari pengaturan sampai laporan', async ({ page }) => {
  test.slow()
  await completeOnboarding(page, { taxPercent: '0', servicePercent: '0' })
  await openShift(page)

  // --- Promo otomatis 10% untuk semua item.
  await page.getByRole('link', { name: 'Promo', exact: true }).click()
  await page.getByRole('button', { name: '+ Promo Otomatis' }).click()
  await page.getByLabel('Nama Promo').fill('Diskon Pembukaan')
  await page.getByRole('button', { name: 'Simpan Promo' }).click()
  await expect(page.getByText('Diskon Pembukaan')).toBeVisible()
  await expect(page.getByText('Sedang berlaku')).toBeVisible()

  // --- KOL + kode vouchernya (potongan Rp2.000).
  await page.getByRole('button', { name: 'KOL / Influencer' }).click()
  await page.getByRole('button', { name: '+ KOL Baru' }).click()
  await page.getByLabel('Nama KOL').fill('Dina Kuliner')
  await page.getByLabel('Nama Akun').fill('@dinakuliner')
  await page.getByLabel('Komisi (%)').fill('10')
  await page.getByRole('button', { name: 'Simpan KOL' }).click()
  await page.getByRole('button', { name: '+ kode' }).click()
  await page.getByLabel('Nama Voucher').fill('Voucher Dina')
  await page.getByLabel('Kode Voucher').fill('dina2k')
  await page.getByRole('button', { name: 'Rupiah' }).click()
  await page.getByLabel('Nilai Potongan').fill('2000')
  await page.getByRole('button', { name: 'Simpan Voucher' }).click()
  await expect(page.getByText('DINA2K')).toBeVisible()
  await shot(page, '10-kol')

  // --- Program member aktif (bawaan: Rp10.000 = 1 poin).
  await page.getByRole('button', { name: 'Member & Poin' }).click()
  await page.getByLabel('Program member aktif').check()
  await page.getByRole('button', { name: 'Simpan Pengaturan Member' }).click()
  await shot(page, '11-member-settings')

  // --- Kasir: promo terpasang sendiri, voucher lewat kode, member didaftarkan di tempat.
  await page.getByRole('link', { name: 'Kasir' }).click()
  await page.getByRole('button', { name: 'Pesanan Baru', exact: true }).click()
  const nb = page.locator('div.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Pesanan Baru' }) })
  await nb.getByRole('button', { name: 'Takeaway' }).click()
  await nb.getByRole('button', { name: 'Mulai Pesanan' }).click()
  await page.getByRole('button', { name: 'Snack' }).click()
  await page.getByRole('button', { name: /Kentang Goreng/ }).click()
  await expect(page.getByText('Promo Diskon Pembukaan')).toBeVisible()

  await page.getByRole('button', { name: 'Kode Voucher', exact: true }).click()
  await page.getByLabel('Kode voucher').fill('SALAH')
  await page.getByRole('button', { name: 'Pasang Voucher' }).click()
  await expect(page.getByText(/tidak dikenal/)).toBeVisible()
  await page.getByLabel('Kode voucher').fill('DINA2K')
  await page.getByRole('button', { name: 'Pasang Voucher' }).click()
  await expect(page.getByText('Voucher DINA2K').first()).toBeVisible()

  await page.getByRole('button', { name: 'Tambah member' }).click()
  await page.getByRole('button', { name: '+ Member Baru' }).click()
  await page.getByPlaceholder('Nama', { exact: true }).fill('Bu Sari')
  await page.getByPlaceholder('No. HP').fill('08123')
  await page.getByRole('button', { name: 'Daftarkan & Pilih' }).click()
  await expect(page.getByRole('button', { name: /Bu Sari • Silver • 0 poin/ })).toBeVisible()
  await shot(page, '12-kasir-promo-voucher-member')

  await page.getByRole('button', { name: /^Bayar •/ }).click()
  await page.getByRole('button', { name: 'Tunai', exact: true }).click()
  const cash = page.locator('div.rounded-2xl.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Pembayaran Tunai' }) })
  await cash.getByRole('button', { name: 'Uang Pas' }).click()
  await cash.getByRole('button', { name: 'Konfirmasi' }).click()
  await page.getByRole('button', { name: 'Selesaikan Pembayaran' }).click()
  await expect(page.getByRole('heading', { name: 'Pembayaran Berhasil' })).toBeVisible({ timeout: 10_000 })

  // Kentang Rp15.000 − promo 10% (1.500) − voucher 2.000 = 11.500 → 1 poin.
  const [order] = await idbAll<{ subtotal: number; discountAmount: number; grandTotal: number; pointsEarned: number; customerId: string; appliedPromos: { name: string; kolName?: string; amount: number }[] }>(page, 'orders')
  expect(order).toMatchObject({ subtotal: 15000, discountAmount: 3500, grandTotal: 11500, pointsEarned: 1 })
  expect(order.customerId).toBeTruthy()
  expect(order.appliedPromos).toEqual([
    expect.objectContaining({ name: 'Diskon Pembukaan', amount: 1500 }),
    expect.objectContaining({ name: 'Voucher Dina', amount: 2000, kolName: 'Dina Kuliner' }),
  ])

  // --- Pelanggan: saldo & tingkatan.
  await page.getByRole('link', { name: 'Pelanggan' }).click()
  await page.getByRole('button', { name: /Bu Sari/ }).click()
  await expect(page.getByText('Saldo Poin')).toBeVisible()
  await shot(page, '13-pelanggan-member')

  // --- Laporan: kinerja promo & penjualan lewat KOL (komisi 10% × 11.500 = 1.150).
  await page.getByRole('link', { name: 'Laporan', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Kinerja Promo & Voucher' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Penjualan lewat KOL' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Dina Kuliner' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Rp1.150' })).toBeVisible()
  await shot(page, '14-laporan-promo-kol', true)
})
