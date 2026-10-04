package com.kione.pos;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;

import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * Plugin ESC/POS untuk Kione POS.
 * Mendukung printer thermal via Bluetooth SPP (Serial Port Profile) dan via WiFi/LAN (TCP, umumnya port 9100).
 * Dipanggil dari src/native/escPosPrinterPlugin.ts.
 *
 * Kinerja:
 * - Koneksi DIPAKAI ULANG antar cetakan, SATU PER PRINTER (struk kasir & tiket
 *   dapur bergantian tak saling memutus) — menyambung Bluetooth SPP makan 1-4
 *   detik. Tiap koneksi ditutup otomatis setelah IDLE_DISCONNECT_MS tanpa
 *   aktivitas supaya tablet lain yang berbagi printer tetap bisa menyambung.
 * - Semua I/O printer berjalan di satu thread khusus (berurutan, satu printer
 *   fisik tak bisa dua koneksi), BUKAN di thread plugin Capacitor — kalau tidak,
 *   connect() yang memblokir ikut menahan plugin lain (Preferences, Network, dst.).
 * - Koneksi basi (printer sempat mati/keluar jangkauan) disambung ulang otomatis
 *   sekali saat penulisan gagal.
 */
@CapacitorPlugin(
    name = "EscPosPrinter",
    permissions = {
        @Permission(alias = "bluetooth", strings = {
            Manifest.permission.BLUETOOTH_CONNECT,
            Manifest.permission.BLUETOOTH_SCAN
        })
    }
)
public class EscPosPrinterPlugin extends Plugin {

    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final int NETWORK_CONNECT_TIMEOUT_MS = 5000;
    private static final long IDLE_DISCONNECT_MS = 45_000;

    private final ScheduledExecutorService printerThread = Executors.newSingleThreadScheduledExecutor();

    /** Koneksi terbuka per printer (kunci = Target.key()). Hanya diakses dari printerThread. */
    private final Map<String, Connection> connections = new HashMap<>();
    /** Printer terakhir yang disambung lewat API lama connect* (untuk printBytes). */
    private Target legacyTarget;

    private static final class Connection {
        BluetoothSocket bluetoothSocket;
        Socket networkSocket;
        OutputStream output;
        ScheduledFuture<?> idleDisconnect;

        boolean isAlive() {
            if (output == null) return false;
            if (bluetoothSocket != null) return bluetoothSocket.isConnected();
            return networkSocket != null && networkSocket.isConnected() && !networkSocket.isClosed();
        }

        void close() {
            if (idleDisconnect != null) idleDisconnect.cancel(false);
            try { if (output != null) output.close(); } catch (Exception ignored) {}
            try { if (bluetoothSocket != null) bluetoothSocket.close(); } catch (Exception ignored) {}
            try { if (networkSocket != null) networkSocket.close(); } catch (Exception ignored) {}
            output = null;
        }
    }

    /** Tujuan cetak: Bluetooth (address) atau jaringan (host:port). */
    private static final class Target {
        final boolean bluetooth;
        final String address;
        final String host;
        final int port;

        Target(boolean bluetooth, String address, String host, int port) {
            this.bluetooth = bluetooth;
            this.address = address;
            this.host = host;
            this.port = port;
        }

        String key() {
            return bluetooth ? "bt:" + address : "net:" + host + ":" + port;
        }
    }

    private interface PrinterTask {
        void run() throws Exception;
    }

