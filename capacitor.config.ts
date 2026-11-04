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
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#f1f5f9',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
  },
}

export default config
