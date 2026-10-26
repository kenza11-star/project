package com.nightround.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioManager;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Pembungkus WebView untuk NightRound. Game tetap dimuat dari URL web (BuildConfig.GAME_URL, diatur di gradle.properties)
 * karena game memakai API route Next.js, Firebase, dan Supabase Realtime yang butuh server + origin https.
 */
public class MainActivity extends Activity {
    private static final String TAG = "NightRound";
    private static final int REQ_AUDIO = 1001;
    private static final int REQ_FILE = 1002;

    private FrameLayout root;
    private WebView web;
    private LinearLayout errorView;
    private TextView errorText;

    // fullscreen (element.requestFullscreen() dari game)
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCb;
    private WebChromeClient chrome;

    // file chooser
    private ValueCallback<Uri[]> filePathCb;

    // permission mic yang sedang menunggu jawaban pengguna
    private PermissionRequest pendingMicRequest;

    private boolean loadFailed = false;
    private long lastBackAt = 0;

    private String gameOrigin;      // mis. "https://nightround-web.vercel.app"
    private String gameHost;        // mis. "nightround-web.vercel.app"
    private final List<String> navHosts = new ArrayList<>();

    // ------------------------------------------------------------------ lifecycle

    @Override
    @SuppressWarnings("deprecation")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setVolumeControlStream(AudioManager.STREAM_MUSIC);

