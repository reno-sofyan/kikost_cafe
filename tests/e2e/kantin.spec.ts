import { expect, test, type Page } from '@playwright/test'
import { completeOnboarding, idbAll, openShift, waitForOrderItems } from './helpers'

interface OrderRow {
  id: string
  status: string
  shiftId: string | null
  notes?: string
  discountReason?: string | null
  discountByName?: string | null
  discountValue?: number
  payLater?: { name: string; note: string; shiftId: string | null } | null
}
interface ShiftRow {
  id: string
  status: string
}
interface ItemRow {
  qty: number
  productName: string
  removed?: boolean
}

// PNG 1×1 — cukup untuk "foto" bukti (dikecilkan lewat canvas sebelum disimpan).
const PHOTO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const dialogWith = (page: Page, heading: string | RegExp) =>
  page.locator('div.rounded-2xl.bg-ink-900').filter({ has: page.getByRole('heading', { name: heading }) })

/** Kantin: Pesanan Baru wajib Nama Pembeli. */
async function startKantinOrder(page: Page, buyer: string) {
  await page.getByRole('link', { name: 'Kasir' }).click()
  await page.getByRole('button', { name: 'Pesanan Baru', exact: true }).click()
  const dialog = dialogWith(page, 'Pesanan Baru')
  await expect(dialog.getByRole('button', { name: 'Mulai Pesanan' })).toBeDisabled()
  await dialog.getByPlaceholder('mis. "Budi"').fill(buyer)
  await dialog.getByRole('button', { name: 'Mulai Pesanan' }).click()
  await expect(dialog).toBeHidden()
}

async function closeShift(page: Page) {
  await page.getByRole('link', { name: 'Shift' }).click()
  await page.getByRole('button', { name: 'Tutup Shift', exact: true }).click()
  const dialog = dialogWith(page, 'Tutup Shift')
  const expected = Number(((await dialog.getByText(/Kas seharusnya:/).textContent()) ?? '').replace(/\D/g, ''))
  await dialog.getByLabel('Kas Aktual (hasil hitung fisik)').fill(String(expected))
  await dialog.getByRole('button', { name: /Tutup Shift & Cetak/ }).click()
  await expect(dialog).toBeHidden()
}

