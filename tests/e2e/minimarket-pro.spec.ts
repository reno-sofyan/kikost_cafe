import { expect, test, type Page } from '@playwright/test'
import { completeOnboarding, idbAll, openShift } from './helpers'

interface ProductRow {
  id: string
  name: string
  stockQty: number
  costPrice: number
  sellUnits?: { name: string; qty: number; price: number; barcode?: string | null }[]
  tierPrices?: { minQty: number; price: number }[]
}
interface PurchaseRow {
  supplierName: string
  docType?: string
  dueDate?: string | null
  payments?: { amount: number }[]
  totalCost: number
}
interface PaymentRow {
  method: string
  amount: number
}

const MIE = 'Mie Instan Goreng'
const DUS_BARCODE = '8990000000901'

const modal = (page: Page, heading: string | RegExp) => page.locator('div.rounded-3xl, div.rounded-2xl').filter({ has: page.getByRole('heading', { name: heading }) }).last()
const product = async (page: Page, name: string) => (await idbAll<ProductRow>(page, 'products')).find((p) => p.name === name)!

test('minimarket pro: satuan dus, grosir, pengali, tahan, bayar campur, pemasok-hutang-retur, label, analisis', async ({ page }) => {
  test.slow()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  await completeOnboarding(page, { businessType: 'Minimarket & Ritel', taxPercent: '0' })
  await openShift(page)

  // ---- Produk: satuan Dus + harga grosir lewat form ----
  await page.getByRole('link', { name: 'Produk' }).click()
  await page.getByPlaceholder('Cari produk atau scan barcode...').fill('Mie Instan')
  await page.getByRole('row', { name: new RegExp(MIE) }).getByRole('button', { name: 'Edit' }).click()
  const form = modal(page, 'Edit Produk')
  await form.getByRole('button', { name: '+ Tambah satuan' }).click()
  await form.getByLabel('Nama satuan').fill('Dus')
  await form.getByLabel('Isi Dus').fill('40')
  await form.getByLabel('Harga Dus').fill('120000')
  await form.getByLabel('Barcode Dus').fill(DUS_BARCODE)
  await form.getByRole('button', { name: '+ Tambah tingkat' }).click()
  await form.getByLabel('Minimal beli tingkat 1').fill('10')
  await form.getByLabel('Harga grosir tingkat 1').fill('3200')
  await form.getByRole('button', { name: 'Simpan', exact: true }).click()
  await expect(form).toBeHidden()
  const saved = await product(page, MIE)
  expect(saved.sellUnits).toMatchObject([{ name: 'Dus', qty: 40, price: 120000, barcode: DUS_BARCODE }])
  expect(saved.tierPrices).toEqual([{ minQty: 10, price: 3200 }])

  // ---- Kasir: pengali 12* → harga grosir; barcode dus ----
  await page.getByRole('link', { name: 'Kasir' }).click()
  const search = page.getByLabel('Cari produk atau scan barcode')
  await search.fill('12*8990000000239')
  await search.press('Enter')
  await expect(page.getByText('Harga grosir')).toBeVisible()
  await expect(page.getByText('Rp38.400').first()).toBeVisible()
  await search.fill(DUS_BARCODE)
  await search.press('Enter')
  await expect(page.getByText(`${MIE} · Dus (40)`)).toBeVisible()

  // ---- Tahan (F4) → pelanggan berikutnya → buka lagi (F6) ----
  await page.keyboard.press('F4')
  await expect(page.getByText('Belum ada produk yang ditambahkan')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ditahan (1)' })).toBeVisible()
  await page.getByRole('button', { name: 'Tambah Air Mineral 600ml', exact: true }).click()
  await page.keyboard.press('F6')
  const held = modal(page, 'Transaksi Ditahan')
  await held.getByRole('button', { name: 'Buka' }).click()
  await expect(page.getByText(`${MIE} · Dus (40)`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ditahan (1)' })).toBeVisible() // Air Mineral ikut ditahan

  // ---- Bayar campur: tunai 100.000 + sisa Debit ----
  await page.keyboard.press('F9')
  await page.getByRole('button', { name: 'Campur' }).click()
  await page.getByLabel('Dibayar tunai').fill('100000')
  await page.getByRole('button', { name: 'Debit', exact: true }).last().click()
  await expect(page.getByText('Rp58.400')).toBeVisible() // 158.400 − 100.000
  await page.getByRole('button', { name: 'Selesaikan pembayaran' }).click()
  await expect(page.getByRole('heading', { name: 'Pembayaran Berhasil' })).toBeVisible()
  const pays = (await idbAll<PaymentRow>(page, 'payments')).map((p) => [p.method, p.amount]).sort()
  expect(pays).toEqual([
    ['card', 58400],
    ['cash', 100000],
  ])
  expect((await product(page, MIE)).stockQty).toBe(80 - 12 - 40)

  // ---- Pemasok → pembelian tempo → hutang → bayar ----
  await page.getByRole('link', { name: 'Pembelian' }).click()
  await page.getByRole('button', { name: 'Pemasok', exact: true }).click()
  await page.getByRole('button', { name: 'Pemasok baru' }).click()
  const sup = modal(page, 'Pemasok baru')
  await sup.getByLabel('Nama').fill('PT Sumber Pangan')
  await sup.getByLabel('Tempo bayar (hari, 0 = tunai)').fill('14')
  await sup.getByRole('button', { name: 'Simpan' }).click()
  await expect(page.getByRole('cell', { name: /PT Sumber Pangan/ })).toBeVisible()

  await page.getByRole('button', { name: 'Pembelian', exact: true }).first().click()
  await page.getByRole('button', { name: 'Pembelian baru' }).click()
  const po = modal(page, 'Pembelian baru')
  await po.getByPlaceholder('Nama pemasok').fill('PT Sumber Pangan')
  await po.getByPlaceholder('Tambah produk: cari nama atau scan barcode...').fill('Mie Instan')
  await po.getByRole('button', { name: new RegExp(MIE) }).click()
  await po.getByLabel(`Jumlah ${MIE}`).fill('20')
  await po.getByLabel(`Harga beli ${MIE}`).fill('3300')
  await po.getByRole('button', { name: 'Simpan Draf' }).click()
  await page.getByRole('button', { name: 'Terima Barang', exact: true }).click()
  const rcv = modal(page, 'Terima Barang')
  await expect(rcv.getByLabel('Tempo (hari)')).toHaveValue('14')
  await rcv.getByRole('button', { name: 'Terima & Tambah Stok' }).click()
  await expect(rcv).toBeHidden()
  const after = await product(page, MIE)
  expect(after.stockQty).toBe(48)
  // HPP rata-rata: (28 × 2.700 + 20 × 3.300) / 48 = 2.950
  expect(after.costPrice).toBe(2950)

  await page.getByRole('button', { name: 'Hutang', exact: true }).click()
  await expect(page.getByText('Rp66.000').first()).toBeVisible()
  await page.getByRole('button', { name: 'Bayar', exact: true }).click()
  const pay = modal(page, 'Bayar hutang')
  await pay.getByRole('textbox').first().fill('16000')
  await pay.getByRole('button', { name: 'Simpan pembayaran' }).click()
  await expect(pay).toBeHidden()
  await expect(page.getByText('Rp50.000').first()).toBeVisible()

  // ---- Retur ke pemasok (potong hutang) ----
  await page.getByRole('button', { name: 'Retur', exact: true }).click()
  await page.getByRole('button', { name: 'Retur baru' }).click()
  const ret = modal(page, 'Retur ke pemasok')
  await ret.getByLabel('Pemasok').selectOption({ label: 'PT Sumber Pangan' })
  await ret.getByPlaceholder('Tambah produk: cari nama atau scan barcode...').fill('Mie Instan')
  await ret.getByRole('button', { name: new RegExp(MIE) }).click()
  await ret.getByLabel(`Jumlah retur ${MIE}`).fill('2')
  await ret.getByRole('button', { name: 'Simpan retur' }).click()
  await expect(ret).toBeHidden()
  expect((await product(page, MIE)).stockQty).toBe(46)
  const docs = await idbAll<PurchaseRow>(page, 'purchases')
  expect(docs.find((d) => d.docType === 'return')).toMatchObject({ supplierName: 'PT Sumber Pangan', totalCost: 5900 })
  await page.getByRole('button', { name: 'Hutang', exact: true }).click()
  await expect(page.getByText('Rp44.100').first()).toBeVisible() // 50.000 − retur 5.900

  // ---- Label harga PDF ----
  await page.getByRole('link', { name: 'Produk' }).click()
  await page.getByRole('button', { name: 'Label harga' }).click()
  const labels = modal(page, 'Cetak label harga & barcode')
  await labels.getByPlaceholder('Cari produk...').fill('Mie Instan')
  await labels.getByLabel(`Pilih ${MIE}`).check()
  await expect(labels.getByText('2 label · 1 halaman')).toBeVisible() // eceran + dus
  const download = page.waitForEvent('download')
  await labels.getByRole('button', { name: 'Simpan PDF' }).click()
  expect((await download).suggestedFilename()).toBe('label-harga.pdf')

  // ---- Laporan: analisis toko ----
  await page.getByRole('link', { name: 'Laporan' }).click()
  await expect(page.getByRole('heading', { name: 'Analisis Toko' })).toBeVisible()
  await expect(page.getByRole('cell', { name: MIE, exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: /Kontrol kasir/ }).click()
  await expect(page.getByRole('cell', { name: 'Admin E2E', exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: /Stok mati/ }).click()
  await page.getByRole('button', { name: 'PPN' }).click()
  await expect(page.getByText('PPN keluaran')).toBeVisible()

  // ---- Pengaturan: barcode timbangan ----
  await page.getByRole('link', { name: 'Pengaturan' }).click()
  await page.getByRole('button', { name: 'Barcode Timbangan' }).click()
  await expect(page.getByRole('heading', { name: 'Barcode Timbangan' })).toBeVisible()

  expect(errors).toEqual([])
})
