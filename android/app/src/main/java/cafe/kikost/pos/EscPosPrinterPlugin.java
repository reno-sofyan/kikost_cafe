package cafe.kikost.pos;

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

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.Set;
import java.util.UUID;

/**
 * Plugin ESC/POS untuk Kikost Cafe POS.
 * Mendukung printer thermal via Bluetooth SPP (Serial Port Profile) dan via WiFi/LAN (TCP, umumnya port 9100).
 * Dipanggil dari src/native/escPosPrinterPlugin.ts.
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
    private static final int CONNECT_TIMEOUT_MS = 8000;

    private BluetoothSocket bluetoothSocket;
    private Socket networkSocket;
    private OutputStream activeOutput;

    private boolean needsRuntimeBtPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S; // Android 12+
    }

    @PluginMethod
    public void listPairedDevices(PluginCall call) {
        if (needsRuntimeBtPermission() && getPermissionState("bluetooth") != PermissionState.GRANTED) {
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
            doConnectBluetooth(call);
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

    @PluginMethod
    public void connectBluetooth(PluginCall call) {
        if (needsRuntimeBtPermission() && getPermissionState("bluetooth") != PermissionState.GRANTED) {
            requestPermissionForAlias("bluetooth", call, "onBtPermission");
            return;
        }
        doConnectBluetooth(call);
    }

    private void doConnectBluetooth(PluginCall call) {
        String address = call.getString("address");
        if (address == null || address.isEmpty()) {
            call.reject("Alamat printer Bluetooth kosong");
            return;
        }
        closeQuietly();
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null || !adapter.isEnabled()) {
                call.reject("Bluetooth belum aktif");
                return;
            }
            adapter.cancelDiscovery();
            BluetoothDevice device = adapter.getRemoteDevice(address);
            bluetoothSocket = device.createRfcommSocketToServiceRecord(SPP_UUID);
            bluetoothSocket.connect();
            activeOutput = bluetoothSocket.getOutputStream();
            JSObject ret = new JSObject();
            ret.put("connected", true);
            call.resolve(ret);
        } catch (SecurityException e) {
            closeQuietly();
            call.reject("Izin Bluetooth tidak tersedia: " + e.getMessage());
        } catch (Exception e) {
            closeQuietly();
            call.reject("Gagal terhubung ke printer Bluetooth: " + e.getMessage());
        }
    }

    @PluginMethod
    public void connectNetwork(PluginCall call) {
        String host = call.getString("host");
        Integer port = call.getInt("port", 9100);
        if (host == null || host.isEmpty()) {
            call.reject("Host printer kosong");
            return;
        }
        closeQuietly();
        try {
            networkSocket = new Socket();
            networkSocket.connect(new InetSocketAddress(host, port != null ? port : 9100), CONNECT_TIMEOUT_MS);
            activeOutput = networkSocket.getOutputStream();
            JSObject ret = new JSObject();
            ret.put("connected", true);
            call.resolve(ret);
        } catch (Exception e) {
            closeQuietly();
            call.reject("Gagal terhubung ke printer jaringan: " + e.getMessage());
        }
    }

    @PluginMethod
    public void printBytes(PluginCall call) {
        String base64 = call.getString("base64");
        if (base64 == null) {
            call.reject("Data cetak kosong");
            return;
        }
        if (activeOutput == null) {
            call.reject("Printer belum terhubung");
            return;
        }
        try {
            byte[] payload = Base64.decode(base64, Base64.DEFAULT);
            activeOutput.write(payload);
            activeOutput.flush();
            // Beri jeda singkat agar buffer printer sempat memproses sebelum koneksi ditutup.
            Thread.sleep(120);
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Gagal mengirim data ke printer: " + e.getMessage());
        }
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        closeQuietly();
        call.resolve();
    }

    private void closeQuietly() {
        try { if (activeOutput != null) activeOutput.close(); } catch (Exception ignored) {}
        try { if (bluetoothSocket != null) bluetoothSocket.close(); } catch (Exception ignored) {}
        try { if (networkSocket != null) networkSocket.close(); } catch (Exception ignored) {}
        activeOutput = null;
        bluetoothSocket = null;
        networkSocket = null;
    }

    @Override
    protected void handleOnDestroy() {
        closeQuietly();
        super.handleOnDestroy();
    }
}
