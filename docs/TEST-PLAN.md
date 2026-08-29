# Rencana & Hasil Pengujian

Terakhir dijalankan: 2026-08-30 (mesin dev).

## Ringkasan otomatis

| Suite | Perintah | Hasil |
|---|---|---|
| Frontend typecheck | `npm run typecheck` | ✅ lulus |
| Frontend lint | `npm run lint` | ✅ lulus (0 warning) |
| Frontend unit/integrasi | `npm test` | ✅ **61 test / 13 file** lulus |
| Frontend e2e (Playwright) | `npm run test:e2e` | ✅ **15 test** lulus (+ pembatalan via UI, laporan omzet/laba-HPP/produk-terlaris) |
| Frontend e2e SINKRONISASI (backend nyata) | `npm run test:e2e:sync` | ✅ **1 test** lulus (konfigurasi backend via UI → transaksi online & offline → tersinkron ke Postgres **tepat satu kali**, sinkron ulang idempoten) |
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
| `docker compose config` (Coolify + traefik) | validasi | ✅ valid |

## Bug ditemukan & diperbaiki saat pengujian

1. **Layar blank saat first run** — `getSettings()` menulis di dalam transaksi
   read-only `useLiveQuery` → `ReadOnlyError`. Fix: `getSettings()` murni baca +
   `ensureDefaultSettings()` di `main.tsx`.
2. **Scope transaksi Dexie** — `recalcOrderTotals()` membaca `db.settings` di luar
   scope 7 transaksi order. Fix: tambahkan `db.settings` ke scope.
3. **ShiftScreen macet "Memuat..."** — `getOpenShift()` mengembalikan `undefined`
   saat belum ada shift, yang dianggap komponen sebagai "masih loading" → tombol
   "Buka Shift" tak pernah muncul → shift pertama tak bisa dibuka (POS tak terpakai
   setelah onboarding). Fix: `getOpenShift()` kembalikan `null`.
4. **`cafeTables.orderBy('name')` & `users.orderBy('name')` → Dexie `SchemaError`**
   — field `name` tidak ter-indeks di schema. Layar Meja, modal Pesanan Baru
   (pilih meja), dan Manajemen Pengguna jadi **blank/crash** saat dibuka. Fix:
   schema `version(2)` menambah indeks `name` pada kedua store; regresi
   `src/db/schema.test.ts` memeriksa semua `list*()` repository tidak melempar.

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

Status Playwright (`tests/e2e/`, viewport 1366×768, 15 test + 1 sync):
- ✅ smoke: buka POS bukan landing, app shell offline (SW), tak ada tombol mati
- ✅ onboarding 6 langkah → login admin otomatis → data contoh ter-seed → gate
  shift → buka shift (modal awal) → kasir menampilkan grid menu
- ✅ onboarding hanya sekali (reload tidak kembali ke wizard)
- ✅ **transaksi takeaway tunai**: pesanan → tambah item → Bayar → modal tunai
  (Uang Pas) → Selesaikan → "Pembayaran Berhasil"; verifikasi IndexedDB: order
  `paid`=1, `stockQty` 60→59, `stockMovements` sale=1 (qtyDelta −1, refOrderId cocok)
- ✅ **pembayaran kurang dari total** ditolak (tombol Selesaikan disabled, tak ada paid)
- ✅ **dine-in + BAYAR OFFLINE**: layar Meja render → quick-start dari meja →
  `context.setOffline(true)` → bayar tunai → sukses offline; order dine_in paid +
  tableId, stok −1, meja → `needs_cleaning`, ada `syncQueue` pending; reconnect +
  reload → tidak dobel
- ✅ **modifier picker**: Cappuccino + Large + Boba → `orderItems` lineTotal 35.000,
  2 modifier tersimpan (priceDelta total 10.000)
- ✅ **tutup shift ditolak** saat ada open bill (shift tetap `open`)
- ✅ **tutup shift + selisih**: kas aktual kurang Rp 5.000 → "Selisih" tampil →
  shift `closed`, `variance = -5000`
- ✅ **retur sebagian** (via Riwayat → detail → Retur → pilih item → alasan →
  PIN admin): `returns` record `restocked`, stok kembali 59→60, `orderItems.voided`,
  audit log `order.return`, order tetap `paid` (tidak dihapus)
- ✅ **SINKRONISASI ke backend nyata** (`npm run test:e2e:sync`, Postgres ephemeral):
  konfigurasi URL+kunci via Pengaturan→Sinkronisasi (Uji Koneksi hijau) → transaksi
  online tersinkron → transaksi **offline** diantrekan → setelah online, `pull` server
  berisi **2 order, nomor transaksi unik** (tidak dobel) → "Sinkronkan Sekarang" 2×
  tidak mengubah state server (idempoten)
- ✅ **pembatalan (void) via UI**: Riwayat → detail → Batalkan → alasan → PIN admin →
  order `void`, stok kembali 59→60, audit log `order.void`
- ✅ **laporan Hari Ini**: Omzet, Jumlah Transaksi = 1, **Laba Kotor > 0 & < Omzet**
  (HPP dipotong), Kentang Goreng di Produk Terlaris qty 1x, Laporan Stok render
- ⏳ **belum**: cetak struk via UI (mock driver), gabung/pisah tagihan, KDS status.

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