    private boolean needsRuntimeBtPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S; // Android 12+
    }

    private boolean lacksBtPermission() {
        return needsRuntimeBtPermission() && getPermissionState("bluetooth") != PermissionState.GRANTED;
    }

    /** Jalankan di thread printer; tolak call dengan pesan yang ramah bila gagal. */
    private void onPrinterThread(PluginCall call, String failPrefix, PrinterTask task) {
        printerThread.execute(() -> {
            try {
                task.run();
            } catch (SecurityException e) {
                call.reject("Izin Bluetooth tidak tersedia: " + e.getMessage());
            } catch (Exception e) {
                call.reject(failPrefix + e.getMessage());
            }
        });
    }

    /** (Ulang) jadwalkan penutupan otomatis koneksi printer ini setelah idle. */
    private void touch(Target target, Connection conn) {
        if (conn.idleDisconnect != null) conn.idleDisconnect.cancel(false);
        conn.idleDisconnect = printerThread.schedule(() -> closeConnection(target), IDLE_DISCONNECT_MS, TimeUnit.MILLISECONDS);
    }

    // ---- Daftar perangkat ----

    @PluginMethod
    public void listPairedDevices(PluginCall call) {
        if (lacksBtPermission()) {
            requestPermissionForAlias("bluetooth", call, "onBtPermission");
            return;
        }
        deliverPairedDevices(call);
    }

    @PermissionCallback
    private void onBtPermission(PluginCall call) {
        if (getPermissionState("bluetooth") != PermissionState.GRANTED) {
            call.reject("Izin Bluetooth ditolak");
            return;
        }
        String method = call.getMethodName();
        if ("connectBluetooth".equals(method)) {
            connectBluetooth(call);
        } else if ("print".equals(method)) {
            print(call);
        } else {
            deliverPairedDevices(call);
        }
    }

    private void deliverPairedDevices(PluginCall call) {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) {
                call.reject("Perangkat tidak memiliki Bluetooth");
                return;
            }
            if (!adapter.isEnabled()) {
                call.reject("Bluetooth belum dinyalakan");
                return;
            }
            JSONArray devices = new JSONArray();
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            for (BluetoothDevice device : bonded) {
                JSObject entry = new JSObject();
                entry.put("address", device.getAddress());
                entry.put("name", device.getName() != null ? device.getName() : device.getAddress());
                devices.put(entry);
            }
            JSObject ret = new JSObject();
            ret.put("devices", devices);
            call.resolve(ret);
        } catch (SecurityException e) {
            call.reject("Izin Bluetooth tidak tersedia: " + e.getMessage());
        } catch (Exception e) {
            call.reject("Gagal membaca perangkat Bluetooth: " + e.getMessage());
        }
    }

    // ---- Cetak (satu langkah: pastikan terhubung + kirim) ----

    /**
     * Cetak dalam satu panggilan: pakai koneksi yang sudah terbuka ke printer yang
     * sama, atau sambung bila belum; bila penulisan gagal karena koneksi basi,
     * sambung ulang sekali lalu kirim lagi.
     * Opsi: type ('bluetooth' | 'network'), address, host, port, base64.
     */
    @PluginMethod
    public void print(PluginCall call) {
        Target target;
        try {
            target = targetFrom(call);
        } catch (IllegalArgumentException e) {
            call.reject(e.getMessage());
            return;
        }
        String base64 = call.getString("base64");
        if (base64 == null) {
            call.reject("Data cetak kosong");
            return;
        }
        if (target.bluetooth && lacksBtPermission()) {
            requestPermissionForAlias("bluetooth", call, "onBtPermission");
            return;
        }
        byte[] payload = Base64.decode(base64, Base64.DEFAULT);
        onPrinterThread(call, "Gagal mencetak: ", () -> {
            writeWithReconnect(target, payload);
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        });
    }

    private Target targetFrom(PluginCall call) {
        String type = call.getString("type", "bluetooth");
        if ("network".equals(type)) {
            String host = call.getString("host");
            if (host == null || host.isEmpty()) throw new IllegalArgumentException("Host printer kosong");
            Integer port = call.getInt("port", 9100);
            return new Target(false, null, host, port != null ? port : 9100);
        }
        String address = call.getString("address");
        if (address == null || address.isEmpty()) throw new IllegalArgumentException("Alamat printer Bluetooth kosong");
        return new Target(true, address, null, 0);
    }

    // ---- API lama (tetap didukung; kini juga memakai ulang koneksi) ----

    @PluginMethod
    public void connectBluetooth(PluginCall call) {
        String address = call.getString("address");
        if (address == null || address.isEmpty()) {
            call.reject("Alamat printer Bluetooth kosong");
            return;
        }
        if (lacksBtPermission()) {
            requestPermissionForAlias("bluetooth", call, "onBtPermission");
            return;
        }
        Target target = new Target(true, address, null, 0);
        onPrinterThread(call, "Gagal terhubung ke printer Bluetooth: ", () -> {
            ensureConnected(target, false);
            legacyTarget = target;
            JSObject ret = new JSObject();
            ret.put("connected", true);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void connectNetwork(PluginCall call) {
        String host = call.getString("host");
        Integer port = call.getInt("port", 9100);
        if (host == null || host.isEmpty()) {
            call.reject("Host printer kosong");
            return;
        }
        Target target = new Target(false, null, host, port != null ? port : 9100);
        onPrinterThread(call, "Gagal terhubung ke printer jaringan: ", () -> {
            ensureConnected(target, false);
            legacyTarget = target;
            JSObject ret = new JSObject();
            ret.put("connected", true);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void printBytes(PluginCall call) {
        String base64 = call.getString("base64");
        if (base64 == null) {
            call.reject("Data cetak kosong");
            return;
        }
        byte[] payload = Base64.decode(base64, Base64.DEFAULT);
        onPrinterThread(call, "Gagal mengirim data ke printer: ", () -> {
            if (legacyTarget == null) throw new IOException("Printer belum terhubung");
            writeWithReconnect(legacyTarget, payload);
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        printerThread.execute(() -> {
            closeAll();
            call.resolve();
        });
    }

    // ---- Koneksi (hanya dari printerThread) ----

    /** Kirim ke printer; bila koneksi lama ternyata basi, sambung ulang sekali lalu kirim lagi. */
    private void writeWithReconnect(Target target, byte[] payload) throws Exception {
        Connection conn = ensureConnected(target, false);
        try {
            write(conn, payload);
        } catch (IOException staleConnection) {
            conn = ensureConnected(target, true);
            write(conn, payload);
        }
        touch(target, conn);
    }

    private Connection ensureConnected(Target target, boolean forceReconnect) throws Exception {
        Connection existing = connections.get(target.key());
        if (!forceReconnect && existing != null && existing.isAlive()) {
            touch(target, existing);
            return existing;
        }
        closeConnection(target);
        Connection conn = new Connection();
        if (target.bluetooth) {
            conn.bluetoothSocket = connectBluetoothSocket(target.address);
            conn.output = conn.bluetoothSocket.getOutputStream();
        } else {
            Socket socket = new Socket();
            socket.setTcpNoDelay(true);
            socket.setKeepAlive(true);
            socket.connect(new InetSocketAddress(target.host, target.port), NETWORK_CONNECT_TIMEOUT_MS);
            conn.networkSocket = socket;
            conn.output = socket.getOutputStream();
        }
        connections.put(target.key(), conn);
        touch(target, conn);
        return conn;
    }

    /**
     * Banyak printer thermal generic/klon punya modul Bluetooth SPP yang tidak
     * merespons SDP lookup dengan benar — channel RFCOMM 1 lewat API tersembunyi
     * adalah workaround standar & paling andal untuk printer semacam itu, jadi
     * dicoba lebih dulu. Bila gagal (OEM ROM aneh / printer yang patuh standar),
     * turun ke socket SPP berbasis UUID (insecure dulu: tak memicu dialog pairing).
     */
    private BluetoothSocket connectBluetoothSocket(String address) throws Exception {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null || !adapter.isEnabled()) throw new IOException("Bluetooth belum aktif");
        adapter.cancelDiscovery(); // discovery yang berjalan sangat memperlambat connect()
        BluetoothDevice device = adapter.getRemoteDevice(address);

        Exception lastError = null;
        for (int strategy = 0; strategy < 2; strategy++) {
            BluetoothSocket socket = null;
            try {
                socket = strategy == 0 ? channelOneSocket(device) : device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
                socket.connect();
                return socket;
            } catch (SecurityException e) {
                throw e;
            } catch (Exception e) {
                lastError = e;
                try { if (socket != null) socket.close(); } catch (Exception ignored) {}
            }
        }
        throw lastError != null ? lastError : new IOException("Printer Bluetooth tidak merespons");
    }

    private BluetoothSocket channelOneSocket(BluetoothDevice device) throws Exception {
        try {
            Method method = device.getClass().getMethod("createRfcommSocket", int.class);
            return (BluetoothSocket) method.invoke(device, 1);
        } catch (NoSuchMethodException reflectionUnavailable) {
            return device.createRfcommSocketToServiceRecord(SPP_UUID);
        }
    }

    private void write(Connection conn, byte[] payload) throws IOException {
        if (conn.output == null) throw new IOException("Printer belum terhubung");
        conn.output.write(payload);
        conn.output.flush();
    }

    private void closeConnection(Target target) {
        Connection conn = connections.remove(target.key());
        if (conn != null) conn.close();
    }

    private void closeAll() {
        for (Connection conn : connections.values()) conn.close();
        connections.clear();
        legacyTarget = null;
    }

    @Override
    protected void handleOnDestroy() {
        printerThread.execute(this::closeAll);
        printerThread.shutdown();
        super.handleOnDestroy();
    }
}
