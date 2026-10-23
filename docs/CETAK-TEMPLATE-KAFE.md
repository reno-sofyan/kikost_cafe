# Template Cetak Kafe — Struk Pelanggan & Tiket Dapur (KOT)

Kode: `src/features/printing/cafeTemplates.ts` (test: `cafeTemplates.test.ts`).

```ts
renderReceipt(order: PrintOrder, paperWidth: 58 | 80): PrintDoc
renderKOT(order: PrintOrder, paperWidth: 58 | 80, opts?: { reprintAt?: number }): PrintDoc

printDocToText(doc)                         // teks polos — fallback & pratinjau
printDocToEscPos(doc, { supportsQr? })      // byte ESC/POS; supportsQr:false → isi QR dicetak sebagai teks
```

Keduanya menerima `PrintOrder` yang sama. `PrintDoc` berisi baris bergaya (tebal, ukuran 2×,
blok terbalik/invert, QR, potong kertas), jadi satu template bisa keluar sebagai teks maupun ESC/POS.
58mm = 32 kolom, 80mm = 48 kolom; huruf 2× lebar dihitung dua kolom.

## Contoh keluaran (teks polos)

Di kertas: judul usaha, stasiun, nomor order, meja/antrean, qty KOT & "LUNAS" tercetak 2× lebar
dan tinggi; TOTAL & nama item KOT 2× tinggi; modifier/catatan KOT tebal; "ONLINE", "TAMBAHAN",
"BATAL", "VOID", "REFUND", "CETAK ULANG" tercetak terbalik (putih di atas hitam).

### Struk pelanggan 58mm — lunas

```
          KINARA CAFE
 Jl. Raya Dramaga No. 12, Bogor
      Telp 0812-3456-7890
   NPWP 01.234.567.8-901.000
================================
No       : TRX-00128
Tanggal  : 23/10/2026
Jam      : 14:31
Kasir    : Rina
Meja     : 5
Antrian  : 12
Channel  : Dine-in
--------------------------------
Es Kopi Susu Gula Aren (Large)
  2 x Rp 35.000        Rp 70.000
  + Extra Shot (Rp 8.000)
  + Less Sugar
  Catatan: es dipisah
Nasi Goreng Kampung
  1 x Rp 37.000        Rp 37.000
  + Telur Ceplok (Rp 5.000)
  Catatan: tidak pedas
Croffle Cokelat
  1 x Rp 25.000        Rp 25.000
Americano (Hot)
  1 x Rp 20.000        Rp 20.000
--------------------------------
Subtotal              Rp 152.000
Diskon Member 10%     -Rp 15.200
Service 5%              Rp 6.840
PB1 10%                Rp 14.364
Pembulatan                 -Rp 4
TOTAL                 Rp 158.000
--------------------------------
Tunai                 Rp 200.000
Kembalian              Rp 42.000
--------------------------------
Poin terpakai                -20
Poin didapat                 +15
Sisa poin                    137
================================
             LUNAS
  Terima kasih atas kunjungan
             Anda!
         IG @kikostipb
 [QR] https://kikost.com/ulasan
- - - - - - - - (potong) - - - -
```

### Tiket dapur (KOT) 58mm

```
================================
             DAPUR
================================
TRX-00128
MEJA 5
ANTRIAN 12
DINE-IN
Kirim 14:00 | Pesan 13:58
Kasir Rina
--------------------------------
1x Nasi Goreng Kampung
    > Telur Ceplok
    !! tidak pedas
--------------------------------
1 item dibuat
- - - - - - - - (potong) - - - -
================================
              BAR
================================
TRX-00128
MEJA 5
ANTRIAN 12
DINE-IN
Kirim 14:20 | Pesan 13:58
Kasir Rina
--------------------------------
2x Es Kopi Susu Gula Aren
    > Large
    > Extra Shot
    > Less Sugar
    !! es dipisah
--------------------------------
TAMBAHAN 14:20
1x Americano
    > Hot
--------------------------------
BATAL
1x BATAL Lemon Tea
    Alasan: tamu ganti pesanan
--------------------------------
3 item dibuat | 1 batal
- - - - - - - - (potong) - - - -
================================
            DESSERT
================================
TRX-00128
MEJA 5
ANTRIAN 12
DINE-IN
Kirim 14:00 | Pesan 13:58
Kasir Rina
--------------------------------
1x Croffle Cokelat
--------------------------------
1 item dibuat
- - - - - - - - (potong) - - - -
```

