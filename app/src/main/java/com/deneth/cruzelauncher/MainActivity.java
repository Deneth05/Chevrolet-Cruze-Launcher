package com.deneth.cruzelauncher;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.ActivityManager;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.speech.RecognizerIntent;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Home-screen activity. Hosts the HTML UI in a WebView and feeds it live data:
 * GPS speed/heading, OBD-II (ELM327), now-playing media, ambient light / night mode.
 */
public class MainActivity extends Activity implements LocationListener, SensorEventListener, ObdManager.Listener {

    private WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private boolean pageReady = false;

    private LocationManager locationManager;
    private SensorManager sensorManager;
    private long lastLightPush = 0;
    private float lastLux = -1;

    private ObdManager obd;
    private AudioManager audio;
    private MediaSessionManager sessions;
    private String lastArtKey = null;
    private String lastArtData = null;

    private static final int REQ_PERMS = 42;

    // ───────────────────────── lifecycle ─────────────────────────

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            w.getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }

        audio = (AudioManager) getSystemService(AUDIO_SERVICE);
        sessions = (MediaSessionManager) getSystemService(MEDIA_SESSION_SERVICE);
        obd = new ObdManager(this, this);

        web = new WebView(this);
        web.setBackgroundColor(0xFF06070A);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setTextZoom(100);
        web.addJavascriptInterface(new Bridge(), "Android");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !url.startsWith("file:///android_asset/");
            }
        });
        setContentView(web);
        web.loadUrl("file:///android_asset/www/index.html");

        hideSystemBars();
        requestNeededPermissions();
        registerReceiver(netReceiver, new IntentFilter(ConnectivityManager.CONNECTIVITY_ACTION));
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideSystemBars();
        startLocation();
        startLightSensor();
        ui.removeCallbacks(mediaPoll);
        ui.post(mediaPoll);
        if (pageReady) pushNight();
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Keep GPS + OBD alive (trip keeps counting while another app is on top),
        // but stop the light sensor and media polling.
        if (sensorManager != null) sensorManager.unregisterListener(this);
        ui.removeCallbacks(mediaPoll);
    }

    @Override
    protected void onDestroy() {
        try { unregisterReceiver(netReceiver); } catch (Exception ignored) { }
        if (locationManager != null) {
            try { locationManager.removeUpdates(this); } catch (Exception ignored) { }
        }
        obd.disconnect(false);
        web.destroy();
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        pushNight();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // Home button pressed while already home → close any open panel.
        js("CL.back()");
    }

    @Override
    public void onBackPressed() {
        // A launcher never exits on back; just close panels.
        js("CL.back()");
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        View d = getWindow().getDecorView();
        d.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    private void requestNeededPermissions() {
        if (Build.VERSION.SDK_INT < 23) return;
        List<String> need = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED)
            need.add(Manifest.permission.ACCESS_FINE_LOCATION);
        if (Build.VERSION.SDK_INT >= 31 && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED)
            need.add(Manifest.permission.BLUETOOTH_CONNECT);
        if (!need.isEmpty()) requestPermissions(need.toArray(new String[0]), REQ_PERMS);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        startLocation();
        if (pageReady) obd.autoConnect();
    }

    // ───────────────────────── JS helpers ─────────────────────────

    private void js(final String code) {
        ui.post(new Runnable() {
            @Override public void run() {
                if (web != null && pageReady) web.evaluateJavascript("try{" + code + "}catch(e){}", null);
            }
        });
    }

    private static String q(String s) {
        return JSONObject.quote(s == null ? "" : s);
    }

    // ───────────────────────── GPS ─────────────────────────

    private void startLocation() {
        if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return;
        try {
            if (locationManager == null) locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);
            locationManager.removeUpdates(this);
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER))
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, this);
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 30000, 50, this);
            Location last = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            if (last == null) last = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            if (last != null) pushLocation(last, false);
        } catch (SecurityException | IllegalArgumentException ignored) { }
    }

    @Override
    public void onLocationChanged(Location l) {
        pushLocation(l, LocationManager.GPS_PROVIDER.equals(l.getProvider()));
    }

    private void pushLocation(Location l, boolean live) {
        try {
            JSONObject o = new JSONObject();
            o.put("lat", l.getLatitude());
            o.put("lon", l.getLongitude());
            o.put("speed", live && l.hasSpeed() ? l.getSpeed() : 0);
            if (l.hasBearing()) o.put("bearing", l.getBearing());
            o.put("acc", l.getAccuracy());
            o.put("live", live);
            js("CL.onLocation(" + o + ")");
        } catch (Exception ignored) { }
    }

    @Override public void onStatusChanged(String provider, int status, Bundle extras) { }
    @Override public void onProviderEnabled(String provider) { startLocation(); }
    @Override public void onProviderDisabled(String provider) { }

    // ───────────────────────── Light / night (headlights) ─────────────────────────

    private void startLightSensor() {
        if (sensorManager == null) sensorManager = (SensorManager) getSystemService(SENSOR_SERVICE);
        if (sensorManager == null) return;
        Sensor light = sensorManager.getDefaultSensor(Sensor.TYPE_LIGHT);
        if (light != null) sensorManager.registerListener(this, light, SensorManager.SENSOR_DELAY_NORMAL);
    }

    @Override
    public void onSensorChanged(SensorEvent e) {
        long now = SystemClock.elapsedRealtime();
        float lux = e.values[0];
        if (now - lastLightPush < 2000 && Math.abs(lux - lastLux) < 20) return;
        lastLightPush = now;
        lastLux = lux;
        js("CL.onLight(" + lux + ")");
    }

    @Override public void onAccuracyChanged(Sensor sensor, int accuracy) { }

    /** Most head units switch Android to night mode when the illumination (headlight) wire is live. */
    private void pushNight() {
        int mode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        if (mode == Configuration.UI_MODE_NIGHT_UNDEFINED) return;
        js("CL.onNightMode(" + (mode == Configuration.UI_MODE_NIGHT_YES) + ")");
    }

    // ───────────────────────── Network ─────────────────────────

    private final BroadcastReceiver netReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { js("CL.onNet(" + isOnline() + ")"); }
    };

    @SuppressWarnings("deprecation")
    private boolean isOnline() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            NetworkInfo ni = cm.getActiveNetworkInfo();
            return ni != null && ni.isConnected();
        } catch (Exception e) { return true; }
    }

    // ───────────────────────── Media (now playing) ─────────────────────────

    private final Runnable mediaPoll = new Runnable() {
        @Override public void run() {
            pushMedia();
            ui.postDelayed(this, 1000);
        }
    };

    private MediaController activeController() {
        if (sessions == null || !MediaListener.isEnabled(this)) return null;
        try {
            List<MediaController> list = sessions.getActiveSessions(new ComponentName(this, MediaListener.class));
            MediaController fallback = null;
            for (MediaController c : list) {
                PlaybackState ps = c.getPlaybackState();
                if (ps != null && ps.getState() == PlaybackState.STATE_PLAYING) return c;
                if (fallback == null && c.getMetadata() != null) fallback = c;
            }
            return fallback;
        } catch (SecurityException e) {
            return null;
        }
    }

    private void pushMedia() {
        if (!pageReady) return;
        MediaController c = activeController();
        if (c == null || c.getMetadata() == null) { js("CL.onMedia(null)"); return; }
        try {
            MediaMetadata md = c.getMetadata();
            PlaybackState ps = c.getPlaybackState();
            String title = md.getString(MediaMetadata.METADATA_KEY_TITLE);
            String artist = md.getString(MediaMetadata.METADATA_KEY_ARTIST);
            if (artist == null) artist = md.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST);
            long dur = md.getLong(MediaMetadata.METADATA_KEY_DURATION);
            long pos = 0;
            boolean playing = false;
            if (ps != null) {
                playing = ps.getState() == PlaybackState.STATE_PLAYING;
                pos = ps.getPosition();
                if (playing && ps.getLastPositionUpdateTime() > 0) {
                    pos += (long) ((SystemClock.elapsedRealtime() - ps.getLastPositionUpdateTime()) * ps.getPlaybackSpeed());
                }
            }
            String pkg = c.getPackageName();
            String key = pkg + "|" + title + "|" + artist;
            if (!key.equals(lastArtKey)) {
                lastArtKey = key;
                Bitmap art = md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
                if (art == null) art = md.getBitmap(MediaMetadata.METADATA_KEY_ART);
                lastArtData = art != null ? "data:image/jpeg;base64," + toBase64(art, 200, Bitmap.CompressFormat.JPEG) : null;
            }
            JSONObject o = new JSONObject();
            o.put("title", title == null ? "" : title);
            o.put("artist", artist == null ? "" : artist);
            o.put("source", "Now playing · " + appLabel(pkg));
            o.put("pkg", pkg);
            o.put("playing", playing);
            o.put("pos", Math.max(0, pos));
            o.put("dur", Math.max(0, dur));
            if (lastArtData != null) o.put("art", lastArtData);
            js("CL.onMedia(" + o + ")");
        } catch (Exception ignored) { }
    }

    private String appLabel(String pkg) {
        try {
            PackageManager pm = getPackageManager();
            return pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString();
        } catch (Exception e) { return "Media"; }
    }

    private void mediaKey(String action) {
        MediaController c = activeController();
        if (c != null) {
            MediaController.TransportControls t = c.getTransportControls();
            PlaybackState ps = c.getPlaybackState();
            boolean playing = ps != null && ps.getState() == PlaybackState.STATE_PLAYING;
            switch (action) {
                case "toggle": if (playing) t.pause(); else t.play(); break;
                case "pause": t.pause(); break;
                case "next": t.skipToNext(); break;
                case "prev": t.skipToPrevious(); break;
            }
        } else {
            int code;
            switch (action) {
                case "next": code = KeyEvent.KEYCODE_MEDIA_NEXT; break;
                case "prev": code = KeyEvent.KEYCODE_MEDIA_PREVIOUS; break;
                case "pause": code = KeyEvent.KEYCODE_MEDIA_PAUSE; break;
                default: code = KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE;
            }
            audio.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, code));
            audio.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, code));
        }
        ui.postDelayed(new Runnable() { @Override public void run() { pushMedia(); } }, 350);
    }

    // ───────────────────────── Apps ─────────────────────────

    private static String toBase64(Bitmap b, int max, Bitmap.CompressFormat fmt) {
        int w = b.getWidth(), h = b.getHeight();
        float sc = Math.min(1f, (float) max / Math.max(w, h));
        Bitmap s = sc < 1f ? Bitmap.createScaledBitmap(b, Math.max(1, (int) (w * sc)), Math.max(1, (int) (h * sc)), true) : b;
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        s.compress(fmt, 80, out);
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }

    private static Bitmap drawableToBitmap(Drawable d, int size) {
        Bitmap b = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        d.setBounds(0, 0, size, size);
        d.draw(c);
        return b;
    }

    private void loadApps() {
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    PackageManager pm = getPackageManager();
                    Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
                    List<ResolveInfo> list = pm.queryIntentActivities(i, 0);
                    JSONArray arr = new JSONArray();
                    for (ResolveInfo r : list) {
                        String pkg = r.activityInfo.packageName;
                        if (pkg.equals(getPackageName())) continue;
                        JSONObject o = new JSONObject();
                        o.put("pkg", pkg);
                        o.put("label", r.loadLabel(pm).toString());
                        try { o.put("icon", toBase64(drawableToBitmap(r.loadIcon(pm), 96), 96, Bitmap.CompressFormat.PNG)); } catch (Exception ignored) { }
                        arr.put(o);
                    }
                    js("CL.onApps(" + arr + ")");
                } catch (Exception ignored) { }
            }
        }, "apps").start();
    }

    private boolean launchPkg(String pkg) {
        if (pkg == null || pkg.isEmpty()) return false;
        Intent i = getPackageManager().getLaunchIntentForPackage(pkg);
        if (i == null) return false;
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { startActivity(i); return true; } catch (Exception e) { return false; }
    }

    private boolean start(Intent i) {
        try { i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); startActivity(i); return true; }
        catch (ActivityNotFoundException | SecurityException e) { return false; }
    }

    private void openApp(String type, String pkg) {
        if (launchPkg(pkg)) return;
        boolean ok = false;
        switch (type) {
            case "nav":
                ok = launchPkg("com.google.android.apps.maps") || launchPkg("com.waze")
                        || launchPkg("com.google.android.apps.mapslite")
                        || start(new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=")));
                break;
            case "music":
                ok = start(Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_MUSIC))
                        || launchPkg("com.spotify.music") || launchPkg("com.google.android.apps.youtube.music");
                break;
            case "video":
                ok = launchPkg("com.google.android.youtube") || launchPkg("com.google.android.apps.youtube.kids")
                        || start(new Intent(Intent.ACTION_VIEW, Uri.parse("https://m.youtube.com")));
                break;
            case "phone":
                ok = start(new Intent(Intent.ACTION_DIAL));
                break;
            case "assistant":
                ok = start(new Intent(Intent.ACTION_VOICE_COMMAND))
                        || start(new Intent(Intent.ACTION_ASSIST))
                        || start(new Intent(RecognizerIntent.ACTION_WEB_SEARCH));
                break;
            case "bt": ok = start(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS)); break;
            case "wifi": ok = start(new Intent(Settings.ACTION_WIFI_SETTINGS)); break;
            case "hotspot":
                ok = start(new Intent().setComponent(new ComponentName("com.android.settings", "com.android.settings.TetherSettings")))
                        || start(new Intent(Settings.ACTION_WIRELESS_SETTINGS));
                break;
            case "notif": ok = start(new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")); break;
            case "home": ok = start(new Intent(Settings.ACTION_HOME_SETTINGS)) || start(new Intent(Settings.ACTION_SETTINGS)); break;
            case "system": ok = start(new Intent(Settings.ACTION_SETTINGS)); break;
        }
        if (!ok) js("CL.onToast&&CL.onToast(" + q("No app found for " + type) + ")");
    }

    // ───────────────────────── OBD callbacks ─────────────────────────

    @Override public void onObdData(JSONObject data) { js("CL.onObd(" + data + ")"); }
    @Override public void onObdStatus(String state, String msg) { js("CL.onObdStatus(" + q(state) + "," + q(msg) + ")"); }
    @Override public void onDtc(List<String> codes, String msg) { js("CL.onDtc(" + new JSONArray(codes) + "," + q(msg) + ")"); }

    // ───────────────────────── JS bridge ─────────────────────────

    /** Methods callable from JavaScript as window.Android.xxx(). They run on a background thread. */
    private class Bridge {
        @JavascriptInterface public void ready() {
            ui.post(new Runnable() {
                @Override public void run() {
                    pageReady = true;
                    pushNight();
                    js("CL.onNet(" + isOnline() + ")");
                    startLocation();
                    obd.autoConnect();
                    pushMedia();
                }
            });
        }

        @JavascriptInterface public String getInfo() {
            try {
                ActivityManager am = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
                ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
                am.getMemoryInfo(mi);
                JSONObject o = new JSONObject();
                o.put("lowRam", am.isLowRamDevice() || mi.totalMem < 2600L * 1024 * 1024);
                o.put("ramMb", mi.totalMem / (1024 * 1024));
                o.put("sdk", Build.VERSION.SDK_INT);
                o.put("model", Build.MANUFACTURER + " " + Build.MODEL);
                return o.toString();
            } catch (Exception e) { return "{}"; }
        }

        @JavascriptInterface public String getVersion() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
            catch (Exception e) { return "1.0"; }
        }

        @JavascriptInterface public void requestApps() { loadApps(); }

        @JavascriptInterface public void launch(final String pkg) {
            ui.post(new Runnable() { @Override public void run() { launchPkg(pkg); } });
        }

        @JavascriptInterface public void openApp(final String type, final String pkg) {
            ui.post(new Runnable() { @Override public void run() { MainActivity.this.openApp(type, pkg); } });
        }

        @JavascriptInterface public void media(final String action) {
            ui.post(new Runnable() { @Override public void run() { mediaKey(action); } });
        }

        @JavascriptInterface public int getVolume() {
            int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            return max > 0 ? Math.round(audio.getStreamVolume(AudioManager.STREAM_MUSIC) * 100f / max) : 0;
        }

        @JavascriptInterface public void setVolume(int pct) {
            int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            audio.setStreamVolume(AudioManager.STREAM_MUSIC, Math.round(max * pct / 100f), 0);
        }

        @JavascriptInterface public void setBrightness(final float v) {
            ui.post(new Runnable() {
                @Override public void run() {
                    WindowManager.LayoutParams lp = getWindow().getAttributes();
                    lp.screenBrightness = Math.max(0.02f, Math.min(1f, v));
                    getWindow().setAttributes(lp);
                }
            });
        }

        @JavascriptInterface public String obdDevices() { return obd.pairedDevices(); }
        @JavascriptInterface public void obdConnect(String addr) { obd.connect(addr, true); }
        @JavascriptInterface public void obdDisconnect() { obd.disconnect(true); }
        @JavascriptInterface public void obdScan() { obd.requestDtcScan(); }
        @JavascriptInterface public void obdClear() { obd.requestDtcClear(); }
    }
}
