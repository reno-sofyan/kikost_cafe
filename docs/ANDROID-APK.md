# Build APK Android

APK dipasang langsung ke tablet (sideload), **tidak** dipublikasikan ke Google Play.

## Prasyarat (mesin build)

- JDK 17 (`brew install openjdk@17` / paket distro)
- Android SDK + Platform 34 + Build-Tools (via Android Studio atau `cmdline-tools`)
- `ANDROID_HOME` / `ANDROID_SDK_ROOT` terset
- Node 20 + `npm install` di root repo

Proyek `android/` sudah ada di repo (Capacitor 7). Plugin printer ESC/POS sudah
tertanam (lihat `android-plugins/esc-pos-printer/README.md`).

## Alur build

```bash
# 1. Build web + salin ke android
npm run build
npm run cap:sync           # = cap sync android

# 2a. Debug (untuk uji cepat di tablet dev)
npm run android:assembleDebug
#    -> android/app/build/outputs/apk/debug/app-debug.apk

# 2b. Release (untuk pemasangan produksi)
#    Perlu keystore — buat SEKALI, simpan aman (JANGAN commit):
keytool -genkey -v -keystore kikost-pos-release.jks \
  -alias kikost-pos -keyalg RSA -keysize 2048 -validity 10000

#    android/keystore.properties (di-gitignore):
cat > android/keystore.properties <<'EOF'
storeFile=/path/absolut/kikost-pos-release.jks
storePassword=***
keyAlias=kikost-pos
keyPassword=***
EOF

npm run android:assembleRelease
#    -> android/app/build/outputs/apk/release/app-release.apk
```

> Signing release: `android/app/build.gradle` membaca `android/keystore.properties`
> bila ada (blok `signingConfigs`). Bila belum dikonfigurasi, tambahkan blok berikut
> ke `android/app/build.gradle` (lihat komentar di file itu setelah `cap add`).

## Konfigurasi URL backend

Dua cara (nilai di tablet menang atas nilai build):

1. **Per tablet, tanpa build ulang (disarankan)** — buka **Pengaturan → Sinkronisasi**,
   isi URL `https://pos.kikost.com` + kunci perangkat, tekan **Uji Koneksi** lalu
   **Simpan**. Setiap tablet memakai satu kunci dari `SYNC_DEVICE_KEYS` backend.
   Bisa "Buat kunci acak" lalu daftarkan kunci itu di `SYNC_DEVICE_KEYS`.

2. **Baked-in saat build** — bila ingin APK langsung terkonfigurasi:
   ```bash
   VITE_API_BASE_URL=https://pos.kikost.com npm run build && npm run cap:sync
   ```
   (Kunci sebaiknya tetap diisi di tablet, bukan `VITE_DEVICE_SYNC_KEY`, agar tiap
   tablet punya kunci berbeda.)

## Pemasangan di tablet

1. Aktifkan "Sumber tidak dikenal" / izin instal dari file manager.
2. Transfer APK (USB / drive / link internal).
3. Pasang, buka, jalankan onboarding (lihat `GUIDE-ADMIN.md`).
4. Uji: cek indikator Online/Offline, buat transaksi uji, tutup, hapus.

## Uji yang wajib dilakukan di hardware fisik

Lihat `TEST-PLAN.md` bagian "Butuh hardware fisik": cetak Bluetooth, cetak WiFi/LAN,
barcode scanner (mode HID keyboard), orientasi landscape terkunci, performa di
1366×768, kamera untuk bukti pengeluaran.

## Ikon & splash

Ganti aset di `android/app/src/main/res/mipmap-*` dan `drawable*/splash.png`
(atau pakai `@capacitor/assets`). `appId` = `cafe.kikost.pos`, `appName` = "Kikost Cafe POS"
(`capacitor.config.ts`). Nama tampilan awal aplikasi bisa diubah di `strings.xml`.
