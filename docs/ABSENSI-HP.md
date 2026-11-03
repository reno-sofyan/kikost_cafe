# Absensi Karyawan lewat HP (Kafe & Resto)

Karyawan absen masuk/pulang dari **HP-nya sendiri**. Absen manual di tablet hanya untuk
pengecualian. Absen PIN karyawan di tablet sudah **dihapus**, karena PIN gampang dititipkan
ke teman dan tidak membuktikan siapa yang benar-benar datang.

## Empat lapis bukti

| Lapis | Mencegah | Cara kerja |
|---|---|---|
| **HP terdaftar** | Absen dari HP orang lain | Saat didaftarkan, browser HP membuat kunci ECDSA P-256 yang **tidak bisa disalin keluar**. Setiap absen ditandatangani dengan kunci itu, dan server hanya menyimpan kunci publiknya. Satu HP aktif per karyawan. |
| **QR dinamis di tablet** | Absen dari rumah / kirim foto QR | QR di tablet kasir berganti tiap **20 detik** (HMAC dari rahasia per usaha). Server hanya menerima kode ±60 detik terakhir, jadi foto QR yang dikirim lewat chat cepat basi. QR tetap tampil walau tablet offline. |
| **Selfie** | Titip absen | Foto diambil langsung dari kamera depan (bukan galeri). Admin bisa mengaturnya **Wajib** (bawaan) atau **Opsional**. |
| **Waktu server** | Mengubah jam HP | Jam HP tidak dipakai sama sekali. |

Lokasi GPS ikut dicatat bila karyawan mengizinkan. Lokasi hanya catatan untuk Pemilik, bukan
syarat absen, karena GPS bisa dipalsukan.

## Alur

**Mendaftarkan HP (sekali, oleh Admin/Pemilik):** tablet → **Absensi** → *Absen lewat HP* →
**Daftarkan HP** pada nama karyawan. Karyawan memindai QR yang muncul dengan kamera HP-nya,
lalu mengetuk **Daftarkan HP Ini**. QR ini sekali pakai dan berlaku 15 menit. Mendaftarkan HP
baru otomatis mencabut HP lama.

**Absen harian:** tablet → **Absensi** → **QR Absensi**. Karyawan memindai QR dengan kamera
HP, membuka tautannya, lalu menekan **Ambil Selfie & Absen Masuk/Pulang**. Arah absen (masuk
atau pulang) ditentukan otomatis dari status terakhir karyawan.

**Absen manual (pengecualian):** untuk HP yang mati atau tidak ada internet. Pilih karyawan,
tulis alasan, lalu Admin/Pemilik memasukkan **PIN-nya sendiri**. Penyetuju tidak boleh
menyetujui absennya sendiri, kecuali Pemilik. Di rekap dan CSV absen ini ditandai
**Manual**, dan di konsol Pemilik lengkap dengan alasan dan nama penyetuju.

Absen dari HP masuk ke tablet lewat sinkronisasi biasa, sebagai entri Log Aktivitas
`attendance.in/out` dengan rantai hash milik server (`deviceId = server:absen-hp`). Karena
itu rekap jam kerja, jadwal, dan gaji tetap memakai logika yang sudah ada.

## Konsol Pemilik

`/owner/kafe` → tab **Absensi** menampilkan:
- daftar absen (HP / Manual), selfie, dan tautan lokasi;
- jumlah absen manual dan absen tanpa selfie;
- HP terdaftar, yang bisa **dicabut** dari jarak jauh.

## Syarat & batasan

- HP karyawan harus **online** saat absen. Tablet boleh offline, asalkan pernah online sekali
  untuk mengambil rahasia QR.
- Tablet harus terhubung ke server sinkronisasi (Pengaturan → Sinkronisasi). Alamat publik
  halaman `/absen` diambil dari URL server sinkronisasi atau URL QR meja.
- Bila data browser di HP dihapus, atau karyawan ganti browser/HP, admin perlu mendaftarkan
  ulang HP tersebut.
- Halaman `/absen` butuh HTTPS. Kamera dan kunci kriptografi tidak tersedia di HTTP biasa.

## Deploy

1. Jalankan migrasi backend `009_staff_phone_attendance` (`npm run migrate` di `backend/`).
2. Pasang image web terbaru: `deploy/nginx/web.conf` mengizinkan kamera dan lokasi **hanya**
   di `/absen`. Halaman lain tetap `camera=(), geolocation=()`.

## Kode

| Bagian | Berkas |
|---|---|
| Logika server (QR, tanda tangan, tantangan, rantai hash) | `backend/src/lib/staffAttendance.ts` |
| Rute tablet (`/api/sync/attendance/*`) & HP (`/api/absen/*`) | `backend/src/routes/staffAttendance.ts` |
| Konsol Pemilik | `backend/src/routes/owner.ts` (`/owner/kafe/api/attendance*`) |
| Halaman HP `/absen` | `src/features/absen/` |
| Tablet: QR, absen manual, pengaturan HP | `src/features/attendance/PhoneAttendance.tsx` |
| Rekap & absen manual | `src/db/repositories/attendance.ts` |
| Test | `backend/test/staff-attendance.integration.test.ts`, `src/db/repositories/proFeatures.test.ts` |
