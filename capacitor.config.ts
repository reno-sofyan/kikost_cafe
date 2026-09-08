import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  // appId stays cafe.kikost.pos — changing it makes it a different app (data loss).
  appId: 'cafe.kikost.pos',
  appName: 'Kinara Coffee POS',
  webDir: 'dist',
  backgroundColor: '#f4ede0',
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#f4ede0',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
  },
}

export default config
