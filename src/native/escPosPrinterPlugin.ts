import { registerPlugin } from '@capacitor/core'

export interface BluetoothPrinterDevice {
  address: string
  name: string
}

export interface EscPosPrinterPlugin {
  listPairedDevices(): Promise<{ devices: BluetoothPrinterDevice[] }>
  connectBluetooth(options: { address: string }): Promise<{ connected: boolean }>
  connectNetwork(options: { host: string; port: number }): Promise<{ connected: boolean }>
  printBytes(options: { base64: string }): Promise<{ success: boolean }>
  disconnect(): Promise<void>
}

/**
 * Plugin native Android kustom (lihat android-plugins/esc-pos-printer) untuk mencetak ESC/POS
 * lewat Bluetooth SPP atau socket WiFi/LAN. Hanya tersedia saat aplikasi berjalan sebagai APK;
 * di web/PWA plugin ini tidak terdaftar dan pemanggilannya akan ditolak oleh Capacitor.
 */
export const EscPosPrinter = registerPlugin<EscPosPrinterPlugin>('EscPosPrinter')
