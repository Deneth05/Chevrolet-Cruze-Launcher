package com.deneth.cruzelauncher;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/**
 * Talks to a Bluetooth (classic SPP) ELM327 OBD-II adapter.
 * The 2004 Cruze HR52S uses JOBD / ISO 9141-2 or KWP2000, so protocol auto-detect (ATSP0) is used.
 */
public class ObdManager {

    public interface Listener {
        void onObdData(JSONObject data);
        void onObdStatus(String state, String msg);
        void onDtc(List<String> codes, String msg);
    }

    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final String[] SLOW_PIDS = {"0105", "012F", "0104", "0111", "010F", "ATRV"};

    private final Context ctx;
    private final Listener listener;
    private final SharedPreferences prefs;

    private volatile BluetoothSocket socket;
    private volatile Thread worker;
    private volatile boolean running = false;
    private volatile boolean userStopped = false;
    private volatile boolean scanRequested = false;
    private volatile boolean clearRequested = false;
    private final boolean[] unsupported = new boolean[SLOW_PIDS.length];

    public ObdManager(Context ctx, Listener listener) {
        this.ctx = ctx.getApplicationContext();
        this.listener = listener;
        this.prefs = ctx.getSharedPreferences("obd", Context.MODE_PRIVATE);
    }

    private boolean hasBtPermission() {
        return Build.VERSION.SDK_INT < 31
                || ctx.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }

    @SuppressWarnings("MissingPermission")
    public String pairedDevices() {
        JSONArray arr = new JSONArray();
        try {
            BluetoothAdapter ad = BluetoothAdapter.getDefaultAdapter();
            if (ad == null || !hasBtPermission()) return "[]";
            Set<BluetoothDevice> set = ad.getBondedDevices();
            if (set != null) for (BluetoothDevice d : set) {
                JSONObject o = new JSONObject();
                o.put("name", d.getName() == null ? "Unknown" : d.getName());
                o.put("addr", d.getAddress());
                arr.put(o);
            }
        } catch (Exception ignored) { }
        return arr.toString();
    }

    /** Reconnect to the last adapter on start-up (car ignition → head unit boots). */
    public void autoConnect() {
        String a = prefs.getString("addr", "");
        if (!a.isEmpty() && !running) connect(a, false);
    }

    public synchronized void connect(final String addr, boolean remember) {
        if (remember) prefs.edit().putString("addr", addr).apply();
        disconnect(false);
        userStopped = false;
        running = true;
        worker = new Thread(new Runnable() {
            @Override public void run() { loop(addr); }
        }, "obd");
        worker.start();
    }

    public synchronized void disconnect(boolean byUser) {
        if (byUser) {
            userStopped = true;
            prefs.edit().remove("addr").apply();
        }
        running = false;
        closeSocket();
        if (worker != null) worker.interrupt();
        worker = null;
        if (byUser) listener.onObdStatus("off", "OBD disconnected");
    }

    public void requestDtcScan() { scanRequested = true; }
    public void requestDtcClear() { clearRequested = true; }

    private void closeSocket() {
        BluetoothSocket s = socket;
        socket = null;
        if (s != null) try { s.close(); } catch (IOException ignored) { }
    }

    // ───────────────────────── worker ─────────────────────────

    @SuppressWarnings("MissingPermission")
    private void loop(String addr) {
        int attempt = 0;
        while (running && !userStopped) {
            try {
                if (!hasBtPermission()) { listener.onObdStatus("error", "Allow Bluetooth permission for OBD"); return; }
                BluetoothAdapter ad = BluetoothAdapter.getDefaultAdapter();
                if (ad == null || !ad.isEnabled()) throw new IOException("Bluetooth is off");
                listener.onObdStatus("connecting", attempt == 0 ? "Connecting to OBD adapter…" : null);
                BluetoothDevice dev = ad.getRemoteDevice(addr);
                ad.cancelDiscovery();
                socket = openSocket(dev);
                InputStream in = socket.getInputStream();
                OutputStream out = socket.getOutputStream();

                init(in, out);
                listener.onObdStatus("connected", "OBD connected");
                attempt = 0;
                poll(in, out);
            } catch (Exception e) {
                closeSocket();
                if (!running || userStopped) return;
                attempt++;
                listener.onObdStatus("error", attempt == 1 ? "OBD: " + (e.getMessage() == null ? "connection failed" : e.getMessage()) : null);
                // Back off: 5s, 10s … max 30s. Adapter may be unpowered until ignition is on.
                try { Thread.sleep(Math.min(30000, 5000L * attempt)); } catch (InterruptedException ie) { return; }
            }
        }
    }

    @SuppressWarnings("MissingPermission")
    private BluetoothSocket openSocket(BluetoothDevice dev) throws IOException {
        try {
            BluetoothSocket s = dev.createRfcommSocketToServiceRecord(SPP);
            s.connect();
            return s;
        } catch (IOException first) {
            // Many cheap ELM327 clones need the hidden channel-1 socket.
            try {
                Method m = dev.getClass().getMethod("createRfcommSocket", int.class);
                BluetoothSocket s = (BluetoothSocket) m.invoke(dev, 1);
                s.connect();
                return s;
            } catch (Exception e) {
                throw first;
            }
        }
    }