### Struk pelanggan 80mm — lunas

```
                  KINARA CAFE
         Jl. Raya Dramaga No. 12, Bogor
              Telp 0812-3456-7890
           NPWP 01.234.567.8-901.000
================================================
No       : TRX-00128
Tanggal  : 23/10/2026
Jam      : 14:31
Kasir    : Rina
Meja     : 5
Antrian  : 12
Channel  : Dine-in
------------------------------------------------
Es Kopi Susu Gula Aren (Large)
  2 x Rp 35.000                        Rp 70.000
  + Extra Shot (Rp 8.000)
  + Less Sugar
  Catatan: es dipisah
Nasi Goreng Kampung
  1 x Rp 37.000                        Rp 37.000
  + Telur Ceplok (Rp 5.000)
  Catatan: tidak pedas
Croffle Cokelat
  1 x Rp 25.000                        Rp 25.000
Americano (Hot)
  1 x Rp 20.000                        Rp 20.000
------------------------------------------------
Subtotal                              Rp 152.000
Diskon Member 10%                     -Rp 15.200
Service 5%                              Rp 6.840
PB1 10%                                Rp 14.364
Pembulatan                                 -Rp 4
TOTAL                                 Rp 158.000
------------------------------------------------
Tunai                                 Rp 200.000
Kembalian                              Rp 42.000
------------------------------------------------
Poin terpakai                                -20
Poin didapat                                 +15
Sisa poin                                    137
================================================
                     LUNAS
       Terima kasih atas kunjungan Anda!
                 IG @kikostipb
         [QR] https://kikost.com/ulasan
- - - - - - - - (potong) - - - - - - - -
```

### Tiket dapur (KOT) 80mm

```
================================================
                     DAPUR
================================================
TRX-00128
MEJA 5 / ANTRIAN 12
DINE-IN
Kirim 14:00 | Pesan 13:58
Kasir Rina
------------------------------------------------
1x Nasi Goreng Kampung
    > Telur Ceplok
    !! tidak pedas
------------------------------------------------
1 item dibuat
- - - - - - - - (potong) - - - - - - - -
================================================
                      BAR
================================================
TRX-00128
MEJA 5 / ANTRIAN 12
DINE-IN
Kirim 14:20 | Pesan 13:58
Kasir Rina
------------------------------------------------
2x Es Kopi Susu Gula Aren
    > Large
    > Extra Shot
    > Less Sugar
    !! es dipisah
------------------------------------------------
TAMBAHAN 14:20
1x Americano
    > Hot
------------------------------------------------
BATAL
1x BATAL Lemon Tea
    Alasan: tamu ganti pesanan
------------------------------------------------
3 item dibuat | 1 batal
- - - - - - - - (potong) - - - - - - - -
================================================
                    DESSERT
================================================
TRX-00128
MEJA 5 / ANTRIAN 12
DINE-IN
Kirim 14:00 | Pesan 13:58
Kasir Rina
------------------------------------------------
1x Croffle Cokelat
------------------------------------------------
1 item dibuat
- - - - - - - - (potong) - - - - - - - -
```

### Struk 58mm — BILL / PRE-BILL

```
          KINARA CAFE
 Jl. Raya Dramaga No. 12, Bogor
      Telp 0812-3456-7890
   NPWP 01.234.567.8-901.000
================================
        BILL / PRE-BILL
         Belum dibayar
--------------------------------
No       : TRX-00128
Tanggal  : 23/10/2026
Jam      : 13:58
Kasir    : Rina
Meja     : 5
Antrian  : 12
Channel  : Dine-in
--------------------------------
Es Kopi Susu Gula Aren (Large)
  2 x Rp 35.000        Rp 70.000
  + Extra Shot (Rp 8.000)
  + Less Sugar
  Catatan: es dipisah
Nasi Goreng Kampung
  1 x Rp 37.000        Rp 37.000
  + Telur Ceplok (Rp 5.000)
  Catatan: tidak pedas
Croffle Cokelat
  1 x Rp 25.000        Rp 25.000
Americano (Hot)
  1 x Rp 20.000        Rp 20.000
--------------------------------
Subtotal              Rp 152.000
Diskon Member 10%     -Rp 15.200
Service 5%              Rp 6.840
PB1 10%                Rp 14.364
Pembulatan                 -Rp 4
TOTAL                 Rp 158.000
================================
     Bukan bukti pembayaran
  Terima kasih atas kunjungan
             Anda!
         IG @kikostipb
 [QR] https://kikost.com/ulasan
- - - - - - - - (potong) - - - -
```

