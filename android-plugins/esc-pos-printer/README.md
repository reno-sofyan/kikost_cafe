# Plugin EscPosPrinter

Implementasi native plugin ESC/POS **berada langsung di modul aplikasi Android**
(tidak sebagai paket terpisah), supaya build APK sederhana:

- `android/app/src/main/java/cafe/kikost/pos/EscPosPrinterPlugin.java` — logika Bluetooth SPP + TCP/9100
- `android/app/src/main/java/cafe/kikost/pos/MainActivity.java` — `registerPlugin(EscPosPrinterPlugin.class)`
- `android/app/src/main/AndroidManifest.xml` — izin `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN`, dll
- Kontrak TypeScript: `src/native/escPosPrinterPlugin.ts`

Folder ini dipertahankan sebagai penanda; ekstrak menjadi paket npm terpisah hanya bila
plugin ini perlu dipakai ulang di proyek lain.
