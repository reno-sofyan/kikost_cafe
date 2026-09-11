#!/usr/bin/env node
// Driver for the Kinara Coffee POS web app (Vite dev server + React/Dexie).
// Uses the project's own `playwright` dependency — run this from <repo root>
// so Node's module resolution finds node_modules. See SKILL.md.
//
// Usage (dev server must already be running — see SKILL.md "Build"):
//   node .claude/skills/run-kikost-cafe-pos/driver.mjs smoke
//   node .claude/skills/run-kikost-cafe-pos/driver.mjs goto /produk
//   node .claude/skills/run-kikost-cafe-pos/driver.mjs reset
//
// `smoke` and `goto` reuse a persistent browser profile (.profile/ next to
// this file, gitignored) so onboarding only has to run once — every
// subsequent invocation reopens already logged in. `reset` wipes it.

import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PROFILE_DIR = path.join(HERE, '.profile')
const SHOT_DIR = path.join(HERE, 'screenshots')
const BASE_URL = process.env.KIKOST_URL || 'http://localhost:5173'
const ADMIN_NAME = 'Demo Admin'
const ADMIN_PIN = '1234'

fs.mkdirSync(SHOT_DIR, { recursive: true })

const cmd = process.argv[2] || 'smoke'
const arg = process.argv[3]

if (cmd === 'reset') {
  fs.rmSync(PROFILE_DIR, { recursive: true, force: true })
  console.log('Profil browser dihapus — run berikutnya mulai dari onboarding lagi.')
  process.exit(0)
}

const errors = []
const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: true,
  viewport: { width: 1366, height: 768 }, // wajib landscape & >760px lebar — lihat #portrait-lock di index.css
})
const page = context.pages()[0] ?? (await context.newPage())
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message))

async function shot(name) {
  const p = path.join(SHOT_DIR, `${name}.png`)
  await page.screenshot({ path: p })
  console.log('screenshot:', p)
}

/** Bawa halaman dari kondisi APAPUN (onboarding kosong / layar PIN / sudah login) ke Kasir. */
async function ensureLoggedIn() {
  await page.goto(BASE_URL)
  await page.waitForFunction(
    () => /Selamat Datang|Masukkan PIN/.test(document.body.innerText) || !!document.querySelector('nav'),
    { timeout: 20000 },
  )

  if (await page.getByText('Selamat Datang').isVisible().catch(() => false)) {
    console.log('-> onboarding kosong, mengisi wizard 7 langkah...')
    for (const label of ['Profil Kafe', 'Pajak & Biaya', 'QRIS & Ukuran Struk', 'Konfigurasi Printer']) {
      await page.getByRole('button', { name: 'Lanjut' }).click()
      await page.waitForSelector(`text=${label}`)
    }
    await page.getByRole('button', { name: 'Lanjut' }).click()
    await page.waitForSelector('text=Akun Administrator')
    await page.getByLabel('Nama Administrator').fill(ADMIN_NAME)
    await page.getByLabel('PIN (4-8 digit)').fill(ADMIN_PIN)
    await page.getByLabel('Konfirmasi PIN').fill(ADMIN_PIN)
    await page.getByRole('button', { name: 'Selesai & Mulai' }).click()
    await page.waitForSelector('text=Buka Shift', { timeout: 20000 })
  } else if (await page.getByText('Masukkan PIN').isVisible().catch(() => false)) {
    console.log('-> layar PIN, masuk sebagai', ADMIN_NAME)
    for (const digit of ADMIN_PIN) await page.getByRole('button', { name: digit, exact: true }).click()
    await page.getByRole('button', { name: 'Masuk' }).click()
    await page.waitForSelector('nav', { timeout: 10000 })
  } else {
    console.log('-> sudah login')
  }

  // Buka shift kalau belum ada (CashierScreen tampilkan empty-state kalau belum ada shift aktif).
  if (await page.getByText('Belum Ada Shift Aktif').isVisible().catch(() => false)) {
    console.log('-> belum ada shift, membuka shift...')
    await page.getByRole('button', { name: 'Buka Shift' }).click() // navigate ke /shift
    await page.waitForFunction(() => /Buka Shift/.test(document.body.innerText))
    await page.getByRole('button', { name: 'Buka Shift' }).click() // buka OpenShiftModal
    await page.waitForSelector('text=Modal Awal')
    await page.getByRole('button', { name: 'Buka Shift' }).last().click() // submit modal
    await page.waitForFunction(() => /Shift aktif/.test(document.body.innerText), { timeout: 10000 })
    await page.getByRole('link', { name: 'Kasir', exact: true }).click()
  }
  await page.waitForSelector('input[placeholder*="Cari produk"]', { timeout: 10000 })
}

if (cmd === 'smoke') {
  await ensureLoggedIn()
  await page.waitForTimeout(300)
  await shot('cashier')
  console.log('Sampai di Kasir dengan shift aktif.')
} else if (cmd === 'goto') {
  if (!arg) { console.error('usage: driver.mjs goto <path, mis. /produk>'); process.exit(2) }
  await ensureLoggedIn()
  const navLabel = { '/produk': 'Produk', '/laporan': 'Laporan', '/dapur': 'Dapur', '/meja': 'Meja', '/pengaturan': 'Pengaturan', '/riwayat': 'Riwayat', '/stok': 'Stok', '/pengeluaran': 'Pengeluaran', '/pelanggan': 'Pelanggan', '/pesanan-qr': 'Pesanan QR', '/cetak': 'Cetak' }[arg]
  if (navLabel) await page.getByRole('link', { name: navLabel, exact: true }).click()
  else await page.goto(BASE_URL + arg)
  await page.waitForTimeout(500)
  await shot(arg.replace(/\W+/g, '_') || 'page')
} else {
  console.error('unknown command:', cmd, '— gunakan: smoke | goto <path> | reset')
  await context.close()
  process.exit(2)
}

console.log('Console/page errors:', errors.length)
if (errors.length) console.log(errors.join('\n'))

await context.close()
process.exit(errors.length ? 1 : 0)
