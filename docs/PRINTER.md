# Printer Struk Thermal

## Mode koneksi (Pengaturan → Printer)

| Mode | Tersedia di | Keterangan |
|---|---|---|
| `browser` | PWA & APK | Dialog cetak bawaan OS/printer sistem. Cocok untuk printer USB/driver OS. |
| `bluetooth` | APK saja | Printer thermal Bluetooth SPP. Perangkat harus sudah *paired* di setelan Android. |
| `network` | APK saja | Printer WiFi/LAN, TCP (umumnya port 9100). |
| `none` | — | Cetak dinonaktifkan; struk tetap bisa disimpan PDF & dilihat di Print Preview. |

Ukuran kertas: `58mm` (32 kolom) atau `80mm` (48 kolom). Set saat onboarding, bisa diubah.

## Isi struk

Logo & identitas kafe, nomor transaksi, tanggal/jam (WIB), nama kasir, tipe pesanan,
meja, item + modifier + catatan, subtotal, diskon, service charge, pajak, pembulatan,
total, metode bayar, jumlah bayar, kembalian, footer. Struk void diberi tanda
"** TRANSAKSI DIBATALKAN **".

## Fitur cetak

- **Print Preview** (`PrintPreviewModal`) — pratinjau sebelum cetak.
- **Test Print** — Pengaturan → Printer → "Tes Cetak" (memakai `buildSampleReceiptData`).
- **Reprint** — dari Riwayat → detail transaksi.
- **Simpan PDF** — tersedia di semua platform (`saveReceiptAsPdf`, jsPDF).
- **Auto-print saat pembayaran** & **auto-print kitchen order** — toggle di Pengaturan.
- **Kitchen order** (`printKitchenTicket`) — tiket ringkas untuk dapur.

## Arsitektur adapter

`src/features/printing/printerDrivers.ts`:

- `BrowserPrintDriver` — iframe + `window.print()`.
- `NativeEscPosDriver` — memanggil plugin `EscPosPrinter` (Bluetooth/TCP), payload = byte
  ESC/POS dari `buildEscPosReceipt()` (`escpos.ts`), dikirim base64.
- `MockPrinterDriver` — merekam struk & byte untuk automated test (dipakai di
  `printing.test.ts` dan e2e).

Native plugin: `android/app/src/main/java/cafe/kikost/pos/EscPosPrinterPlugin.java`.

## Pengujian

- **Otomatis (mock)**: `src/features/printing/printing.test.ts` — memverifikasi byte init/cut,
  lebar kolom, isi struk, perekaman mock. Sudah lulus.
- **Butuh hardware fisik** (lakukan saat APK terpasang + printer tersedia):
  1. Pair printer Bluetooth di Android → Pengaturan → Printer → pilih perangkat → Tes Cetak.
  2. Printer WiFi: isi host + port 9100 → Tes Cetak.
  3. Cetak struk transaksi nyata 58mm & 80mm; periksa perataan kolom & pemotongan kertas.
  4. Auto-print saat pembayaran; kitchen order ke printer dapur (bila terpisah).
  5. Reprint dari Riwayat.
  6. Cabut printer saat mencetak → pastikan muncul pesan error yang jelas, transaksi
     tetap tersimpan (cetak tidak memblokir penyelesaian pembayaran).

Catat hasil di `TEST-PLAN.md`.