    private void init(InputStream in, OutputStream out) throws IOException, InterruptedException {
        send(in, out, "ATZ", 4000);
        Thread.sleep(800);
        send(in, out, "ATE0", 1500);
        send(in, out, "ATL0", 1500);
        send(in, out, "ATS0", 1500);
        send(in, out, "ATH0", 1500);
        send(in, out, "ATAT1", 1500);
        send(in, out, "ATSP0", 1500);
        // First request triggers protocol search (slow on ISO 9141 cars).
        String r = send(in, out, "0100", 12000);
        if (r.contains("UNABLETOCONNECT") || (r.contains("ERROR") && !r.contains("41"))) {
            throw new IOException("ECU not responding – is the ignition on?");
        }
        for (int i = 0; i < unsupported.length; i++) unsupported[i] = false;
    }

    private void poll(InputStream in, OutputStream out) throws IOException, InterruptedException {
        int slow = 0;
        while (running && !userStopped) {
            if (scanRequested) { scanRequested = false; readDtcs(in, out, "Scan complete"); }
            if (clearRequested) {
                clearRequested = false;
                String r = send(in, out, "04", 5000);
                readDtcs(in, out, r.contains("44") ? "Trouble codes cleared" : "Clear may have failed – engine must be off with ignition on");
            }

            JSONObject o = new JSONObject();
            try {
                int[] b = bytes(send(in, out, "010D", 1500), "410D", 1);
                if (b != null) o.put("speed", b[0]);
                b = bytes(send(in, out, "010C", 1500), "410C", 2);
                if (b != null) o.put("rpm", (b[0] * 256 + b[1]) / 4.0);

                // one slow PID per cycle
                int idx = slow++ % SLOW_PIDS.length;
                if (!unsupported[idx]) {
                    String pid = SLOW_PIDS[idx];
                    String r = send(in, out, pid, pid.equals("ATRV") ? 1500 : 2000);
                    if (pid.equals("ATRV")) {
                        String v = r.replaceAll("[^0-9.]", "");
                        if (!v.isEmpty()) o.put("volt", Double.parseDouble(v));
                    } else {
                        b = bytes(r, "41" + pid.substring(2), 1);
                        if (b == null) {
                            if (r.contains("NODATA")) unsupported[idx] = true;
                        } else {
                            switch (pid) {
                                case "0105": o.put("cool", b[0] - 40); break;
                                case "012F": o.put("fuel", b[0] * 100.0 / 255); break;
                                case "0104": o.put("load", b[0] * 100.0 / 255); break;
                                case "0111": o.put("thr", b[0] * 100.0 / 255); break;
                                case "010F": o.put("iat", b[0] - 40); break;
                            }
                        }
                    }
                }
            } catch (NumberFormatException ignored) {
            } catch (org.json.JSONException ignored) { }
            if (o.length() > 0) listener.onObdData(o);
            Thread.sleep(120);
        }
    }

    // ───────────────────────── DTCs ─────────────────────────

    private void readDtcs(InputStream in, OutputStream out, String msg) throws IOException, InterruptedException {
        String raw = sendRaw(in, out, "03", 6000);
        listener.onDtc(parseDtcs(raw), msg);
    }

    /** Parses mode 03 responses for both CAN (with count byte) and ISO 9141/KWP (3 codes per frame). */
    static List<String> parseDtcs(String raw) {
        List<String> codes = new ArrayList<>();
        String[] lines = raw.toUpperCase(Locale.US).split("[\\r\\n]+");
        for (String line : lines) {
            String l = line.replaceAll("[^0-9A-F]", "");
            int at = l.indexOf("43");
            if (at < 0) continue;
            String data = l.substring(at + 2);
            if ((data.length() / 2) % 2 == 1) data = data.substring(2); // CAN: drop count byte
            for (int i = 0; i + 4 <= data.length(); i += 4) {
                String c = data.substring(i, i + 4);
                if (c.equals("0000")) continue;
                int first = Integer.parseInt(c.substring(0, 1), 16);
                char letter = "PCBU".charAt(first >> 2);
                String code = "" + letter + (first & 3) + c.substring(1);
                if (!codes.contains(code)) codes.add(code);
            }
        }
        return codes;
    }

    // ───────────────────────── serial I/O ─────────────────────────

    /** Sends a command and returns the response with whitespace removed and upper-cased. */
    private String send(InputStream in, OutputStream out, String cmd, int timeoutMs) throws IOException, InterruptedException {
        return sendRaw(in, out, cmd, timeoutMs).replaceAll("\\s", "").replace("SEARCHING...", "").toUpperCase(Locale.US);
    }

    private String sendRaw(InputStream in, OutputStream out, String cmd, int timeoutMs) throws IOException, InterruptedException {
        while (in.available() > 0) in.read(); // flush
        out.write((cmd + "\r").getBytes("US-ASCII"));
        out.flush();
        StringBuilder sb = new StringBuilder();
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            if (in.available() > 0) {
                int c = in.read();
                if (c < 0) throw new IOException("Adapter closed");
                if (c == '>') break;
                sb.append((char) c);
            } else {
                Thread.sleep(8);
            }
        }
        return sb.toString();
    }

    /** Finds "41xx" in a response and returns the next n data bytes. */
    private static int[] bytes(String r, String header, int n) {
        int at = r.indexOf(header);
        if (at < 0) return null;
        int start = at + header.length();
        if (r.length() < start + n * 2) return null;
        int[] b = new int[n];
        try {
            for (int i = 0; i < n; i++) b[i] = Integer.parseInt(r.substring(start + i * 2, start + i * 2 + 2), 16);
        } catch (NumberFormatException e) { return null; }
        return b;
    }
}
