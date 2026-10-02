#!/usr/bin/env node
// Menerbitkan (menandatangani) sebuah lisensi untuk LicenseInfo (src/lib/license.ts).
// Dijalankan VENDOR-SIDE saja — kunci privat tidak pernah menyentuh aplikasi klien.
//
// Pakai:
//   node scripts/license/sign-license.mjs \
//     --key scripts/license/dev-keypair.json \
//     --license-id L-0001 --business "Kopi Contoh" --plan pro \
//     --expires 2027-01-01 [--max-devices 3] \
//     > license-kopi-contoh.json
//
// `--expires` boleh kosong untuk lisensi perpetual (expiresAt: null). Hasilnya adalah
// berkas SignedLicense siap ditempel ke localStorage klien lewat `saveStoredLicense()`
// (mis. dari layar aktivasi lisensi yang dibuat nanti saat model SaaS diaktifkan).

import { readFile } from 'node:fs/promises'

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const keyPath = arg('key')
if (!keyPath) {
  console.error('Wajib: --key <path ke berkas keypair JSON>')
  process.exit(1)
}

const licenseId = arg('license-id')
const businessName = arg('business')
const plan = arg('plan', 'standard')
const expiresRaw = arg('expires')
const maxDevicesRaw = arg('max-devices')

if (!licenseId || !businessName) {
  console.error('Wajib: --license-id <id> --business "<nama usaha>"')
  process.exit(1)
}
if (!['trial', 'standard', 'pro'].includes(plan)) {
  console.error('--plan harus salah satu: trial | standard | pro')
  process.exit(1)
}

const { privateKey: privateKeyJwk } = JSON.parse(await readFile(keyPath, 'utf8'))

/**
 * HARUS identik dengan `canonicalLicenseBytes()` di src/lib/license.ts — urutan
 * field, tipe, dan encoding sama persis, atau tanda tangan yang dihasilkan di
 * sini tidak akan cocok saat diverifikasi di aplikasi.
 */
function canonicalLicenseBytes(payload) {
  const ordered = {
    licenseId: payload.licenseId,
    businessName: payload.businessName,
    plan: payload.plan,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    maxDevices: payload.maxDevices,
  }
  return new TextEncoder().encode(JSON.stringify(ordered))
}

const payload = {
  licenseId,
  businessName,
  plan,
  issuedAt: Date.now(),
  expiresAt: expiresRaw ? new Date(expiresRaw).getTime() : null,
  maxDevices: maxDevicesRaw ? Number(maxDevicesRaw) : null,
}

const { subtle } = globalThis.crypto
const key = await subtle.importKey('jwk', privateKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
const signatureBytes = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, canonicalLicenseBytes(payload))
const signature = Buffer.from(signatureBytes).toString('base64')

process.stdout.write(JSON.stringify({ payload, signature }, null, 2) + '\n')
