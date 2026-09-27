import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  // Ganti appId = Android menganggapnya aplikasi lain (data lokal hilang).
  // Sudah diganti sekali dari `cafe.kikost.pos` saat rebranding ke Kione POS;
  // jangan diubah lagi tanpa jalur ekspor-impor backup untuk pengguna.
  appId: 'com.kione.pos',
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
