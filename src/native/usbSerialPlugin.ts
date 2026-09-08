import { registerPlugin } from '@capacitor/core'

export interface UsbSerialDevice {
  deviceId: number
  vendorId: number
  productId: number
  name: string
}

export interface UsbSerialPlugin {
  /** Daftar perangkat USB yang tertancap (belum tentu semuanya serial-capable). */
  listDevices(): Promise<{ devices: UsbSerialDevice[] }>
  /**
   * Membuka port serial. Bila `deviceId` kosong, dipilih perangkat pertama yang
   * dikenali driver (FTDI/CP21xx/CH34x/Prolific/CDC-ACM). Meminta izin USB lewat
   * dialog sistem bila belum diberikan. Parameter frame tetap 8-N-1.
   */
  open(options: { deviceId?: number; baudRate: number }): Promise<{ opened: boolean; deviceName: string }>
  /** Menulis byte (hex string, mis. "AA303132 55" — spasi diabaikan) ke port yang terbuka. */
  writeHex(options: { hex: string; interCharDelayMs?: number }): Promise<{ bytesWritten: number }>
  close(): Promise<void>
}

/**
 * Plugin native Android kustom (lihat android/app/.../UsbSerialPlugin.java) untuk
 * bicara ke base station pager Retekess lewat USB-OTG. Hanya tersedia saat aplikasi
 * berjalan sebagai APK; di web/PWA plugin ini tidak terdaftar dan pemanggilannya
 * akan ditolak oleh Capacitor.
 */
export const UsbSerial = registerPlugin<UsbSerialPlugin>('UsbSerial')
