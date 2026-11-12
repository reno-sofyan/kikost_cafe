# Absensi Karyawan lewat HP (Kafe & Resto)

Karyawan absen masuk/pulang dari **HP-nya sendiri**. Absen manual di tablet hanya untuk
pengecualian. Absen PIN karyawan di tablet sudah **dihapus**, karena PIN gampang dititipkan
ke teman dan tidak membuktikan siapa yang benar-benar datang.

## Empat lapis bukti

HP **tidak perlu didaftarkan**. Karyawan boleh memakai HP apa saja.

| Lapis | Mencegah | Cara kerja |
|---|---|---|
| **QR dinamis di tablet** | Absen dari rumah / kirim foto QR | QR di tablet kasir berganti tiap **20 detik** (HMAC dari rahasia per usaha, ditambah penanda usaha acak). Server hanya menerima kode ±60 detik terakhir, jadi foto QR yang dikirim lewat chat cepat basi. QR tetap tampil walau tablet offline. |
| **PIN karyawan** | Absen atas nama orang lain | Karyawan memilih namanya lalu memasukkan PIN yang sama dengan PIN masuk ke aplikasi kasir. Tablet mengirim daftar karyawan aktif + **hash** PIN (PBKDF2) ke server; PIN aslinya tidak pernah dikirim. PIN salah **5 kali** mengunci nama itu **15 menit**. |
| **Selfie** | Titip PIN ke teman | Foto diambil langsung dari kamera depan (bukan galeri). Admin bisa mengaturnya **Wajib** (bawaan) atau **Opsional**. |
| **Waktu server** | Mengubah jam HP | Jam HP tidak dipakai sama sekali. |

Lokasi GPS ikut dicatat bila karyawan mengizinkan. Lokasi hanya catatan untuk Pemilik, bukan
syarat absen, karena GPS bisa dipalsukan.

## Alur

**Absen harian:** tablet → **Absensi** → **QR Absensi**. Karyawan memindai QR dengan kamera
HP, membuka tautannya, memilih namanya, memasukkan PIN, lalu menekan **Ambil Selfie & Absen
Masuk/Pulang**. Arah absen (masuk atau pulang) ditentukan otomatis dari status terakhir karyawan.

**Daftar karyawan** dikirim otomatis setiap layar Absensi di tablet dibuka (dan setiap kali
pengguna/PIN berubah selama layar itu terbuka). Karyawan baru atau PIN baru baru berlaku di HP
setelah layar Absensi dibuka saat tablet online. Mengganti PIN juga membuka kunci PIN salah.

**Absen manual (pengecualian):** untuk HP yang mati atau tidak ada internet. Pilih karyawan,
tulis alasan, lalu Admin/Pemilik memasukkan **PIN-nya sendiri**. Penyetuju tidak boleh
menyetujui absennya sendiri, kecuali Pemilik. Di rekap dan CSV absen ini ditandai
**Manual**, dan di konsol Pemilik lengkap dengan alasan dan nama penyetuju.

Absen dari HP masuk ke tablet lewat sinkronisasi biasa, sebagai entri Log Aktivitas
`attendance.in/out` dengan rantai hash milik server (`deviceId = server:absen-hp`). Karena
itu rekap jam kerja, jadwal, dan gaji tetap memakai logika yang sudah ada.

## Konsol Pemilik

`/owner/kafe` → tab **Absensi** menampilkan:
- daftar absen (HP / Manual), jenis HP, selfie, dan tautan lokasi;
- jumlah absen manual, jumlah karyawan yang absen, dan absen tanpa selfie.

## Syarat & batasan

- HP karyawan harus **online** saat absen. Tablet boleh offline, asalkan pernah online sekali
  untuk mengambil rahasia QR.
- Tablet harus terhubung ke server sinkronisasi (Pengaturan → Sinkronisasi). Alamat publik
  halaman `/absen` diambil dari URL server sinkronisasi atau URL QR meja.
- Karena tanpa ikatan HP, siapa pun yang tahu PIN seorang karyawan **dan** berada di depan
  tablet bisa absen atas namanya. Selfie wajib adalah penangkalnya — Pemilik sebaiknya
  sesekali memeriksa selfie di konsol.
- Halaman `/absen` butuh HTTPS. Kamera dan kunci kriptografi tidak tersedia di HTTP biasa.

## Deploy

1. Jalankan migrasi backend `009_staff_phone_attendance` dan `012_attendance_without_phone_enrollment`
   (otomatis saat API menyala, atau `npm run migrate` di `backend/`). QR lama dari tablet yang belum
   diperbarui tidak dikenali lagi; tablet cukup membuka QR Absensi sekali saat online.
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
