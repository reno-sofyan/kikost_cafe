import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'cafe.kikost.pos',
  appName: 'Kikost Cafe POS',
  webDir: 'dist',
  backgroundColor: '#1c1917',
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#1c1917',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
  },
}

export default config
