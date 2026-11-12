import { SplashScreen } from '@capacitor/splash-screen'

/**
 * Menutup splash native Android (lihat `SplashScreen` di capacitor.config.ts). Di web
 * plugin ini tidak melakukan apa-apa. Aman dipanggil berkali-kali; kegagalannya diabaikan
 * karena splash native juga tertutup sendiri setelah `launchShowDuration`.
 */
export function hideNativeSplash(): void {
  void SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => undefined)
}
