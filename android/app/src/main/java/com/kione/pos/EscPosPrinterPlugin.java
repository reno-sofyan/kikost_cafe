package com.kione.pos;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
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

import androidx.core.content.ContextCompat;

import org.json.JSONArray;

import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Plugin ESC/POS untuk Kione POS.
 * Mendukung printer thermal via Bluetooth SPP (Serial Port Profile) dan via WiFi/LAN (TCP, umumnya port 9100).
 * Dipanggil dari src/native/escPosPrinterPlugin.ts.
 *
 * Kinerja:
 * - Koneksi DIPAKAI ULANG antar cetakan, SATU PER PRINTER — menyambung Bluetooth
 *   SPP makan 2-5 detik (sampai ±10 detik bila cara pertama gagal). Koneksi
 *   DIJAGA HIDUP selama aplikasi dipakai: tiap KEEPALIVE_MS dikirim satu byte NUL
 *   (diabaikan printer ESC/POS) supaya modul Bluetooth printer tak memutus link,
 *   dan koneksi yang ternyata putus disambung ulang di latar sebelum cetakan
 *   berikutnya. Baru ditutup setelah IDLE_DISCONNECT_MS tanpa cetakan sama sekali
 *   (tablet lain yang berbagi printer tetap bisa menyambung).
 * - Tiap printer punya THREAD SENDIRI (berurutan per printer, satu printer fisik
 *   tak bisa dua koneksi) — printer dapur yang mati/menyambung lama tak menahan
 *   struk di printer kasir. Bukan di thread plugin Capacitor — kalau tidak,
 *   connect() yang memblokir ikut menahan plugin lain (Preferences, Network, dst.).
 * - Koneksi basi disambung ulang otomatis sekali saat penulisan gagal. Putusnya
 *   link Bluetooth (printer dimatikan/keluar jangkauan) dideteksi lewat siaran
 *   ACL_DISCONNECTED — tanpa itu socket tetap "isConnected" dan struk berikutnya
 *   dikirim ke koneksi mati dulu sebelum disambung ulang.
 * - Anti-macet: menyambung Bluetooth dibatasi BT_CONNECT_TIMEOUT_MS per cara
 *   (connect() bawaan bisa menggantung puluhan detik), dan pemanasan (base64
 *   kosong) dilewati bila printer sedang punya pekerjaan atau ada cetakan yang
 *   menunggu — pemanasan tak boleh menumpuk di depan struk sungguhan.
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
    /** Tutup koneksi setelah selama ini tak ada cetakan/pemanasan (dulu 45 detik — terlalu
     *  pendek untuk kantin: hampir tiap struk harus menyambung ulang Bluetooth). */
    private static final long IDLE_DISCONNECT_MS = 30 * 60_000;
    private static final long KEEPALIVE_MS = 20_000;
    private static final byte[] KEEPALIVE_BYTE = new byte[] { 0x00 };
    /** Batas satu percobaan menyambung Bluetooth (normalnya 2-5 detik). Dua cara
     *  dicoba → paling lama ±2x ini; batas di sisi JS (printerDrivers.ts) harus
     *  lebih panjang dari total terburuk supaya cetakan yang telat tak diulang (dobel). */
    private static final long BT_CONNECT_TIMEOUT_MS = 8000;

    /** Penutup socket yang connect()-nya melewati batas waktu. */
    private final ScheduledExecutorService watchdog = Executors.newSingleThreadScheduledExecutor();
    /** Jumlah pekerjaan (cetak/pemanasan) yang antre atau berjalan per printer. */
    private final Map<String, AtomicInteger> busy = new ConcurrentHashMap<>();
    /** Jumlah cetakan SUNGGUHAN yang antre/berjalan per printer. */
    private final Map<String, AtomicInteger> realPrints = new ConcurrentHashMap<>();
    private BroadcastReceiver aclReceiver;

    /** Satu thread per printer (kunci = Target.key()). */
    private final Map<String, ScheduledExecutorService> threads = new ConcurrentHashMap<>();
    /** Koneksi terbuka per printer. Tiap entri hanya disentuh oleh thread printernya. */
    private final Map<String, Connection> connections = new ConcurrentHashMap<>();
    /** Printer terakhir yang disambung lewat API lama connect* (untuk printBytes). */
    private volatile Target legacyTarget;

    private static final class Connection {
        BluetoothSocket bluetoothSocket;
        Socket networkSocket;
        OutputStream output;
        ScheduledFuture<?> keepAlive;
        long lastUsedAt = System.currentTimeMillis();
        /** Kapan koneksi ini dibuat — untuk mengabaikan siaran "putus" milik link lama. */
        final long connectedAt = System.currentTimeMillis();

        boolean isAlive() {
            if (output == null) return false;
            if (bluetoothSocket != null) return bluetoothSocket.isConnected();
            return networkSocket != null && networkSocket.isConnected() && !networkSocket.isClosed();
        }

        void close() {
            if (keepAlive != null) keepAlive.cancel(false);
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

    private ScheduledExecutorService threadFor(Target target) {
        return threads.computeIfAbsent(target.key(), k -> Executors.newSingleThreadScheduledExecutor());
    }

    private static AtomicInteger counter(Map<String, AtomicInteger> map, Target target) {
        return map.computeIfAbsent(target.key(), k -> new AtomicInteger());
    }

    /** Jalankan di thread milik printer ini; tolak call dengan pesan yang ramah bila gagal. */
    private void onPrinterThread(Target target, PluginCall call, String failPrefix, PrinterTask task) {
        AtomicInteger pending = counter(busy, target);
        pending.incrementAndGet();
        threadFor(target).execute(() -> {
            try {
                task.run();
            } catch (SecurityException e) {
                call.reject("Izin Bluetooth tidak tersedia: " + e.getMessage());
            } catch (Exception e) {
                call.reject(failPrefix + e.getMessage());
            } finally {
                pending.decrementAndGet();
            }
        });
    }

    @Override
    public void load() {
        // Link Bluetooth putus → buang koneksinya SEKARANG (isConnected() tetap true
        // pada socket mati), lalu coba sambung lagi di latar sekali.
        aclReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                long receivedAt = System.currentTimeMillis();
                BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                if (device == null) return;
                Target target = new Target(true, device.getAddress(), null, 0);
                if (!connections.containsKey(target.key())) return;
                threadFor(target).execute(() -> {
                    Connection dropped = connections.get(target.key());
                    // Koneksi yang dibuat SETELAH link putus (mis. baru saja disambung
                    // ulang oleh cetakan/jaga-hidup) masih sehat — siaran ini milik link lama.
                    if (dropped == null || dropped.connectedAt >= receivedAt) return;
                    long lastUsedAt = dropped.lastUsedAt;
                    closeConnection(target);
                    if (counter(realPrints, target).get() > 0) return; // cetakan berikutnya menyambung sendiri
                    try {
                        Connection fresh = ensureConnected(target, false);
                        fresh.lastUsedAt = lastUsedAt;
                    } catch (Exception stillDown) {
                        // Printer mati — cetakan berikutnya mencoba lagi.
                    }
                });
            }
        };
        ContextCompat.registerReceiver(
            getContext(), aclReceiver, new IntentFilter(BluetoothDevice.ACTION_ACL_DISCONNECTED), ContextCompat.RECEIVER_EXPORTED);
    }

    /** Tandai printer ini baru dipakai (cetak/pemanasan) — memperpanjang masa jaga-hidup. */
    private void touch(Connection conn) {
        conn.lastUsedAt = System.currentTimeMillis();
    }

    /**
     * Tik jaga-hidup (di thread printer itu): kirim satu byte NUL. Bila gagal,
     * sambung ulang di latar supaya cetakan berikutnya tak menunggu. Setelah
     * IDLE_DISCONNECT_MS tanpa cetakan, koneksi ditutup dan tik berhenti.
     */
    private void startKeepAlive(Target target, Connection conn) {
        if (conn.keepAlive != null) conn.keepAlive.cancel(false);
        conn.keepAlive = threadFor(target).scheduleWithFixedDelay(() -> {
            Connection current = connections.get(target.key());
            if (current != conn) return;
            if (System.currentTimeMillis() - conn.lastUsedAt > IDLE_DISCONNECT_MS) {
                closeConnection(target);
                return;
            }
            try {
                write(conn, KEEPALIVE_BYTE);
            } catch (IOException dropped) {
                long lastUsedAt = conn.lastUsedAt;
                closeConnection(target);
                try {
                    Connection fresh = ensureConnected(target, false);
                    fresh.lastUsedAt = lastUsedAt; // sambung ulang latar tak memperpanjang masa jaga
                } catch (Exception stillDown) {
                    // Printer mati/di luar jangkauan — cetakan berikutnya mencoba lagi.
                }
            }
        }, KEEPALIVE_MS, KEEPALIVE_MS, TimeUnit.MILLISECONDS);
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
        JSObject ok = new JSObject();
        ok.put("success", true);
        if (payload.length == 0) {
            // Pemanasan: tak perlu antre bila printer sudah sibuk (koneksi toh sedang
            // dibuat/dipakai) — dulu pemanasan yang menumpuk saat printer tak terjangkau
            // menahan struk sungguhan belasan detik per pemanasan.
            if (counter(busy, target).get() > 0) {
                call.resolve(ok);
                return;
            }
            onPrinterThread(target, call, "Gagal menyambung printer: ", () -> {
                if (counter(realPrints, target).get() == 0) ensureConnected(target, false);
                call.resolve(ok);
            });
            return;
        }
        AtomicInteger real = counter(realPrints, target);
        real.incrementAndGet();
        onPrinterThread(target, call, "Gagal mencetak: ", () -> {
            try {
                writeWithReconnect(target, payload);
            } finally {
                real.decrementAndGet();
            }
            call.resolve(ok);
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
        onPrinterThread(target, call, "Gagal terhubung ke printer Bluetooth: ", () -> {
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
        onPrinterThread(target, call, "Gagal terhubung ke printer jaringan: ", () -> {
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
        Target target = legacyTarget;
        if (target == null) {
            call.reject("Gagal mengirim data ke printer: Printer belum terhubung");
            return;
        }
        onPrinterThread(target, call, "Gagal mengirim data ke printer: ", () -> {
            writeWithReconnect(target, payload);
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        closeAll();
        call.resolve();
    }

    // ---- Koneksi (hanya dari thread printer bersangkutan) ----

    /** Kirim ke printer; bila koneksi lama ternyata basi, sambung ulang sekali lalu kirim lagi. */
    private void writeWithReconnect(Target target, byte[] payload) throws Exception {
        Connection before = connections.get(target.key());
        Connection conn = ensureConnected(target, false);
        try {
            write(conn, payload);
        } catch (IOException staleConnection) {
            // Koneksi yang BARU saja dibuat lalu gagal = printer bermasalah, bukan
            // koneksi basi — jangan menyambung ulang lagi (menggandakan waktu tunggu).
            if (conn != before) throw staleConnection;
            conn = ensureConnected(target, true);
            write(conn, payload);
        }
        touch(conn);
    }

    private Connection ensureConnected(Target target, boolean forceReconnect) throws Exception {
        Connection existing = connections.get(target.key());
        if (!forceReconnect && existing != null && existing.isAlive()) {
            touch(existing);
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
        touch(conn);
        startKeepAlive(target, conn);
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
                final BluetoothSocket connecting = socket;
                // connect() tak punya batas waktu sendiri; menutup socket dari thread
                // lain membuatnya gagal segera dengan IOException.
                ScheduledFuture<?> timeout = watchdog.schedule(() -> {
                    try { connecting.close(); } catch (Exception ignored) {}
                }, BT_CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS);
                try {
                    socket.connect();
                } finally {
                    // cancel() gagal = penutup sudah jalan: socket mungkin sudah ditutup
                    // tepat saat connect() selesai — anggap gagal, jangan kembalikan socket mati.
                    if (!timeout.cancel(false)) {
                        try { socket.close(); } catch (Exception ignored) {}
                        throw new IOException("Printer Bluetooth tidak merespons");
                    }
                }
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

    /** Tutup semua koneksi — tiap penutupan dijalankan di thread printernya sendiri. */
    private void closeAll() {
        for (Map.Entry<String, ScheduledExecutorService> e : threads.entrySet()) {
            String key = e.getKey();
            e.getValue().execute(() -> {
                Connection conn = connections.remove(key);
                if (conn != null) conn.close();
            });
        }
        legacyTarget = null;
    }

    @Override
    protected void handleOnDestroy() {
        closeAll();
        for (ScheduledExecutorService t : threads.values()) t.shutdown();
        watchdog.shutdown();
        if (aclReceiver != null) {
            try { getContext().unregisterReceiver(aclReceiver); } catch (Exception ignored) {}
            aclReceiver = null;
        }
        super.handleOnDestroy();
    }
}