        Uri game = Uri.parse(BuildConfig.GAME_URL);
        gameHost = game.getHost() == null ? "" : game.getHost().toLowerCase(Locale.ROOT);
        gameOrigin = originOf(game);
        navHosts.add(gameHost);
        for (String h : BuildConfig.EXTRA_NAV_HOSTS.split(",")) {
            String t = h.trim().toLowerCase(Locale.ROOT);
            if (!t.isEmpty()) navHosts.add(t);
        }

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        buildErrorView();

        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int bottom;
            if (Build.VERSION.SDK_INT >= 30) bottom = insets.getInsets(WindowInsets.Type.ime()).bottom;
            else bottom = insets.getSystemWindowInsetBottom();
            v.setPadding(0, 0, 0, bottom);
            return insets;
        });

        configureWebView();
        applyImmersive();

        web.loadUrl(BuildConfig.GAME_URL);
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyImmersive();
        if (web != null) web.onResume();
    }

    @Override
    protected void onPause() {
        // WebView.onPause() memicu visibilitychange -> game menghentikan sementara audio (lihat PlayScene). Tidak memanggil pauseTimers()
        // supaya koneksi realtime tidak mati total saat hanya sebentar ke notifikasi.
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (filePathCb != null) { filePathCb.onReceiveValue(null); filePathCb = null; }
        if (pendingMicRequest != null) { pendingMicRequest.deny(); pendingMicRequest = null; }
        if (web != null) {
            root.removeView(web);
            web.stopLoading();
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersive();
    }

    // ------------------------------------------------------------------ WebView setup

    private void configureWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage / sessionStorage / IndexedDB (Firebase auth)
        s.setDatabaseEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT); // pakai HTTP cache normal: GLB/SFX besar tidak diunduh ulang tiap masuk
        s.setMediaPlaybackRequiresUserGesture(true); // ikuti kebijakan autoplay: game sudah memanggil audio.unlock() pada gesture
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setSupportMultipleWindows(false);
        s.setGeolocationEnabled(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        // Penanda untuk game: lib/net/appupdate.ts membaca "NightRound/x.y.z" dari User-Agent.
        s.setUserAgentString(s.getUserAgentString() + " NightRound/" + BuildConfig.VERSION_NAME);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, false);

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG); // chrome://inspect hanya di APK debug

        web.setWebViewClient(new GameClient());
        chrome = new GameChrome();
        web.setWebChromeClient(chrome);
    }

    private final class GameClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return false;
            Uri u = request.getUrl();
            if (isNavAllowed(u)) return false;
            // Link keluar (di luar domain game) dibuka di browser, bukan di WebView ini
            String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
            if (scheme.equals("https") || scheme.equals("http")) {
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (ActivityNotFoundException ignored) { }
            }
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            loadFailed = false;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (!loadFailed) errorView.setVisibility(View.GONE);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showError("Tidak bisa memuat game.\n" + error.getDescription());
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse resp) {
            if (request.isForMainFrame() && resp.getStatusCode() >= 400) showError("Server game membalas HTTP " + resp.getStatusCode() + ".");
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel(); // jangan pernah lanjut pada sertifikat bermasalah
            showError("Sertifikat HTTPS server tidak valid.");
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // Proses renderer mati (biasanya kehabisan memori GPU/RAM saat memuat model 3D besar). Tanpa ini aplikasi ikut crash.
            Log.w(TAG, "Render process gone, crash=" + detail.didCrash());
            Toast.makeText(MainActivity.this, "WebView kehabisan memori, memuat ulang game...", Toast.LENGTH_LONG).show();
            root.post(MainActivity.this::recreate);
            return true;
        }
    }

    private final class GameChrome extends WebChromeClient {

        // ---- MIC / WebRTC: izin WebView hanya untuk origin game, hanya audio capture, dan hanya setelah izin Android diberikan ----
        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            runOnUiThread(() -> handleWebPermission(request));
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            if (request == pendingMicRequest) pendingMicRequest = null;
        }

        // ---- file picker (foto profil, model karakter .glb/.vrm) ----
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (filePathCb != null) filePathCb.onReceiveValue(null);
            filePathCb = callback;
            try {
                startActivityForResult(buildPickIntent(params), REQ_FILE);
            } catch (ActivityNotFoundException e) {
                filePathCb = null;
                callback.onReceiveValue(null);
                Toast.makeText(MainActivity.this, "Tidak ada aplikasi pemilih file.", Toast.LENGTH_LONG).show();
            }
            return true;
        }

        // ---- fullscreen ----
        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null) { callback.onCustomViewHidden(); return; }
            customView = view;
            customViewCb = callback;
            view.setBackgroundColor(Color.BLACK);
            root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            applyImmersive();
        }

        @Override
        public void onHideCustomView() {
            if (customView == null) return;
            root.removeView(customView);
            customView = null;
            if (customViewCb != null) { customViewCb.onCustomViewHidden(); customViewCb = null; }
            applyImmersive();
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage m) {
            if (BuildConfig.DEBUG) Log.d(TAG, "[console " + m.messageLevel() + "] " + m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
            return true;
        }
    }

    // ------------------------------------------------------------------ permission mic

    private void handleWebPermission(PermissionRequest request) {
        // 1) Origin harus persis origin game, dan halaman yang tampil sekarang juga harus dari origin itu.
        if (!isGameOrigin(request.getOrigin()) || !isCurrentPageGameOrigin()) { request.deny(); return; }

        // 2) Hanya audio capture. Kamera/MIDI/DRM dll ditolak (game tidak memerlukannya).
        boolean wantsAudio = false;
        for (String r : request.getResources()) if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) wantsAudio = true;
        if (!wantsAudio) { request.deny(); return; }

        // 3) Izin Android RECORD_AUDIO harus sudah benar-benar diberikan sebelum WebView di-grant.
        if (Build.VERSION.SDK_INT < 23 || checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            return;
        }
        if (pendingMicRequest != null) pendingMicRequest.deny(); // permintaan lama digantikan
        pendingMicRequest = request;
        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_AUDIO);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_AUDIO) return;
        PermissionRequest req = pendingMicRequest;
        pendingMicRequest = null;
        boolean ok = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (req == null) return;
        if (ok && isGameOrigin(req.getOrigin()) && isCurrentPageGameOrigin()) {
            req.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            req.deny(); // getUserMedia() di game -> NotAllowedError -> game menampilkan "Mic tidak diizinkan" dan tidak menganggap mic aktif
            if (!ok) showMicDeniedDialog();
        }
    }

    private void showMicDeniedDialog() {
        new AlertDialog.Builder(this)
                .setTitle("Izin mikrofon ditolak")
                .setMessage("Voice chat tidak akan berfungsi tanpa izin mikrofon. Kamu tetap bisa mendengar pemain lain.\n\nAktifkan di Pengaturan > Izin > Mikrofon, lalu tekan tombol mic di game lagi.")
                .setPositiveButton("Buka Pengaturan", (d, w) -> {
                    Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getPackageName(), null));
                    try { startActivity(i); } catch (ActivityNotFoundException ignored) { }
                })
                .setNegativeButton("Tutup", null)
                .show();
    }

    // ------------------------------------------------------------------ file chooser

    private Intent buildPickIntent(WebChromeClient.FileChooserParams params) {
        List<String> mimes = new ArrayList<>();
        String[] accept = params.getAcceptTypes();
        if (accept != null) for (String a : accept) {
            if (a != null && a.contains("/") && !a.trim().isEmpty()) mimes.add(a.trim());
        }
        Intent i = new Intent(Intent.ACTION_GET_CONTENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        // Ekstensi seperti ".glb"/".vrm" tidak punya MIME standar -> tampilkan semua file. Bila ada MIME (gambar), filter dengan MIME.
        if (mimes.size() == 1) i.setType(mimes.get(0));
        else i.setType("*/*");
        if (mimes.size() > 1) i.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
        if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        return i;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE) return;
        ValueCallback<Uri[]> cb = filePathCb;
        filePathCb = null;
        if (cb != null) cb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data)); // selalu dipanggil, kalau tidak chooser berikutnya macet
    }

    // ------------------------------------------------------------------ back button

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (customView != null) { chrome.onHideCustomView(); return; }
        if (errorView.getVisibility() == View.VISIBLE) { exitOnDoubleBack(); return; }
        // Saat bermain: Back = tombol Escape game (buka/tutup menu pause, kembali dari sub-panel). Modal di lobby: tutup modal.
        final String js = "(function(){try{var d=document.documentElement;"
                + "var k=function(){window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true,cancelable:true}));};"
                + "if(d&&d.hasAttribute('data-play')){k();return 'handled';}"
                + "if(document.querySelector('[role=dialog]')){k();return 'handled';}"
                + "}catch(e){}return 'none';})()";
        web.evaluateJavascript(js, value -> {
            if (value != null && value.contains("handled")) return;
            exitOnDoubleBack();
        });
    }

    private void exitOnDoubleBack() {
        long now = System.currentTimeMillis();
        if (now - lastBackAt < 2000) { finish(); return; }
        lastBackAt = now;
        Toast.makeText(this, "Tekan Kembali sekali lagi untuk keluar", Toast.LENGTH_SHORT).show();
    }

    // ------------------------------------------------------------------ error overlay

    private void buildErrorView() {
        errorView = new LinearLayout(this);
        errorView.setOrientation(LinearLayout.VERTICAL);
        errorView.setGravity(Gravity.CENTER);
        errorView.setBackgroundColor(Color.BLACK);
        errorView.setPadding(48, 48, 48, 48);
        errorView.setVisibility(View.GONE);
        errorView.setClickable(true);

        errorText = new TextView(this);
        errorText.setTextColor(Color.WHITE);
        errorText.setTextSize(16);
        errorText.setGravity(Gravity.CENTER);
        errorView.addView(errorText);

        Button retry = new Button(this);
        retry.setText("Coba lagi");
        retry.setOnClickListener(v -> {
            errorView.setVisibility(View.GONE);
            loadFailed = false;
            web.loadUrl(BuildConfig.GAME_URL);
        });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = 32;
        errorView.addView(retry, lp);

        root.addView(errorView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void showError(String msg) {
        loadFailed = true;
        errorText.setText(msg);
        errorView.setVisibility(View.VISIBLE);
    }

    // ------------------------------------------------------------------ immersive fullscreen

    @SuppressWarnings("deprecation")
    private void applyImmersive() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            w.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN);
        }
    }

    // ------------------------------------------------------------------ origin helpers

    /** "scheme://host[:port]" huruf kecil, port bawaan (80/443) dibuang. */
    private static String originOf(Uri u) {
        if (u == null || u.getScheme() == null || u.getHost() == null) return "";
        String scheme = u.getScheme().toLowerCase(Locale.ROOT);
        int port = u.getPort();
        boolean dflt = port == -1 || (scheme.equals("https") && port == 443) || (scheme.equals("http") && port == 80);
        return scheme + "://" + u.getHost().toLowerCase(Locale.ROOT) + (dflt ? "" : ":" + port);
    }

    private boolean isGameOrigin(Uri origin) {
        return origin != null && !gameOrigin.isEmpty() && gameOrigin.equals(originOf(origin));
    }

    private boolean isCurrentPageGameOrigin() {
        String url = web == null ? null : web.getUrl();
        return url != null && isGameOrigin(Uri.parse(url));
    }

    private boolean isNavAllowed(Uri u) {
        if (u == null || u.getHost() == null || !"https".equalsIgnoreCase(u.getScheme())) return false;
        return navHosts.contains(u.getHost().toLowerCase(Locale.ROOT));
    }
}
