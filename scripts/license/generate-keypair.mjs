#!/usr/bin/env node
// Membangkitkan pasangan kunci ECDSA P-256 baru untuk LicenseInfo (src/lib/license.ts).
//
// PENTING: skrip ini berjalan di mesin/CI VENDOR, TIDAK PERNAH di aplikasi klien.
// Setelah dibangkitkan:
//   1. Simpan `privateKey` di tempat aman DI LUAR repo ini (mis. secret manager),
//      lalu pakai sign-license.mjs untuk menerbitkan lisensi klien dengannya.
//   2. Tempel `publicKey` ke `DEFAULT_PUBLIC_KEY_JWK` di src/lib/license.ts —
//      kunci publik aman dibagikan/di-commit, itu yang dibawa aplikasi.
//
// Pasangan yang sudah ada di dev-keypair.json adalah contoh untuk pengujian —
// jangan pernah pakai untuk lisensi klien sungguhan.
//
// Pakai: node scripts/license/generate-keypair.mjs > keypair.json

const { subtle } = globalThis.crypto

const keyPair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const publicKey = await subtle.exportKey('jwk', keyPair.publicKey)
const privateKey = await subtle.exportKey('jwk', keyPair.privateKey)

process.stdout.write(JSON.stringify({ publicKey, privateKey }, null, 2) + '\n')