test('kantin: tagihan tertunda tak menghalangi tutup shift, dilunasi QRIS (wajib foto) di shift berikutnya', async ({ page }) => {
  test.slow()
  await completeOnboarding(page, { businessType: 'Kantin' })
  await openShift(page)
  await startKantinOrder(page, 'Budi')

  // Produk sama ditumpuk jadi satu baris (qty 2).
  await page.getByRole('button', { name: 'Minuman', exact: true }).click()
  await page.getByRole('button', { name: /Air Mineral/ }).click()
  await page.getByRole('button', { name: /Air Mineral/ }).click()
  await waitForOrderItems(page, 1)
  await expect.poll(async () => (await idbAll<ItemRow>(page, 'orderItems'))[0]?.qty).toBe(2)

  // Catat sebagai Tagihan Tertunda.
  await page.getByRole('button', { name: 'Tagihan Tertunda (Bayar Nanti)' }).click()
  const payLater = dialogWith(page, /^Tagihan Tertunda/)
  await payLater.getByPlaceholder('mis. Pak Budi (Gudang), Divisi Keuangan').fill('Pak Budi (Gudang)')
  await payLater.getByPlaceholder('mis. dibayar saat gajian, rapat divisi').fill('dibayar saat gajian')
  await payLater.getByRole('button', { name: 'Simpan Tagihan Tertunda' }).click()
  await expect(payLater).toBeHidden()

  const firstShift = (await idbAll<ShiftRow>(page, 'shifts')).find((s) => s.status === 'open')!
  await expect
    .poll(async () => (await idbAll<OrderRow>(page, 'orders'))[0]?.payLater?.name)
    .toBe('Pak Budi (Gudang)')
  expect((await idbAll<OrderRow>(page, 'orders'))[0]!.payLater!.shiftId).toBe(firstShift.id)

  // Tutup shift tetap bisa walau tagihan belum dibayar.
  await closeShift(page)
  expect((await idbAll<ShiftRow>(page, 'shifts')).filter((s) => s.status === 'open')).toHaveLength(0)

  // Shift berikutnya: lunasi dari Pesanan Terbuka → Tagihan Tertunda.
  await openShift(page)
  const secondShift = (await idbAll<ShiftRow>(page, 'shifts')).find((s) => s.status === 'open')!
  await page.getByRole('link', { name: 'Kasir' }).click()
  await page.getByRole('button', { name: 'Pesanan Terbuka', exact: true }).click()
  await page.getByRole('button', { name: 'Tagihan Tertunda (1)' }).click()
  await expect(page.getByText('Total belum dibayar')).toBeVisible()
  await page.getByRole('button', { name: /Tagihan Tertunda • Pak Budi \(Gudang\)/ }).click()

  await page.getByRole('button', { name: /^Bayar •/ }).click()
  await page.getByRole('button', { name: 'QRIS', exact: true }).click()
  await dialogWith(page, 'Pembayaran QRIS').getByRole('button', { name: 'Pembayaran Telah Diterima' }).click()

  // QRIS di kantin wajib foto bukti — tanpa foto tak bisa diselesaikan.
  const settle = page.getByRole('button', { name: 'Selesaikan Pembayaran' })
  await expect(page.getByText('*wajib')).toBeVisible()
  await expect(settle).toBeDisabled()
  await page.locator('input[type="file"][capture]').setInputFiles({ name: 'bukti.png', mimeType: 'image/png', buffer: PHOTO })
  await expect(page.getByRole('img', { name: 'Bukti pembayaran 1' })).toBeVisible()
  await expect(settle).toBeEnabled()
  await settle.click()
  await expect(page.getByRole('heading', { name: 'Pembayaran Berhasil' })).toBeVisible({ timeout: 10_000 })

  // Pelunasan masuk ke shift yang buka saat dibayar; bukti foto tersimpan.
  const [order] = await idbAll<OrderRow>(page, 'orders')
  expect(order!.status).toBe('paid')
  expect(order!.shiftId).toBe(secondShift.id)
  const proofs = await idbAll<{ orderId: string; photoDataUrl: string | null }>(page, 'paymentProofs')
  expect(proofs).toHaveLength(1)
  expect(proofs[0]!.orderId).toBe(order!.id)
  expect(proofs[0]!.photoDataUrl).toMatch(/^data:image\//)
})

test('kantin: diskon wajib alasan & tercatat; diskon besar dan pembatalan butuh kode Pemilik', async ({ page }) => {
  test.slow()
  await completeOnboarding(page, { businessType: 'Kantin' })
  await openShift(page)
  await startKantinOrder(page, 'Siti')
  await page.getByRole('button', { name: 'Gorengan & Snack', exact: true }).click()
  await page.getByRole('button', { name: /Bakwan/ }).click()
  await page.getByRole('button', { name: /Kerupuk/ }).click()
  await waitForOrderItems(page, 2)

  // Diskon di bawah batas: alasan wajib, lalu tercatat beserta nama kasir.
  await page.getByRole('button', { name: 'Diskon', exact: true }).click()
  const discount = dialogWith(page, 'Diskon Transaksi')
  await discount.getByRole('spinbutton').fill('5')
  await discount.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(discount.getByText('Alasan diskon wajib diisi')).toBeVisible()
  await discount.getByRole('button', { name: 'Karyawan', exact: true }).click()
  await discount.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(discount).toBeHidden()
  await expect.poll(async () => (await idbAll<OrderRow>(page, 'orders'))[0]?.discountReason).toBe('Karyawan')
  expect((await idbAll<OrderRow>(page, 'orders'))[0]!.discountByName).toBe('Admin E2E')

  // Di atas batas 10% → butuh kode Pemilik; belum ada akun Pemilik → diblokir, diskon lama tetap.
  await page.getByRole('button', { name: 'Diskon', exact: true }).click()
  await discount.getByRole('spinbutton').fill('50')
  await discount.getByRole('button', { name: 'Promo', exact: true }).click()
  await discount.getByRole('button', { name: 'Lanjut ke Kode Pemilik' }).click()
  const discountOwner = dialogWith(page, /^Setujui Diskon/)
  await expect(discountOwner.getByText(/Belum ada akun berperan Pemilik/)).toBeVisible()
  await discountOwner.getByRole('button', { name: 'Batal', exact: true }).click()
  expect((await idbAll<OrderRow>(page, 'orders'))[0]!.discountValue).toBe(5)

  // Tambah akun Pemilik → kantin hanya menerima kode dari Konsol Pemilik online,
  // jadi tablet tanpa server tetap tak bisa membatalkan.
  await page.getByRole('link', { name: 'Pengaturan' }).click()
  await page.getByRole('button', { name: 'Pengguna', exact: true }).click()
  await page.getByRole('button', { name: '+ Pengguna Baru' }).click()
  const userForm = dialogWith(page, 'Pengguna Baru')
  await userForm.getByLabel('Nama').fill('Pemilik E2E')
  await userForm.getByLabel('Role').selectOption({ label: 'Pemilik' })
  await userForm.getByLabel('PIN (4-8 digit)').fill('135790')
  await userForm.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(userForm).toBeHidden()

  await page.getByRole('link', { name: 'Kasir' }).click()
  await page.getByRole('button', { name: 'Pesanan Terbuka', exact: true }).click()
  await page.getByRole('button', { name: /Siti/ }).first().click()
  await page.getByRole('button', { name: 'Batalkan Pesanan', exact: true }).click()
  const reason = dialogWith(page, /^Batalkan Pesanan/)
  await reason.getByRole('button', { name: 'Pembeli tidak jadi' }).click()
  await reason.getByRole('button', { name: 'Lanjut ke Kode Pemilik' }).click()
  const owner = dialogWith(page, /^Batalkan /)
  await expect(owner.getByText(/belum terhubung ke server/)).toBeVisible()
  await owner.getByRole('button', { name: 'Batal', exact: true }).click()

  const orders = await idbAll<OrderRow>(page, 'orders')
  expect(orders).toHaveLength(1)
  expect(orders[0]!.status).toBe('open')
})
