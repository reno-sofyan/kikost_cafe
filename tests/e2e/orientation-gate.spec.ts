import { expect, test, type Browser } from '@playwright/test'

/**
 * Gerbang "Putar perangkat ke mode lanskap" diputuskan CSS inline di index.html sejak
 * gambar pertama. JavaScript dimatikan di sini untuk meniru saat-saat sebelum aplikasi
 * termuat — dulu justru di situ gerbangnya berkedip di setiap refresh desktop.
 */
async function gateVisible(browser: Browser, opts: { width: number; height: number; touch: boolean }, path = '/pengaturan') {
  const ctx = await browser.newContext({
    viewport: { width: opts.width, height: opts.height },
    hasTouch: opts.touch,
    isMobile: opts.touch,
    javaScriptEnabled: false,
  })
  const page = await ctx.newPage()
  await page.goto(path)
  const visible = await page.locator('#portrait-lock').isVisible()
  await ctx.close()
  return visible
}

test('desktop/laptop tak pernah menampilkan gerbang orientasi, lebar berapa pun', async ({ browser }) => {
  for (const path of ['/pengaturan', '/kasir', '/laporan']) {
    expect(await gateVisible(browser, { width: 1440, height: 900, touch: false }, path)).toBe(false)
  }
  // Jendela desktop sempit/tinggi tetap bukan tablet potret.
  expect(await gateVisible(browser, { width: 700, height: 900, touch: false })).toBe(false)
})

test('tablet sentuh: potret dikunci, lanskap tidak', async ({ browser }) => {
  expect(await gateVisible(browser, { width: 800, height: 1280, touch: true })).toBe(true)
  expect(await gateVisible(browser, { width: 1280, height: 800, touch: true })).toBe(false)
})

test('halaman normal tampil setelah dimuat di desktop (tanpa gerbang)', async ({ page }) => {
  await page.goto('/pengaturan')
  await expect(page.locator('#portrait-lock')).toBeHidden()
  await expect(page.locator('#root')).toBeVisible()
})
