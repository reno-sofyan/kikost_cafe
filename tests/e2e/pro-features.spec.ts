import { expect, test, type Page } from '@playwright/test'
import { completeOnboarding, idbAll, openShift } from './helpers'

const SHOTS = process.env.E2E_SHOTS
const shot = async (page: Page, name: string, fullPage = false) => {
  if (!SHOTS) return
  await page.waitForTimeout(350)
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage })
}

test('target omzet, harga online massal, absensi, voucher hadiah, daftar tunggu, urutan saji, penilaian, sapaan WhatsApp', async ({ page }) => {
  test.slow()
  await completeOnboarding(page, { taxPercent: '0', servicePercent: '0' })
  await openShift(page)

  // --- Target omzet.
  await page.getByRole('link', { name: 'Laporan', exact: true }).click()
  await page.getByRole('button', { name: 'Pasang Target' }).click()
  await page.getByLabel('Target per hari').fill('1000000')
  await page.getByRole('button', { name: 'Simpan Target' }).click()
  await expect(page.getByText('Target hari ini')).toBeVisible()

  // --- Harga online massal (+20%, dibulatkan ke Rp500).
  await page.getByRole('link', { name: 'Produk', exact: true }).click()
  await page.getByRole('button', { name: 'Harga Online Massal' }).click()
  await page.getByRole('button', { name: 'Terapkan' }).click()
  await expect(page.getByText(/Harga online \d+ produk diperbarui\./)).toBeVisible()
  const products = await idbAll<{ price: number; onlinePrice: number | null }>(page, 'products')
  expect(products.every((p) => (p.onlinePrice ?? 0) >= p.price * 1.2)).toBe(true)

  // --- Absensi dengan PIN sendiri.
  await page.getByRole('link', { name: 'Absensi' }).click()
  await page.getByRole('button', { name: 'Absen Admin E2E' }).click()
  await page.getByLabel('PIN absensi').fill('000000')
  await page.getByRole('button', { name: 'Absen Masuk' }).last().click()
  await expect(page.getByText('PIN salah.')).toBeVisible()
  await page.getByLabel('PIN absensi').fill('246810')
  await page.getByRole('button', { name: 'Absen Masuk' }).last().click()
  await expect(page.getByText(/Bekerja sejak/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Rekap Kehadiran' })).toBeVisible()
  await shot(page, '30-absensi')

  // --- Jual voucher hadiah Rp100.000.
  await page.getByRole('link', { name: 'Promo', exact: true }).click()
  await page.getByRole('button', { name: 'Voucher Hadiah' }).click()
  await page.getByRole('button', { name: '+ Jual Voucher Hadiah' }).click()
  await page.getByRole('button', { name: '100rb' }).click()
  await page.getByLabel('Penerima voucher hadiah').fill('Rina')
  await page.getByRole('button', { name: 'Jual Voucher', exact: true }).click()
  const code = (await page.getByLabel('Kode voucher hadiah baru').innerText()).trim()
  expect(code).toMatch(/^GC-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  await shot(page, '31-voucher-hadiah-terjual')
  await page.getByRole('button', { name: 'Selesai' }).click()
  await expect(page.getByRole('cell', { name: code })).toBeVisible()

  // --- Daftar tunggu meja.
  await page.getByRole('link', { name: 'Meja', exact: true }).click()
  await page.getByRole('button', { name: 'Reservasi', exact: true }).click()
  await page.getByRole('button', { name: 'Daftar Tunggu' }).last().click()
  await page.getByLabel('Nama tamu').fill('Pak Budi')
  await page.getByLabel('No. HP tamu menunggu').fill('081234567890')
  await page.getByRole('button', { name: 'Masukkan ke Daftar Tunggu' }).click()
  await expect(page.getByText('Pak Budi').first()).toBeVisible()
  await expect(page.getByText('#1')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Panggil via WA' })).toHaveAttribute('href', /wa\.me\/6281234567890/)
  await shot(page, '32-daftar-tunggu')

  // --- Kasir dine-in: urutan saji menahan hidangan utama.
  await page.getByRole('link', { name: 'Kasir' }).click()
  await page.getByRole('button', { name: 'Pesanan Baru', exact: true }).click()
  await page.getByRole('button', { name: 'Mulai Pesanan' }).click()
  await page.getByRole('button', { name: 'Snack' }).click()
  await page.getByRole('button', { name: /Kentang Goreng/ }).click()
  await page.getByRole('button', { name: /Pisang Goreng Keju Rp/ }).click()
  const courseChips = page.getByRole('button', { name: /^Urutan saji / })
  await expect(courseChips).toHaveCount(2)
  await courseChips.nth(0).click() // Pembuka
  await courseChips.nth(1).click()
  await courseChips.nth(1).click() // Utama
  await expect(page.getByText('Utama • ditahan')).toBeVisible()
  await shot(page, '33-kasir-urutan-saji')
  await page.getByRole('button', { name: 'Lepas Pembuka ke Dapur/Bar' }).click()
  await expect(page.getByText(/1 item dikirim.*1 item ditahan/)).toBeVisible()
  await page.getByRole('button', { name: 'Lepas Utama ke Dapur/Bar' }).click()
  // Dua menu lagi supaya ada 4 menu terjual → Analisis Menu tampil di laporan.
  await page.getByRole('button', { name: /Roti Bakar Coklat Keju Rp/ }).click()
  await page.getByRole('button', { name: 'Dessert', exact: true }).click()
  await page.getByRole('button', { name: /Rp\d/ }).filter({ hasNotText: /Kentang|Roti Bakar|Pisang|Bayar/ }).first().click()
  await expect(page.getByRole('button', { name: /^Kurangi jumlah / })).toHaveCount(4)

  // --- Bayar dengan voucher hadiah, lalu tamu memberi penilaian.
  await page.getByRole('button', { name: /^Bayar •/ }).click()
  await page.getByRole('button', { name: 'Voucher Hadiah', exact: true }).click()
  await page.getByLabel('Kode voucher hadiah', { exact: true }).fill(code.toLowerCase())
  await page.getByRole('button', { name: 'Cek', exact: true }).click()
  await expect(page.getByText(/Sisa nilai Rp100\.000/)).toBeVisible()
  await shot(page, '34-bayar-voucher-hadiah')
  await page.getByRole('button', { name: 'Pakai Voucher' }).click()
  await page.getByRole('button', { name: 'Selesaikan Pembayaran' }).click()
  await expect(page.getByRole('heading', { name: 'Pembayaran Berhasil' })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('radio', { name: '5 bintang' }).click()
  await page.getByLabel('Komentar tamu').fill('Pelayanan cepat')
  await page.getByRole('button', { name: 'Kirim Penilaian' }).click()
  await expect(page.getByText(/terima kasih!/)).toBeVisible()
  await shot(page, '35-penilaian-tamu')
  const payments = await idbAll<{ method: string; reference: string; customerId?: string }>(page, 'payments')
  expect(payments).toEqual([expect.objectContaining({ method: 'giftcard', reference: code })])
  expect(payments[0].customerId).toBeTruthy()

  // --- Pelanggan: draf sapaan WhatsApp.
  await page.getByRole('link', { name: 'Pelanggan' }).click()
  await expect(page.getByText(/Voucher Hadiah GC-/)).toHaveCount(0) // voucher hadiah bukan pelanggan
  await page.getByRole('button', { name: '+ Pelanggan Baru' }).click()
  await page.getByPlaceholder('Nama', { exact: true }).fill('Bu Sari')
  await page.getByPlaceholder('Telepon', { exact: true }).fill('08123456789')
  await page.getByRole('button', { name: 'Simpan', exact: true }).click()
  await page.getByRole('button', { name: 'Sapa via WhatsApp' }).click()
  await expect(page.getByLabel('Isi pesan')).toHaveValue(/Halo Bu, terima kasih/)
  await expect(page.getByRole('link', { name: 'Buka WhatsApp' })).toHaveAttribute('href', /wa\.me\/628123456789\?text=/)
  await shot(page, '36-sapa-whatsapp')
  await page.getByRole('button', { name: 'Tutup' }).click()

  // --- Laporan: target, penilaian, voucher hadiah.
  await page.getByRole('link', { name: 'Laporan', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Penilaian Tamu' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Analisis Menu' })).toBeVisible()
  await page.getByRole('heading', { name: 'Analisis Menu' }).scrollIntoViewIfNeeded()
  await shot(page, '38-analisis-menu')
  await expect(page.getByText('Voucher Hadiah Terjual')).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Target hari ini' })).toBeVisible()
  await shot(page, '37-laporan-pro', true)
})
