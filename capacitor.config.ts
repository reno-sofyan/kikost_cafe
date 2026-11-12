import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  // Ganti appId = Android menganggapnya aplikasi lain (data lokal hilang).
  // Riwayat: `cafe.kikost.pos` → `com.kione.pos` (rebranding) → `com.kione.pos.v2`
  // (4 Nov 2026: keystore rilis lama hilang; dipasang berdampingan, data dipindah
  // lewat backup + sinkronisasi). Jangan diubah lagi tanpa jalur ekspor-impor backup.
  appId: 'com.kione.pos.v2',
  appName: 'Kione POS',
  webDir: 'dist',
  backgroundColor: '#f1f5f9',
  android: {
    allowMixedContent: false,
  },
  plugins: {
    // Splash native (logo Kione netral — jenis usaha belum diketahui sebelum JS jalan).
    // Ditutup oleh aplikasi begitu splash in-app (src/app/AppBoot.tsx) tampil, supaya
    // tak ada layar kosong di antaranya. `launchShowDuration` hanya batas pengaman bila
    // JS gagal memanggil hide().
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 4000,
      launchFadeOutDuration: 200,
      backgroundColor: '#f1f5f9',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
  },
}

export default config
