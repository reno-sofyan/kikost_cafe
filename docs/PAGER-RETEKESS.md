# Integrasi Pager Restoran (Retekess Wireless Calling System)

POS mendukung dua cara kerja, tergantung base station yang dipakai — pilih salah
satu di Pengaturan → Pager → **Jenis pager**:

| Mode | Untuk base station | Yang terjadi |
| --- | --- | --- |
| **USB/serial** | Punya antarmuka PC call (TD112, TD159, TD156, TD103, TD165 varian "PC call") | App mengirim perintah panggil otomatis lewat USB-OTG — coaster berbunyi sendiri |
| **Manual** | Keypad-only, **termasuk TD157** (juga TD163, TD165 standar, TD174) | App **hanya menetapkan & menampilkan** nomor coaster di Layar Dapur — staf memencet nomor itu sendiri di keypad transmitter |

**TD157 = mode Manual.** Model ini tidak punya port serial/USB sama sekali, jadi
tidak bisa dikontrol software apa pun — ini bukan keterbatasan Kione POS,
tapi keterbatasan hardware TD157 sendiri. Kedua mode berbagi logika penomoran
yang sama: **nomor coaster (`order.pagerNumber`) diambil dari kumpulan
`1..maxPagerNumber` dan _didaur ulang_** — begitu satu pesanan diambil pelanggan
(lepas dari READY), nomornya bebas dipakai pesanan berikutnya. Jadi hari sibuk
dengan lebih dari `maxPagerNumber` pesanan tetap kebagian coaster (beda dari
nomor antrean harian `queueNumber` yang terus naik).

## Cara kerja

```
Dapur tandai semua item "Siap"
        │  deriveKitchenPhase → order.lifecycleStatus = READY
        ▼
pagerEngine (tiap 15 dtk, di setiap perangkat)   src/features/pager/pagerEngine.ts
        │  hanya perangkat dengan pagerConfig.connectionType ≠ 'none'
        ▼
pickFreePagerNumber → nomor coaster bebas terkecil (1..maxPagerNumber)
        │  semua coaster dipakai? → pesanan menunggu, dicoba lagi siklus berikutnya
        ▼
   ┌────────────────────┴────────────────────┐
   │ connectionType = 'usb-serial'            │ connectionType = 'manual' (mis. TD157)
   ▼                                           ▼
buildPagerFrame → UsbSerial → USB-OTG →       order.pagerNumber + pagerCalledAt
base station → coaster berbunyi sendiri       di-set LANGSUNG — tak ada transport apa
   │                                           pun yang dicoba/bisa gagal
   ▼                                           ▼
order.pagerNumber + order.pagerCalledAt di-set + di-sync (kedua mode)
        → perangkat lain tidak memanggil/menetapkan ulang; nomor "dipegang" selama order READY
```

Layar Dapur menampilkan badge pada kartu order READY (hanya bila pager aktif):
- Mode USB/serial: `📟 Pager #N • dipanggil / menunggu`.
- Mode Manual (TD157 dst.): `📟 Panggil manual coaster #N di keypad` — instruksi
  untuk staf, warna beda (oranye) supaya jelas ini aksi manual, bukan status otomatis.
- Semua coaster sedang dipakai (kedua mode): `📟 menunggu coaster (semua dipakai)`.

## Hardware yang didukung

**Mode USB/serial** — hanya base station Retekess **dengan antarmuka serial/USB**
(mis. TD112, TD159, TD156, TD103, sebagian TD165 "PC call"). Sambungan ke tablet
Android:

- Base station USB langsung → kabel **USB-OTG**.
- Base station RS-232 (DB9) → **adapter USB-to-RS232** berchipset FTDI / CP2102 /
  CH340 / PL2303 (yang dikenali `usb-serial-for-android`).

**Mode Manual** — base station keypad-only apa pun, **termasuk TD157**, cocok
juga untuk merek lain yang cuma punya keypad (mis. iWare Q10M). **Tidak butuh
kabel/USB-OTG sama sekali** — cukup pastikan "Nomor pager maks." di Pengaturan
sama dengan jumlah coaster fisik yang dibeli (paket TD157 biasanya dijual per
10/16/20 unit, cek kemasan Anda).

## Setup (Pengaturan → Pager)

### Mode USB/serial (TD112, TD159, dst.)

1. Colok base station ke tablet. Set **Jenis pager** = "USB/serial".
2. **Pindai** → pilih perangkat USB (atau biarkan "Otomatis").
3. Isi **baud rate** + **template frame** dari dokumen protokol RS-232 model Anda
   (minta ke `support@retekess.com`). Ada beberapa preset sebagai titik awal.
4. Set **"Nomor pager maks."** = jumlah coaster fisik yang Anda punya (mis. 20).
   Nomor coaster didaur ulang dalam rentang `1..maks` ini.
