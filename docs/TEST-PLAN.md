# Rencana & Hasil Pengujian

Terakhir dijalankan: 2026-08-29 (mesin dev).

## Ringkasan otomatis

| Suite | Perintah | Hasil |
|---|---|---|
| Frontend typecheck | `npm run typecheck` | ✅ lulus |
| Frontend lint | `npm run lint` | ✅ lulus (0 warning) |
| Frontend unit/integrasi | `npm test` | ✅ **44 test / 9 file** lulus |
| Frontend production build | `npm run build` | ✅ lulus (PWA + SW ter-generate) |
| Backend typecheck | `cd backend && npm run typecheck` | ✅ lulus |
| Backend lint | `cd backend && npm run lint` | ✅ lulus |
| Backend + DB (migrasi + API) | `cd backend && npm run test:with-db` | ✅ **21 test / 2 file** lulus |
| Migrasi database | dijalankan dalam `test:with-db` | ✅ `001_init` up |
| Docker image web | `docker build -t cafe-pos-web .` | ✅ build |
| Docker image api | `docker build -t cafe-pos-api ./backend` | ✅ build |
| Docker Compose stack lokal | `docker-compose.local.yml up --build` | ✅ semua container healthy |
| Health check | `curl /api/health` | ✅ `{"status":"ok","db":"ok"}` |
| Sync push/pull end-to-end (container) | curl manual | ✅ accepted → pull mengembalikan data |
| Backup `pg_dump` (container) | `backup.sh` | ✅ arsip gzip valid dibuat |
| Restore ke DB uji (container) | `restore.sh` | ✅ 5 tabel, baris terjaga, validasi lulus |
| `docker compose config` (produksi + traefik) | validasi | ✅ valid |

## Cakupan test otomatis (per requirement)

| Requirement | Test |
|---|---|
| Total order: diskon → service charge → pajak → pembulatan | `src/lib/orderTotals.test.ts` |
| Diskon persen & nominal dibatasi subtotal | idem |
| Pembulatan ke kelipatan + rounding adjustment | `orderTotals` + `currency.test.ts` |
| Hash PIN aman (salt unik, bukan plaintext, verifikasi) | `src/lib/pinHash.test.ts` |
| Rate limiting login (lockout 5x, reset, kedaluwarsa) | `src/lib/loginRateLimit.test.ts` |
| Hak akses per role (kasir/supervisor/admin/dapur) | `src/lib/permissions.test.ts` |
| Zona waktu Asia/Jakarta untuk kunci laporan | `src/lib/datetime.test.ts` |
| **Stok berkurang tepat satu kali saat bayar** | `src/db/repositories/checkout.test.ts` |
| **Cegah pembayaran/klik ganda (stok tidak dobel)** | idem |
| Tolak pembayaran kurang dari total | idem |
| Split payment menutup total | idem |
| Pengurangan bahan baku via resep/BOM | idem |
| Void mengembalikan stok + audit log | idem |
| Retur sebagian mengembalikan stok item terkait | idem |
| Sinkronisasi LWW (payload lama tidak menimpa baru) | `src/sync/applyRemote.test.ts` + `backend/test/sync.integration.test.ts` |
| **Transaksi paid tidak pernah dikembalikan ke open oleh sync** | keduanya |
| **Idempotency: key sama tidak menduplikasi** | `backend/test/sync.integration.test.ts` |
| Pull inkremental berbasis cursor | idem |
| Auth kunci perangkat (tanpa/ salah kunci ditolak) | idem |
| Entitas asing ditolak tanpa merusak batch | idem |
| Resolusi konflik eksplisit (`shouldApply`) | `backend/test/entities.test.ts` |
| Struk ESC/POS (init, cut, lebar kolom, isi) + mock printer | `src/features/printing/printing.test.ts` |

## Alur E2E lengkap (manual / Playwright — lihat `tests/e2e/`)

Skenario referensi (spec §"Uji alur lengkap"):

1. Onboarding → isi identitas, pajak, SC, QRIS, buat admin + PIN.
2. Buat kasir; buat 15+ produk contoh (seed) + 1 resep.
3. Buka shift (modal awal).
4. Buat pesanan dine-in, pilih meja, tambah item + modifier.
5. **Putuskan internet** (DevTools offline / mode pesawat).
6. Selesaikan pembayaran (tunai) — transaksi tersimpan lokal.
7. Cetak struk (mock/PDF di dev; printer fisik di tablet).
8. **Sambungkan internet** → sinkronisasi otomatis.
9. Verifikasi transaksi tersinkron **satu kali** (cek `sync_push_log` / pull dari perangkat lain).
10. Verifikasi stok berkurang **satu kali**.
11. Lakukan retur sebagian → stok kembali.
12. Tutup shift → input kas aktual → cek selisih (tolak bila ada open bill).
13. Buka Laporan → cek omzet, produk terlaris, laba kotor (HPP).
14. Backup manual → restore ke DB uji.

Status: kerangka Playwright tersedia (`tests/e2e/`, `playwright.config.ts`).
`npm run test:e2e` menjalankan smoke test (app load, offline shell, health).
Skenario transaksi penuh perlu dilengkapi setelah data seed final.

## Butuh HARDWARE FISIK (belum dapat diuji di CI)

| Item | Cara uji | Referensi |
|---|---|---|
| Cetak Bluetooth SPP | Pair printer → Pengaturan → Printer → Tes Cetak → transaksi nyata 58/80mm | `PRINTER.md` |
| Cetak WiFi/LAN (port 9100) | Isi host:port → Tes Cetak | `PRINTER.md` |
| Kitchen order ke printer dapur terpisah | Auto-print kitchen order aktif | `PRINTER.md` |
| Barcode scanner (HID) | Scan SKU/barcode di layar kasir & form produk | — |
| Tablet 10–13", 1366×768, landscape terkunci | Navigasi semua layar, target sentuh ≥ 44px | — |
| Kamera (bukti pengeluaran) | Tambah pengeluaran + foto | — |
| APK release terpasang (sideload) | Instal, onboarding, login, transaksi, sinkron | `ANDROID-APK.md` |
| Ketahanan koneksi printer putus saat cetak | Cabut daya printer saat mencetak | `PRINTER.md` |

## Butuh AKSES VPS (deployment)

| Item | Referensi |
|---|---|
| `deploy/scripts/vps-inspect.sh` (read-only) | `VPS-PRECHECK.md` |
| Deploy stack `cafe-pos` + TLS `pos.kikost.com` | `DEPLOYMENT.md` |
| Backup harian aktif + uji restore di VPS | `BACKUP-RESTORE.md` |
| Rollback container & data | `ROLLBACK.md` |
