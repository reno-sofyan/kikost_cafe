# Konsol Pemilik (`/owner`)

Halaman web untuk **pemilik usaha**. Isinya sama dengan panel satu usaha di `/ops`, tapi
hanya untuk usahanya sendiri. `/ops` tetap khusus developer/operator (lihat
[OPS-CONSOLE.md](OPS-CONSOLE.md)).

Yang bisa dilakukan Pemilik dari HP:

- Lihat omzet & transaksi hari ini, grafik omzet 7 hari, jumlah pembatalan, kasir online.
- Daftar 60 transaksi terbaru, log aktivitas, dan rekap pembatalan/retur (7/30/90 hari).
- Unduh PDF transaksi / pembatalan untuk periode mana pun (maks 92 hari).
- **Buat kode pembatalan sendiri.** Kodenya sama dengan yang dibuat di `/ops`: satu kode
  aktif per usaha, sekali pakai, dan tablet perlu internet saat kode dipakai.

## Memberi akses ke Pemilik

1. Buka `/ops`, lalu pilih usahanya → **Akses Konsol Pemilik**.
2. Isi label (mis. "HP Bu Sari"), lalu klik **Buat Tautan**. Tautan
   `https://pos.kikost.com/owner#k=kio_…` **hanya tampil sekali**. Salin, lalu kirim
   langsung ke Pemilik.
3. Pemilik membuka tautan itu. Token disimpan di `localStorage` HP Pemilik dan langsung
   dihapus dari bilah alamat, jadi Pemilik tetap masuk sampai menekan **Keluar**.
   Bisa juga dengan membuka `/owner` lalu menempel tautan/kode di sana.
4. Satu usaha boleh punya beberapa tautan (HP, laptop). Masing-masing bisa **dicabut**
   di panel yang sama dan langsung ditolak (401) sejak saat itu.

Tautan setara kata sandi: siapa pun yang memegangnya bisa melihat data usaha itu.
Bila tautan bocor atau HP hilang, cabut lalu buat tautan baru.

## Keamanan

- Token berupa 32 byte acak (`kio_` + base64url). Server hanya menyimpan hash SHA-256-nya
  (tabel `owner_access_tokens`, migrasi 006).
- Token menentukan usaha. Tidak ada parameter usaha di URL `/owner/api/*`, jadi tidak
  bisa diganti untuk mengintip usaha lain. Token `OPS_TOKEN` tidak berlaku di `/owner`.
- Token ada di fragmen URL (`#k=`). Fragmen tidak pernah dikirim ke server, jadi tidak
  masuk log maupun Referer (`Referrer-Policy: no-referrer`).
- Token salah berulang → IP diblokir sementara (rem yang sama dengan kunci perangkat:
  10× gagal dalam 10 menit → blokir 15 menit, 429).
- `/owner` aktif walau `OPS_TOKEN` kosong. Tanpa token yang dibuat dari `/ops`, tidak
  ada yang bisa masuk.

## Endpoint

| Method | Path | Isi |
|---|---|---|
| GET | `/owner` | Shell HTML (tanpa data) |
| GET | `/owner/api/overview` | Nama & jenis usaha, omzet/transaksi hari ini, 7 hari, pembatalan, perangkat |
| GET | `/owner/api/detail` | Total omzet, 60 transaksi & 120 log aktivitas terbaru |
| GET | `/owner/api/cancellations?days=30` | Rekap pembatalan (sama dengan `/ops`) |
| GET | `/owner/api/export/{transactions,cancellations}.pdf?from=&to=` | PDF periode (WIB) |
| GET/POST/DELETE | `/owner/api/owner-code` | Status / buat / hapus kode pembatalan Pemilik |

Semua `/owner/api/*` memakai `Authorization: Bearer <token kio_…>`.

Kode: `backend/src/routes/owner.ts`, `backend/src/lib/ownerAccess.ts`. Laporan per usaha
dipakai bersama dengan `/ops` di `backend/src/lib/tenantReports.ts`. HTML sumbernya
`backend/src/routes/ownerDashboard.html`. Setelah mengeditnya, jalankan
`node scripts/embed-dashboards.mjs` (di `backend/`) untuk membangkitkan ulang `ownerDashboard.ts`
dan `opsDashboard.ts`.

## Deploy

Traefik harus merutekan `/owner` ke backend: label `cafe-pos-api` di
`deploy/docker-compose.yml` sudah mencakup `PathPrefix(/owner)`. Service worker POS
mengecualikan `/owner` (`navigateFallbackDenylist` di `vite.config.ts`), supaya browser yang
pernah membuka app POS tidak menyajikan `index.html` untuk `/owner`.
