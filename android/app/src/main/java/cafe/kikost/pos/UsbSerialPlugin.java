package cafe.kikost.pos;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.hoho.android.usbserial.driver.UsbSerialDriver;
import com.hoho.android.usbserial.driver.UsbSerialPort;
import com.hoho.android.usbserial.driver.UsbSerialProber;

import java.util.List;

/**
 * Plugin USB-serial untuk Kikost Cafe POS. Dipakai untuk bicara ke base station
 * pager restoran Retekess yang dicolok ke tablet lewat USB-OTG (langsung, atau
 * via adapter USB-to-RS232 FTDI / CP21xx / CH34x / Prolific).
 * Dipanggil dari src/native/usbSerialPlugin.ts.
 */
@CapacitorPlugin(name = "UsbSerial")
public class UsbSerialPlugin extends Plugin {

    private static final String ACTION_USB_PERMISSION = "cafe.kikost.pos.USB_PERMISSION";
    private static final int WRITE_TIMEOUT_MS = 2000;

    private UsbSerialPort port;

    @PluginMethod
    public void listDevices(PluginCall call) {
        try {
            UsbManager manager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
            JSArray devices = new JSArray();
            if (manager != null) {
                for (UsbDevice device : manager.getDeviceList().values()) {
                    JSObject o = new JSObject();
                    o.put("deviceId", device.getDeviceId());
                    o.put("vendorId", device.getVendorId());
                    o.put("productId", device.getProductId());
                    o.put("name", deviceLabel(device));
                    devices.put(o);
                }
            }
            JSObject ret = new JSObject();
            ret.put("devices", devices);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Gagal membaca perangkat USB: " + e.getMessage());
        }
    }

    @PluginMethod
    public void open(PluginCall call) {
        Integer deviceId = call.getInt("deviceId");
        int baudRate = call.getInt("baudRate", 9600);
        UsbManager manager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        if (manager == null) {
            call.reject("Perangkat ini tidak mendukung USB host");
            return;
        }
        UsbSerialDriver driver = findDriver(manager, deviceId);
        if (driver == null) {
            call.reject("Tidak ada base station serial yang dikenali. Periksa kabel USB-OTG / adapter RS232.");
            return;
        }
        if (manager.hasPermission(driver.getDevice())) {
            doOpen(call, manager, driver, baudRate);
        } else {
            requestPermissionThenOpen(call, manager, driver, baudRate);
        }
    }

    @PluginMethod
    public void writeHex(PluginCall call) {
        String hex = call.getString("hex");
        int interCharDelayMs = call.getInt("interCharDelayMs", 0);
        if (hex == null) {
            call.reject("Data kosong");
            return;
        }
        final UsbSerialPort p = this.port;
        if (p == null) {
            call.reject("Port serial belum terbuka");
            return;
        }
        final byte[] bytes;
        try {
            bytes = hexToBytes(hex);
        } catch (IllegalArgumentException e) {
            call.reject(e.getMessage());
            return;
        }
        new Thread(() -> {
            try {
                if (interCharDelayMs > 0) {
                    for (byte b : bytes) {
                        p.write(new byte[] { b }, WRITE_TIMEOUT_MS);
                        Thread.sleep(interCharDelayMs);
                    }
                } else {
                    p.write(bytes, WRITE_TIMEOUT_MS);
                }
                // Beri jeda agar buffer base station sempat memproses sebelum ditutup.
                Thread.sleep(120);
                JSObject ret = new JSObject();
                ret.put("bytesWritten", bytes.length);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Gagal menulis ke port serial: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void close(PluginCall call) {
        closeQuietly();
        call.resolve();
    }

    private UsbSerialDriver findDriver(UsbManager manager, Integer deviceId) {
        List<UsbSerialDriver> drivers = UsbSerialProber.getDefaultProber().findAllDrivers(manager);
        if (drivers.isEmpty()) return null;
        if (deviceId != null) {
            for (UsbSerialDriver d : drivers) {
                if (d.getDevice().getDeviceId() == deviceId) return d;
            }
        }
        return drivers.get(0);
    }

    private void requestPermissionThenOpen(PluginCall call, UsbManager manager, UsbSerialDriver driver, int baudRate) {
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0;
        Intent intent = new Intent(ACTION_USB_PERMISSION).setPackage(getContext().getPackageName());
        PendingIntent pi = PendingIntent.getBroadcast(getContext(), 0, intent, flags);
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent received) {
                try {
                    context.unregisterReceiver(this);
                } catch (Exception ignored) {
                }
                boolean granted = received.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
                if (!granted || !manager.hasPermission(driver.getDevice())) {
                    call.reject("Izin akses USB ditolak");
                    return;
                }
                doOpen(call, manager, driver, baudRate);
            }
        };
        ContextCompat.registerReceiver(
            getContext(),
            receiver,
            new IntentFilter(ACTION_USB_PERMISSION),
            ContextCompat.RECEIVER_NOT_EXPORTED
        );
        manager.requestPermission(driver.getDevice(), pi);
    }

    private void doOpen(PluginCall call, UsbManager manager, UsbSerialDriver driver, int baudRate) {
        new Thread(() -> {
            try {
                closeQuietly();
                UsbDeviceConnection connection = manager.openDevice(driver.getDevice());
                if (connection == null) {
                    call.reject("Gagal membuka koneksi USB");
                    return;
                }
                UsbSerialPort p = driver.getPorts().get(0);
                p.open(connection);
                p.setParameters(baudRate, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE);
                try {
                    p.setDTR(true);
                    p.setRTS(true);
                } catch (Exception ignored) {
                }
                this.port = p;
                JSObject ret = new JSObject();
                ret.put("opened", true);
                ret.put("deviceName", deviceLabel(driver.getDevice()));
                call.resolve(ret);
            } catch (Exception e) {
                closeQuietly();
                call.reject("Gagal membuka port serial: " + e.getMessage());
            }
        }).start();
    }

    private static String deviceLabel(UsbDevice device) {
        String name = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            name = device.getProductName();
        }
        if (name != null && !name.isEmpty()) return name;
        return "USB " + Integer.toHexString(device.getVendorId()) + ":" + Integer.toHexString(device.getProductId());
    }

    private static byte[] hexToBytes(String raw) {
        String hex = raw.replaceAll("[\\s:]", "");
        if (hex.isEmpty()) throw new IllegalArgumentException("Frame perintah pager kosong");
        if (hex.length() % 2 != 0) throw new IllegalArgumentException("Frame hex harus genap: " + raw);
        byte[] out = new byte[hex.length() / 2];
        for (int i = 0; i < out.length; i++) {
            int hi = Character.digit(hex.charAt(i * 2), 16);
            int lo = Character.digit(hex.charAt(i * 2 + 1), 16);
            if (hi < 0 || lo < 0) throw new IllegalArgumentException("Karakter hex tidak valid pada frame: " + raw);
            out[i] = (byte) ((hi << 4) | lo);
        }
        return out;
    }

    private void closeQuietly() {
        try {
            if (port != null) port.close();
        } catch (Exception ignored) {
        }
        port = null;
    }

    @Override
    protected void handleOnDestroy() {
        closeQuietly();
        super.handleOnDestroy();
    }
}
