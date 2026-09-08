# Integrasi Pager Restoran (Retekess Wireless Calling System)

POS bisa membunyikan **coaster pager Retekess** otomatis saat pesanan siap.
**Nomor antrean pesanan (`queueNumber`) = nomor pager.**

## Cara kerja

```
Dapur tandai semua item "Siap"
        │  deriveKitchenPhase → order.lifecycleStatus = READY
        ▼
pagerEngine (tiap 15 dtk, di setiap perangkat)   src/features/pager/pagerEngine.ts
        │  hanya perangkat dengan pagerConfig.connectionType = 'usb-serial'
        ▼
buildPagerFrame(template, queueNumber)            src/features/pager/pagerProtocol.ts
        ▼
plugin native UsbSerial → USB-OTG → base station Retekess → coaster berbunyi
        ▼
order.pagerCalledAt di-set + di-sync  → perangkat lain tidak memanggil ulang
```

Layar Dapur menampilkan badge `📟 Pager #N • dipanggil / menunggu` pada kartu order
yang sudah READY.

## Hardware yang didukung

Hanya base station Retekess **dengan antarmuka serial / USB** (mis. TD112, TD159,
TD156, TD103, sebagian TD165 "PC call"). Model coaster keypad-only (TD157, TD163,
TD165 standar, TD174) **tidak** punya antarmuka ini — lihat "Fallback".

Sambungan ke tablet Android:

- Base station USB langsung → kabel **USB-OTG**.
- Base station RS-232 (DB9) → **adapter USB-to-RS232** berchipset FTDI / CP2102 /
  CH340 / PL2303 (yang dikenali `usb-serial-for-android`).

## Setup (Pengaturan → Pager)

1. Colok base station ke tablet. **Aktifkan pager Retekess di perangkat ini.**
2. **Pindai** → pilih perangkat USB (atau biarkan "Otomatis").
3. Isi **baud rate** + **template frame** dari dokumen protokol RS-232 model Anda
   (minta ke `support@retekess.com`). Ada beberapa preset sebagai titik awal.
4. **Tes panggil** sebuah nomor → coaster harus berbunyi.
5. **Simpan.** Biarkan "Panggil otomatis saat pesanan siap" menyala.

Aktifkan pager **hanya di satu perangkat** (yang terhubung fisik ke base station).
Perangkat lain cukup biarkan `none` — mereka tetap sinkron dan tidak akan
memanggil.

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

- `order.pagerCalledAt` ikut di-sync antar perangkat → satu panggilan per order.
- Gagal kirim (kabel lepas, port sibuk) → `pagerCalledAt` tetap null, dicoba lagi
  siklus berikutnya (backoff 30 dtk per order).
- Hanya order **hari ini** dengan `1 ≤ queueNumber ≤ maxPagerNumber` yang dipanggil.

## Fallback: coaster pager keypad-only

Butuh emulasi RF 433 MHz. Opsi termurah: **ESP32 + modul CC1101** dicolok ke
tablet sebagai USB-serial, menerima `PAGE {n}` lalu memancarkan paket RF Retekess
(protokol: proyek open-source `meoker/pagger`, `francispoisson/retekess-pager-hackrf`).
Plugin `UsbSerial` + `PagerConfig` sudah cukup — set `commandTemplateHex` ke frame
ASCII yang dimengerti firmware ESP32. Firmware ditulis terpisah.

## File terkait

| Hal | File |
|---|---|
| Tipe & default | `src/types/domain.ts` (`PagerConfig`), `src/db/repositories/settings.ts` |
| Migrasi (`pagerCalledAt`, `pagerConfig`) | `src/db/schema.ts` v12 |
| Protokol frame | `src/features/pager/pagerProtocol.ts` |
| Driver + transport seam | `src/features/pager/pagerDrivers.ts` |
| Engine background | `src/features/pager/pagerEngine.ts` (dipasang di `src/App.tsx`) |
| Panggil manual / tes | `src/features/pager/callPager.ts` |
| UI setelan | `src/features/settings/PagerSettings.tsx` |
| Plugin native | `android/app/src/main/java/cafe/kikost/pos/UsbSerialPlugin.java`, `src/native/usbSerialPlugin.ts` |
