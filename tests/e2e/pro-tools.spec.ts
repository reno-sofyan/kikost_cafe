import { expect, test, type Page } from '@playwright/test'
import { completeOnboarding, idbAll, openShift } from './helpers'

const SHOTS = process.env.E2E_SHOTS
const shot = async (page: Page, name: string, fullPage = false) => {
  if (!SHOTS) return
  await page.waitForTimeout(350)
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage })
}

/** Memundurkan waktu "dikirim ke dapur" semua item supaya pesanan tampak sudah lama menunggu. */
async function backdateKitchenItems(page: Page, minutes: number): Promise<void> {
  await page.evaluate(
    (ms) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('kione-pos')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const tx = req.result.transaction('orderItems', 'readwrite')
          const store = tx.objectStore('orderItems')
          const all = store.getAll()
          all.onsuccess = () => {
            for (const item of all.result) if (item.kitchenPrintedAt) store.put({ ...item, kitchenPrintedAt: item.kitchenPrintedAt - ms, queuedAt: item.queuedAt - ms })
          }
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        }
      }),
    minutes * 60_000,
  )
}

test('operasional, label menu, jadwal & gaji, pesanan terjadwal, layar pelanggan, dapur terlambat, struk & ringkasan WhatsApp', async ({ page }) => {
  test.slow()
  await completeOnboarding(page, { taxPercent: '0', servicePercent: '0' })
  await openShift(page)

  // --- Pengaturan → Operasional: nomor WhatsApp pemilik.
  await page.getByRole('link', { name: 'Pengaturan' }).click()
  await page.getByRole('button', { name: 'Operasional' }).click()
  await expect(page.getByLabel('Batas penyiapan dapur')).toHaveValue('15')
  await expect(page.getByLabel('Batas lama tamu di meja')).toHaveValue('90')
  await page.getByLabel('Nomor WhatsApp pemilik').fill('0812-9999-8888')
  await page.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(page.getByText('Pengaturan operasional disimpan.')).toBeVisible()
  await shot(page, '40-pengaturan-operasional')

  // --- Produk: label menu & alergen.
  await page.getByRole('link', { name: 'Produk', exact: true }).click()
  const card = page.locator('div', { has: page.getByRole('button', { name: 'Edit', exact: true }) }).filter({ hasText: 'Kentang Goreng' }).last()
  await card.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('button', { name: 'Pedas', exact: true }).click()
  await page.getByRole('button', { name: 'Mengandung kacang' }).click()
  await shot(page, '41-label-menu')
  await page.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect
    .poll(async () => (await idbAll<{ name: string; tags?: string[] }>(page, 'products')).find((p) => p.name === 'Kentang Goreng')?.tags)
    .toEqual(['spicy', 'nuts'])

  // --- Absensi: jadwal & tarif gaji.
  await page.getByRole('link', { name: 'Absensi' }).click()
  await page.getByRole('button', { name: 'Atur Admin E2E' }).click()
  await page.getByLabel('Tarif gaji').fill('20000')
  for (const day of ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']) await page.getByLabel(`Kerja hari ${day}`).check()
  await page.getByLabel('Mulai Senin').fill('00:00')
  await page.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(page.getByText(/Jadwal & tarif Admin E2E disimpan/)).toBeVisible()
  await expect(page.getByRole('cell', { name: /Rp\s?20\.000 \/ jam/ })).toBeVisible()
  await expect(page.getByText(/Jadwal hari ini|Hari ini libur/)).toBeVisible()
  await page.getByRole('button', { name: 'Absen Admin E2E' }).click()
  await page.getByLabel('PIN absensi').fill('246810')
  await page.getByRole('button', { name: 'Absen Masuk' }).last().click()
  await expect(page.getByRole('heading', { name: /Rekap Gaji/ })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Terlambat' })).toBeVisible()
  await shot(page, '42-absensi-gaji-jadwal', true)

  // --- Pesanan terjadwal dengan uang muka tunai.
  await page.getByRole('link', { name: 'Meja', exact: true }).click()
  await page.getByRole('button', { name: 'Reservasi', exact: true }).click()
  await page.getByRole('button', { name: /^Pesanan Terjadwal/ }).click()
  await page.getByRole('button', { name: 'Pesanan Terjadwal Baru' }).click()
  await page.getByLabel('Nama pemesan terjadwal').fill('Bu Sari')
  await page.getByLabel('No. HP pemesan terjadwal').fill('081234567890')
  await page.getByLabel('Cari menu pesanan terjadwal').fill('goreng')
  await page.getByRole('button', { name: 'Tambah Kentang Goreng ke pesanan terjadwal' }).click()
  await page.getByRole('spinbutton', { name: 'Jumlah Kentang Goreng' }).fill('4')
  await page.getByRole('button', { name: 'Tambah Pisang Goreng Keju ke pesanan terjadwal' }).click()
  await page.getByLabel('Uang muka', { exact: true }).fill('20000')
  await shot(page, '43-pesanan-terjadwal-form')
  await page.getByRole('button', { name: 'Simpan Pesanan Terjadwal' }).click()
  await expect(page.getByText(/Pesanan Bu Sari untuk .* dicatat\./)).toBeVisible()
  await expect(page.getByText(/uang muka Rp\s?20\.000/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ingatkan via WA' })).toHaveAttribute('href', /wa\.me\/6281234567890/)
  await shot(page, '44-pesanan-terjadwal-daftar')
  const reservations = await idbAll<{ preOrder?: { depositCode?: string; depositAmount?: number; lines: unknown[] } }>(page, 'reservations')
  const depositCode = reservations[0].preOrder?.depositCode as string
  expect(depositCode).toMatch(/^GC-/)
  expect(reservations[0].preOrder).toMatchObject({ depositAmount: 20000 })

  // --- Hari-H: proses → pesanan terbuka di kasir berisi menunya.
  await page.getByRole('button', { name: 'Proses pesanan Bu Sari' }).click()
  await expect(page.getByRole('button', { name: /^Kurangi jumlah / })).toHaveCount(2)

  // --- Layar pelanggan (jendela kedua) mengikuti pesanan kasir.
  const display = await page.context().newPage()
  await display.goto('/layar-pelanggan')
  await expect(display.getByRole('heading', { name: 'Pesanan Anda' })).toBeVisible({ timeout: 10_000 })
  await expect(display.getByText('4× Kentang Goreng')).toBeVisible()
  if (SHOTS) await display.screenshot({ path: `${SHOTS}/45-layar-pelanggan.png` })

  // --- Dapur: pesanan yang menunggu lebih dari batas ditandai terlambat.
  await page.getByRole('button', { name: 'Kirim ke Dapur / Bar' }).click()
  await expect.poll(async () => (await idbAll<{ kitchenPrintedAt: number | null }>(page, 'orderItems')).every((i) => i.kitchenPrintedAt != null)).toBe(true)
  await backdateKitchenItems(page, 25)
  await page.getByRole('link', { name: 'Dapur' }).click()
  await expect(page.getByText(/Terlambat 2\d mnt/)).toBeVisible()
  await shot(page, '46-dapur-terlambat')
  for (const label of ['Mulai Proses', 'Tandai Siap']) {
    const buttons = page.getByRole('button', { name: label })
    await expect(buttons).toHaveCount(2)
    await buttons.first().click()
    await expect(buttons).toHaveCount(1)
    await buttons.first().click()
    await expect(buttons).toHaveCount(0)
  }
  await expect(page.getByText(/Terlambat \d+ mnt/)).toHaveCount(0)

  // --- Bayar: uang muka ditawarkan sekali ketuk, sisanya tunai.
  await page.getByRole('link', { name: 'Kasir' }).click()
  await page.getByRole('button', { name: /^Bayar •/ }).click()
  await expect(page.getByText(/Tamu sudah membayar uang muka/)).toBeVisible()
  await shot(page, '47-bayar-uang-muka')
  await page.getByRole('button', { name: /Pakai Uang Muka/ }).click()
  await page.getByRole('button', { name: 'Tunai', exact: true }).click()
  const cash = page.locator('div.rounded-2xl.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Pembayaran Tunai' }) })
  await cash.getByRole('button', { name: 'Uang Pas' }).click()
  await cash.getByRole('button', { name: 'Konfirmasi' }).click()
  await page.getByRole('button', { name: 'Selesaikan Pembayaran' }).click()
  await expect(page.getByRole('heading', { name: 'Pembayaran Berhasil' })).toBeVisible({ timeout: 10_000 })
  const payments = await idbAll<{ method: string; reference?: string; amount: number }>(page, 'payments')
  expect(payments.find((p) => p.method === 'giftcard')).toMatchObject({ reference: depositCode, amount: 20000 })
  await expect(display.getByText('Terima kasih!')).toBeVisible({ timeout: 10_000 })

  // --- Struk via WhatsApp.
  await page.getByRole('button', { name: 'Kirim Struk via WhatsApp' }).click()
  await page.getByLabel('Nomor WhatsApp tamu').fill('081234567890')
  const waReceipt = page.getByRole('link', { name: 'Buka WhatsApp' })
  await expect(waReceipt).toHaveAttribute('href', /wa\.me\/6281234567890\?text=.*Kentang/)
  await shot(page, '48-struk-whatsapp')
  await page.getByRole('button', { name: 'Tutup', exact: true }).click()
  await page.getByRole('button', { name: 'Transaksi Baru' }).click()
  await expect(display.getByText('Selamat datang')).toBeVisible({ timeout: 10_000 })
  await display.close()

  // --- Laporan: kecepatan dapur.
  await page.getByRole('link', { name: 'Laporan', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Kecepatan Dapur' })).toBeVisible()
  await expect(page.getByText('Menu paling sering terlambat')).toBeVisible()
  await page.getByRole('heading', { name: 'Kecepatan Dapur' }).scrollIntoViewIfNeeded()
  await shot(page, '49-laporan-kecepatan-dapur')

  // --- Tutup shift → ringkasan untuk pemilik siap dikirim ke WhatsApp.
  await page.getByRole('link', { name: 'Shift' }).click()
  await page.getByRole('button', { name: 'Tutup Shift', exact: true }).click()
  const dialog = page.locator('div.rounded-2xl.bg-ink-900').filter({ has: page.getByRole('heading', { name: 'Tutup Shift' }) })
  const expected = Number(((await dialog.getByText(/Kas seharusnya:/).textContent()) ?? '').replace(/\D/g, ''))
  await dialog.getByLabel('Kas Aktual (hasil hitung fisik)').fill(String(expected))
  await dialog.getByRole('button', { name: /Tutup Shift & Cetak/ }).click()
  await expect(page.getByRole('heading', { name: 'Ringkasan untuk Pemilik' })).toBeVisible()
  await expect(page.getByText('Selisih kas: Rp0 (cocok)')).toBeVisible()
  await expect(page.getByText(/Ringkasan Shift —/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Kirim ke WhatsApp' })).toHaveAttribute('href', /wa\.me\/6281299998888\?text=/)
  await shot(page, '50-ringkasan-pemilik')
})