5. **Tes panggil** sebuah nomor → coaster harus berbunyi.
6. **Simpan.** Biarkan "Panggil otomatis saat pesanan siap" menyala.

### Mode Manual (TD157 dan base station keypad-only lain)

1. Set **Jenis pager** = "Manual" — **tidak perlu colok kabel apa pun ke tablet.**
2. Set **"Nomor pager maks."** = jumlah coaster fisik TD157 Anda (cek kemasan —
   umumnya 10/16/20 unit).
3. Biarkan "Tetapkan & tampilkan nomor coaster otomatis" menyala.
4. **Simpan.** Tidak ada langkah "tes panggil" — tidak ada yang bisa dites, karena
   memang tidak ada sambungan digital ke TD157 sama sekali.
5. Begitu semua item sebuah pesanan ditandai "Siap" di Layar Dapur, badge oranye
   `📟 Panggil manual coaster #N di keypad` muncul di kartu order itu — staf
   tinggal pencet nomor N di keypad transmitter TD157 seperti biasa.

Kedua mode: aktifkan pager **hanya di satu perangkat** (yang jadi acuan Layar
Dapur/kasir utama). Perangkat lain cukup biarkan `none` — mereka tetap sinkron
dan tidak menetapkan nomor ganda.

### Format template frame

Karakter di luar token = **hex literal** (spasi & `:` diabaikan). Token nomor pager:

| Token | Arti | Nomor 12 → |
|---|---|---|
| `{n}` | digit ASCII, tanpa pad | `31 32` |
| `{nn}` `{nnn}` `{nnnn}` | digit ASCII, zero-pad ke panjang token | `{nnn}` → `30 31 32` |
| `{b}` | 1 byte biner (0–255) | `0C` |
| `{bb}` | 2 byte biner big-endian | `00 0C` |

Contoh: `02{nnn}03` + nomor 12 → byte `02 30 31 32 03` (STX + "012" + ETX).

## Idempotensi & retry

- `order.pagerCalledAt` + `order.pagerNumber` ikut di-sync antar perangkat → satu
  panggilan/penetapan per order, di kedua mode.
- **Mode USB/serial**: gagal kirim (kabel lepas, port sibuk) → `pagerCalledAt`
  tetap null, dicoba lagi siklus berikutnya (backoff 30 dtk per order).
- **Mode Manual**: tidak ada yang bisa "gagal kirim" — begitu nomor bebas
  ditemukan, langsung ditetapkan & ditandai dalam satu langkah (tidak ada retry,
  karena tidak ada transport yang bisa gagal).
- Kumpulan coaster penuh (semua nomor 1..`maxPagerNumber` dipegang order yang
  masih READY) → order menunggu **tanpa** backoff, langsung dapat nomor pada
  siklus berikutnya begitu ada coaster yang bebas. Berlaku di kedua mode.
- Hanya order **hari ini** yang berstatus READY yang diproses.

## Alternatif lama: emulasi RF untuk otomatisasi penuh di base station keypad-only

Mode Manual di atas adalah cara **direkomendasikan** untuk TD157 dan base station
keypad-only lain — tidak butuh hardware tambahan sama sekali. Bila suatu saat
tetap ingin coaster berbunyi **otomatis** tanpa staf memencet manual (mis. volume
pesanan sangat tinggi), opsi lama masih berlaku: **ESP32 + modul CC1101** dicolok
ke tablet sebagai USB-serial, menerima `PAGE {n}` lalu memancarkan paket RF
Retekess (protokol: proyek open-source `meoker/pagger`,
`francispoisson/retekess-pager-hackrf`). Set `connectionType: 'usb-serial'` +
`commandTemplateHex` ke frame ASCII yang dimengerti firmware ESP32 — firmware-nya
ditulis terpisah, tidak termasuk repo ini.

## File terkait

| Hal | File |
|---|---|
| Tipe & default | `src/types/domain.ts` (`PagerConfig`), `src/db/repositories/settings.ts` |
| Migrasi (`pagerCalledAt`, `pagerConfig`) | `src/db/schema.ts` v12 |
| Migrasi (`pagerNumber`) | `src/db/schema.ts` v13 |
| Protokol frame | `src/features/pager/pagerProtocol.ts` |
| Driver + transport seam | `src/features/pager/pagerDrivers.ts` |
| Engine background | `src/features/pager/pagerEngine.ts` (dipasang di `src/App.tsx`) |
| Panggil manual / tes | `src/features/pager/callPager.ts` |
| UI setelan | `src/features/settings/PagerSettings.tsx` |
| Plugin native | `android/app/src/main/java/com/kione/pos/UsbSerialPlugin.java`, `src/native/usbSerialPlugin.ts` |