### Struk 58mm — VOID

```
          KINARA CAFE
 Jl. Raya Dramaga No. 12, Bogor
      Telp 0812-3456-7890
   NPWP 01.234.567.8-901.000
================================
          *** VOID ***
      Transaksi dibatalkan
Ref      : VD-20261023-0007
Waktu    : 23/10/2026 15:02
Alasan   : Salah input meja
--------------------------------
No       : TRX-00128
Tanggal  : 23/10/2026
Jam      : 14:31
Kasir    : Rina
Meja     : 5
Antrian  : 12
Channel  : Dine-in
--------------------------------
Es Kopi Susu Gula Aren (Large)
  2 x Rp 35.000        Rp 70.000
  + Extra Shot (Rp 8.000)
  + Less Sugar
  Catatan: es dipisah
Nasi Goreng Kampung
  1 x Rp 37.000        Rp 37.000
  + Telur Ceplok (Rp 5.000)
  Catatan: tidak pedas
Croffle Cokelat
  1 x Rp 25.000        Rp 25.000
Americano (Hot)
  1 x Rp 20.000        Rp 20.000
--------------------------------
Subtotal              Rp 152.000
Diskon Member 10%     -Rp 15.200
Service 5%              Rp 6.840
PB1 10%                Rp 14.364
Pembulatan                 -Rp 4
TOTAL                 Rp 158.000
--------------------------------
Tunai                 Rp 200.000
Kembalian              Rp 42.000
--------------------------------
Poin terpakai                -20
Sisa poin                    137
================================
  Terima kasih atas kunjungan
             Anda!
         IG @kikostipb
 [QR] https://kikost.com/ulasan
- - - - - - - - (potong) - - - -
```

### KOT 58mm — pesanan GoFood, cetak ulang

```
================================
              BAR
       CETAK ULANG 15:02
================================
TRX-00128
ANTRIAN 12
     ONLINE: GOFOOD #F-8812
Kirim 14:00 | Pesan 13:58
Kasir Rina
--------------------------------
2x Es Kopi Susu Gula Aren
    > Large
    > Extra Shot
    > Less Sugar
    !! es dipisah
--------------------------------
2 item dibuat
- - - - - - - - (potong) - - - -
```

## Asumsi yang perlu dikonfirmasi

1. **PB1 & service charge** — pajak dihitung dari (subtotal − diskon + service). Template hanya
   *menampilkan* nominal dari POS, tidak menghitung ulang. Label pajak bawaan "PB1".
2. **Harga satuan** — `price` = harga varian; harga modifier ditambahkan per unit, jadi
   "2 x Rp 35.000" sudah termasuk Extra Shot Rp 8.000.
3. **NPWP** dicetak apa adanya (format 15 digit `01.234.567.8-901.000`; NPWP 16 digit/NIK juga bisa).
4. **Item batal** tidak muncul di struk pelanggan dan tidak masuk subtotal; di KOT muncul di blok BATAL.
5. **Tanggal & jam di struk** = waktu bayar; pre-bill memakai waktu pesan. Semua jam dalam WIB.
6. **Poin terpakai** ditampilkan sebagai poin; nilai rupiahnya ikut di baris diskon.
7. **Void/refund** — nomor referensi dari POS (contoh `VD-…`/`RF-…`); struk void tetap menampilkan
   rincian pembayaran asli, tanpa "LUNAS".
8. **Tanda ⚠** diganti `!!` karena printer thermal (codepage PC437) tidak bisa mencetak ⚠; huruf
   beraksen diturunkan ke ASCII (`Café` → `Cafe`).
9. **KOT per stasiun** dicetak berurutan dapur → bar → dessert, dipotong per stasiun. Bila dapur, bar,
   dan dessert memakai satu printer, ketiganya keluar berurutan di printer itu.
10. **Jam kirim** di kepala KOT = jam kirim item terbaru di stasiun itu; TAMBAHAN dikelompokkan per jam kirim.
11. **QR** memakai perintah ESC/POS `GS ( k` (model 2); printer lama tanpa QR → URL dicetak sebagai teks.
12. Logo/gambar belum termasuk template ini (pipeline struk yang ada sudah mendukung logo raster).
