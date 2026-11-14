package app.opencodemob

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.PendingIntent
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.widget.Toast
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.OpenableColumns
import android.provider.Settings
import android.util.Base64
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewAssetLoader
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import kotlin.concurrent.thread

/**
 * One WebView with the bundled OpenCode UI (assets/ui). It only ever loads our own assets;
 * every other link opens in the system browser. All talking to the local server goes through Net.
 */
class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private val ui = Handler(Looper.getMainLooper())
    private var pendingKind: String? = null
    private var pendingDir = ""
    private var fileCb: ValueCallback<Array<Uri>>? = null
    private var lastReady = false
    private var stt: SpeechInput? = null
    private var tts: Speaker? = null
    private var lastErr: String? = null

    private val loader by lazy {
        val resp = File(cacheDir, "resp").apply { mkdirs() }
        val preview = File(cacheDir, "preview").apply { mkdirs() }
        WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/_resp/", WebViewAssetLoader.InternalStoragePathHandler(this, resp))
            .addPathHandler("/_preview/", WebViewAssetLoader.InternalStoragePathHandler(this, preview))
            .build()
    }

    private val picker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { onPicked(it) }
    private val notifPerm = registerForActivityResult(ActivityResultContracts.RequestPermission()) { emit("perms", JSONObject()) }
    private val micPerm = registerForActivityResult(ActivityResultContracts.RequestPermission()) { emit("perms", JSONObject()) }
    // overlay bubble showing the live agent state over other apps (see OverlayService)
    private val overlayPerm = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        // Settings returns RESULT_CANCELED even after the user grants the permission,
        // so re-check the real state instead of trusting the result code.
        if (Settings.canDrawOverlays(this)) startOverlay()
        else emit("perms", JSONObject())
    }

    private val chooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        fileCb?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data)); fileCb = null
    }
    private val speechLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        if (r.resultCode == Activity.RESULT_OK && r.data != null) {
            val results = r.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            val text = results?.firstOrNull() ?: ""
            if (text.isNotEmpty()) {
                runOnUiThread {
                    emit("voice", JSONObject().put("text", text))
                }
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.setFlags(
            android.view.WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            android.view.WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        )
        // Unlock 90Hz / 120Hz / 144Hz high refresh rate display mode
        unlockHighRefreshRate()
        window.statusBarColor = 0xFF0D0D0F.toInt()
        window.navigationBarColor = 0xFF0D0D0F.toInt()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = false
            window.isStatusBarContrastEnforced = false
        }
        WindowCompat.getInsetsController(window, window.decorView)?.let { controller ->
            controller.isAppearanceLightStatusBars = false
            controller.isAppearanceLightNavigationBars = false
        }
        val root = FrameLayout(this).apply {
            setBackgroundColor(0xFF0D0D0F.toInt())
            keepScreenOn = true
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, ins ->
            val i = ins.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            v.setPadding(i.left, i.top, i.right, i.bottom)
            WindowInsetsCompat.CONSUMED
        }
        web = WebView(this).apply {
            setBackgroundColor(0xFF0D0D0F.toInt())
            // Never use LAYER_TYPE_HARDWARE on WebView as it disables Chromium direct GPU swapchain and caps FPS to 60
            setLayerType(View.LAYER_TYPE_NONE, null)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.setSupportZoom(false)
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(v: WebView, r: WebResourceRequest): WebResourceResponse? {
                    val url = r.url
                    if (url.host == "appassets.androidplatform.net" && url.path?.startsWith("/_preview/") == true) {
                        val relPath = url.path!!.removePrefix("/_preview/").ifEmpty { "index.html" }
                        val previewDir = File(cacheDir, "preview")
                        val file = File(previewDir, relPath)
                        // keep the preview sandboxed: no ../ escapes out of the preview dir
                        val inSandbox = try {
                            file.canonicalPath.startsWith(previewDir.canonicalPath + File.separator)
                        } catch (_: Exception) { false }
                        if (inSandbox && file.exists() && file.isFile) {
                            val mime = when (file.extension.lowercase()) {
                                "html", "htm" -> "text/html"
                                "css" -> "text/css"
                                "js", "mjs" -> "application/javascript"
                                "json" -> "application/json"
                                "png" -> "image/png"
                                "jpg", "jpeg" -> "image/jpeg"
                                "svg" -> "image/svg+xml"
                                "webp" -> "image/webp"
                                "gif" -> "image/gif"
                                "ico" -> "image/x-icon"
                                "woff2" -> "font/woff2"
                                "woff" -> "font/woff"
                                "ttf" -> "font/ttf"
                                else -> "application/octet-stream"
                            }
                            val headers = mapOf(
                                "Access-Control-Allow-Origin" to "*",
                                "Cache-Control" to "no-cache, no-store, must-revalidate",
                                "Pragma" to "no-cache"
                            )
                            return WebResourceResponse(mime, "UTF-8", 200, "OK", headers, file.inputStream())
                        }
                    }
                    return loader.shouldInterceptRequest(r.url)
                }
                override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                    if (!r.isForMainFrame) return false
                    val u = r.url
                    if (u.host == "appassets.androidplatform.net") return false
                    openExternal(u)
                    return true
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(w: WebView, cb: ValueCallback<Array<Uri>>, p: FileChooserParams): Boolean {
                    fileCb?.onReceiveValue(null); fileCb = cb
                    val intent = try {
                        val base = p.createIntent()
                        val types = p.acceptTypes
                        if (types.isNullOrEmpty() || types.any { it.contains(".md", ignoreCase = true) || it == "*/*" || it.contains("markdown", ignoreCase = true) }) {
                            base.type = "*/*"
                            base.putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("*/*"))
                        }
                        base
                    } catch (_: Exception) {
                        Intent(Intent.ACTION_GET_CONTENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "*/*"
                        }
                    }
                    return try { chooser.launch(intent); true } catch (_: Exception) { fileCb = null; false }
                }
            }
            addJavascriptInterface(Bridge(), "OC")
            loadUrl("https://appassets.androidplatform.net/assets/ui/index.html")
        }
        root.addView(web, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)
        checkOpenAppTrigger()

        onBackPressedDispatcher.addCallback(this) {
            web.evaluateJavascript("(window.OCM&&OCM.back&&OCM.back())===true") { r -> if (r != "true") moveTaskToBack(true) }
        }
        watch()
        handleWidgetIntent(intent)
        handleShareIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleWidgetIntent(intent)
        handleShareIntent(intent)
    }

    private fun handleShareIntent(intent: Intent?) {
        if (intent == null) return
        val action = intent.action
        if (action != Intent.ACTION_SEND && action != Intent.ACTION_SEND_MULTIPLE && action != Intent.ACTION_PROCESS_TEXT) return
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)
            ?: intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()
            ?: ""
        // Collect shared files (images, PDFs, several attachments) and hand them to the UI as
        // data URLs so they can be attached to the composer exactly like picked files.
        val uris = ArrayList<Uri>()
        if (action == Intent.ACTION_SEND_MULTIPLE) {
            intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.let { uris.addAll(it) }
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)?.let { uris.add(it) }
        }
        val files = ArrayList<JSONObject>()
        for (u in uris.take(8)) {
            try {
                val cr = contentResolver
                val mime = cr.getType(u) ?: "application/octet-stream"
                val bytes = cr.openInputStream(u)?.use { it.readBytes() } ?: continue
                if (bytes.size > 8 * 1024 * 1024) continue
                val name = queryName(u) ?: ("shared-" + System.currentTimeMillis())
                files.add(JSONObject()
                    .put("mime", mime)
                    .put("filename", name)
                    .put("data", Base64.encodeToString(bytes, Base64.NO_WRAP)))
            } catch (_: Exception) {}
        }
        if (text.isBlank() && files.isEmpty()) return
        ui.postDelayed({
            val o = JSONObject().put("text", text)
            if (files.isNotEmpty()) {
                val arr = org.json.JSONArray()
                files.forEach { arr.put(it) }
                o.put("files", arr)
            }
            emit("share", o)
        }, 500)
    }

    /** Original display name for a content:// uri (falls back to the last path segment). */
    private fun queryName(uri: Uri): String? = try {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst() && !c.isNull(0)) c.getString(0) else null
        } ?: uri.lastPathSegment
    } catch (_: Exception) { uri.lastPathSegment }

    private fun handleWidgetIntent(intent: Intent?) {
        val act = intent?.getStringExtra("widget_action") ?: return
        val target = intent.getStringExtra("widget_target") ?: ""
        val sessionId = intent.getStringExtra("widget_session") ?: ""
        if (act == "voice") {
            ui.postDelayed({
                try {
                    val sp = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                        putExtra(RecognizerIntent.EXTRA_PROMPT, "Слушаю...")
                    }
                    speechLauncher.launch(sp)
                } catch (_: Exception) {
                    emit("widget_action", JSONObject().put("action", "voice"))
                }
            }, 300)
            return
        }
        ui.postDelayed({
            emit("widget_action", JSONObject().put("action", act).put("target", target).put("session", sessionId))
        }, 500)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        unlockHighRefreshRate()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) unlockHighRefreshRate()
    }

    override fun onResume() {
        super.onResume()
        unlockHighRefreshRate()
        emit("perms", JSONObject())
    }

    private fun startOverlay() {
        Prefs.putFlag(this, "overlay_enabled", true)
        OverlayService.start(this)
    }

    private fun unlockHighRefreshRate() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val lp = window.attributes
                lp.preferredRefreshRate = 120f
                if (Build.VERSION.SDK_INT >= 34) {
                    try {
                        lp.javaClass.getField("preferredMinDisplayRefreshRate").setFloat(lp, 90f)
                        lp.javaClass.getField("preferredMaxDisplayRefreshRate").setFloat(lp, 144f)
                    } catch (_: Throwable) {}
                }
                val disp = display ?: (getSystemService(Context.DISPLAY_SERVICE) as? android.hardware.display.DisplayManager)?.getDisplay(android.view.Display.DEFAULT_DISPLAY)
                val modes = disp?.supportedModes
                val maxMode = modes?.maxByOrNull { it.refreshRate }
                if (maxMode != null && maxMode.refreshRate >= 90f) {
                    lp.preferredDisplayModeId = maxMode.modeId
                }
                window.attributes = lp
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                @Suppress("DEPRECATION")
                val modes = windowManager.defaultDisplay?.supportedModes
                val maxMode = modes?.maxByOrNull { it.refreshRate }
                if (maxMode != null && maxMode.refreshRate >= 90f) {
                    val lp = window.attributes
                    lp.preferredDisplayModeId = maxMode.modeId
                    window.attributes = lp
                }
            }
        } catch (_: Exception) {}
    }

    override fun onDestroy() {
        webReady = false
        ui.removeCallbacksAndMessages(null)
        try { stt?.stop() } catch (_: Exception) {}
        try { tts?.shutdown() } catch (_: Exception) {}
        Net.sseStop()
        web.destroy()
        super.onDestroy()
    }

    private fun openExternal(u: Uri) {
        if (u.scheme in listOf("http", "https", "tg")) try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (_: Exception) {}
    }

    // Every bridge event goes through here. SSE deltas are coalesced by the UI-side render
    // throttling (see render.js), not by reordering the event queue: batching here broke the strict
    // order between "http" replies and "sse" data, which left promise callbacks unresolved and made
    // the app look disconnected from the local server.
    fun emit(name: String, data: JSONObject) {
        runOnUiThread {
            if (!webReady) return@runOnUiThread
            try {
                web.evaluateJavascript("window.OCEvent&&window.OCEvent(" + JSONObject.quote(name) + "," + data + ")", null)
            } catch (_: Exception) {}
        }
    }

    @Volatile private var webReady = true

    /** Tells the UI when the server comes up or goes down. */
    private fun watch() {
        val r = ServerState.ready
        if (r != lastReady) {
            lastReady = r
            emit("server", JSONObject().put("ready", r))
            if (r) emit("ready", JSONObject())
        }
        val e = ServerState.error
        if (!r && e != null && e != lastErr) { lastErr = e; emit("boot", JSONObject().put("error", e)) }
        if (e == null) lastErr = null
        ui.postDelayed({ watch() }, 1000)
    }

    private fun uid() = Prefs.get(this, "uid")

    /** A fresh random identity for a guest profile: unique uid, nickname and password.
     *  Every guest gets their own profile with their own chats, keys and free-quota bucket;
     *  nobody sits on a shared "local" account anymore. */
    private fun randomGuest() {
        val rnd = java.security.SecureRandom()
        fun hex(n: Int) = ByteArray(n).also { rnd.nextBytes(it) }.joinToString("") { "%02x".format(it) }
        val nickChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        val nick = "Гость-" + (1..4).map { nickChars[rnd.nextInt(nickChars.length)] }.joinToString("")
        val pwChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
        val pw = (1..16).map { pwChars[rnd.nextInt(pwChars.length)] }.joinToString("")
        val gu = "g" + hex(5)
        val em = "guest-" + hex(4) + "@device.local"
        Prefs.put(this, "uid", gu)
        Prefs.put(this, "email", em)
        Prefs.put(this, "name", nick)
        Prefs.put(this, "guestpw", pw)
        Prefs.put(this, "guest", "1")
        // remembered separately, so "continue as guest" returns to the same profile after a sign-out
        Prefs.put(this, "guestuid", gu)
        Prefs.put(this, "guestemail", em)
        Prefs.put(this, "guestname", nick)
    }

    /** Local data dir key. Never empty after this call: the existing profile or a fresh random guest. */
    private fun ensureUid(): String {
        val u = uid()
        if (u.isNotEmpty()) return u
        randomGuest()
        return uid()
    }

    // ---------- opencode account login (device flow via `opencode console login`) ----------

    private val ansiRe = Regex("\u001B\\[[0-9;?]*[ -/]*[@-~]|\u001B\\][^\u0007\u001B]*(\u0007|\u001B\\\\)|[\u001B\u0000-\u0008\u000B\u000C\u000E-\u001F]")
    @Volatile private var loginProc: Process? = null

    private fun authEmit(o: JSONObject) = emit("authlogin", o)

    /** Starts `opencode console login` inside proot and streams the device-flow URL/code to the UI. */
    private fun doAuthLogin() {
        if (loginProc != null) return authEmit(JSONObject().put("stage", "error").put("error", "Вход уже выполняется"))
        val u = ensureUid()
        if (!Runtime.isInstalled(this)) return authEmit(JSONObject().put("stage", "error").put("error", "Linux-окружение ещё не установлено"))
        thread {
            var url: String? = null
            var code: String? = null
            var sentUrl = false
            var doneEmail: String? = null
            var failMsg: String? = null
            val tail = java.util.ArrayDeque<String>()
            try {
                val p = Runtime.prootCmd(this, u, listOf("/usr/local/bin/opencode", "console", "login"))
                loginProc = p
                java.io.BufferedReader(java.io.InputStreamReader(p.inputStream, Charsets.UTF_8)).use { r ->
                    while (true) {
                        val raw = r.readLine() ?: break
                        val line = ansiRe.replace(raw, "")
                        if (tail.size >= 12) tail.poll()
                        tail.add(line)
                        if (url == null) {
                            val m = Regex("Go to:\\s*(https?://\\S+)").find(line)
                                ?: Regex("(https?://opencode\\.ai/\\S*[?&#][A-Za-z_]*code=[A-Za-z0-9_-]+)").find(line)
                            m?.let { url = it.groupValues[1] }
                        }
                        if (code == null) {
                            val m = Regex("Enter code:\\s*([A-Za-z0-9_-]+)").find(line)
                            val uq = url
                            val m2 = if (m == null && uq != null) Regex("[?&#](?:user_)?code=([A-Za-z0-9_-]+)").find(uq) else null
                            (m ?: m2)?.let { code = it.groupValues[1] }
                        }
                        val u1 = url; val c1 = code
                        if (!sentUrl && u1 != null && c1 != null) {
                            sentUrl = true
                            authEmit(JSONObject().put("stage", "url").put("url", u1).put("code", c1))
                        }
                        if (doneEmail == null) Regex("Logged in as\\s+(\\S+)").find(line)?.let { doneEmail = it.groupValues[1] }
                        if (failMsg == null) {
                            if (line.contains("Device code expired")) failMsg = "Код входа истёк. Попробуйте ещё раз"
                            else if (line.contains("Authorization denied")) failMsg = "Вход отклонён"
                            else Regex("Error:\\s*(.{3,})").find(line)?.let { failMsg = it.groupValues[1].trim() }
                        }
                    }
                }
                // wait for the CLI to finish writing the account db before restarting the server
                val fin = p.waitFor()
                val em = doneEmail; val fm = failMsg
                if (em != null) {
                    // mirror the console account into the Zen credential store BEFORE the restart,
                    // otherwise the provider stays anonymous and every model hits the shared free quota
                    val synced = syncZenCredential(this@MainActivity, u, em)
                    authEmit(JSONObject().put("stage", "done").put("email", em).put("synced", synced))
                } else if (fm != null) {
                    authEmit(JSONObject().put("stage", "error").put("error", fm))
                } else if (fin != 0) {
                    authEmit(JSONObject().put("stage", "error").put("error", "opencode вернул код $fin: " + tail.joinToString(" / ").take(300)))
                } else {
                    authEmit(JSONObject().put("stage", "error").put("error", "Вход прерван"))
                }
            } catch (e: Exception) {
                authEmit(JSONObject().put("stage", "error").put("error", e.message ?: "Не удалось запустить вход"))
            } finally {
                loginProc = null
            }
        }
    }

    /**
     * opencode 1.x: `console login` stores the account in opencode.db (tables `account` +
     * `account_state`), but the OpenCode Zen provider only becomes non-anonymous when the
     * integration store (`credential` table, integration_id='opencode') holds the OAuth token.
     * Without this mirror the provider stays anonymous even after a successful login and every
     * model reports "Free usage limit reached" - exactly the "logged in but still sitting on
     * the free shared account" bug. We write the credential row the integration system would
     * have stored, so the personal Zen quota actually applies after the login.
     */
    private fun syncZenCredential(c: Context, uid: String, email: String): Boolean {
        val db = File(Runtime.home(c, uid), ".local/share/opencode/opencode.db")
        if (!db.exists()) return false
        return try {
            SQLiteDatabase.openDatabase(db.path, null, SQLiteDatabase.OPEN_READWRITE).use { sq ->
                val row = sq.rawQuery(
                    "SELECT id,url,access_token,refresh_token,token_expiry FROM account WHERE email=? ORDER BY time_updated DESC LIMIT 1",
                    arrayOf(email)
                ).use { r ->
                    if (r.moveToFirst()) listOf(
                        r.getString(0), r.getString(1), r.getString(2), r.getString(3),
                        if (r.isNull(4)) null else r.getLong(4)
                    ) else null
                } ?: return false
                val accId = row[0] as? String ?: return false
                val url = row[1] as? String
                val access = row[2] as? String ?: return false
                val refresh = row[3] as? String ?: return false
                val expiry = row[4] as? Long
                val mirrored = sq.rawQuery("SELECT value FROM credential WHERE integration_id='opencode'", null).use { r ->
                    while (r.moveToNext()) {
                        val v = r.getString(0) ?: continue
                        if (v.contains("\"access\":\"$access\"") && v.contains("\"refresh\":\"$refresh\"")) return@use true
                    }
                    false
                }
                if (mirrored) return true
                val now = System.currentTimeMillis()
                val meta = JSONObject()
                    .put("server", if (url.isNullOrEmpty()) "https://opencode.ai/console" else url)
                    .put("accountID", accId).put("email", email)
                val value = JSONObject()
                    .put("type", "oauth").put("methodID", "device")
                    .put("access", access).put("refresh", refresh)
                    .put("expires", expiry ?: (now + 3_600_000L))
                    .put("metadata", meta)
                sq.beginTransaction()
                try {
                    sq.execSQL("DELETE FROM credential WHERE integration_id='opencode'")
                    sq.execSQL(
                        "INSERT INTO credential (id,integration_id,label,value,connector_id,method_id,active,time_created,time_updated) VALUES (?,?,?,?,?,?,?,?,?)",
                        arrayOf<Any>("cred_" + java.lang.Long.toString(now, 36) + (100..999).random(), "opencode", email, value.toString(), "opencode", "device", 1, now, now)
                    )
                    sq.setTransactionSuccessful()
                } finally { sq.endTransaction() }
                true
            }
        } catch (_: Exception) {
            false
        }
    }

    /** Removes the mirrored Zen credential when the user logs out of the opencode account. */
    private fun dropZenCredential(c: Context, uid: String) {
        val db = File(Runtime.home(c, uid), ".local/share/opencode/opencode.db")
        if (!db.exists()) return
        try {
            SQLiteDatabase.openDatabase(db.path, null, SQLiteDatabase.OPEN_READWRITE).use { sq ->
                sq.execSQL("DELETE FROM credential WHERE integration_id='opencode'")
            }
        } catch (_: Exception) {}
    }

    /** Runs `opencode console logout <email>` (quick, non-interactive with an explicit email). */
    private fun doAuthLogout(email: String) {
        val u = ensureUid()
        if (!Runtime.isInstalled(this)) return emit("authlogout", JSONObject().put("ok", false).put("error", "Окружение не готово"))
        thread {
            try {
                val p = Runtime.prootCmd(this, u, listOf("/usr/local/bin/opencode", "console", "logout", email))
                val out = StringBuilder()
                java.io.BufferedReader(java.io.InputStreamReader(p.inputStream, Charsets.UTF_8)).use { r ->
                    while (true) {
                        val l = r.readLine() ?: break
                        out.append(ansiRe.replace(l, "")).append('\n')
                    }
                }
                val fin = p.waitFor()
                val text = out.toString()
                val ok = fin == 0 && !text.contains("Not logged in") && !text.contains("Account not found")
                val e = if (ok) null else if (text.contains("Account not found")) "Аккаунт не найден" else if (text.contains("Not logged in")) "Вход не выполнен" else "opencode вернул код $fin"
                if (ok) dropZenCredential(this@MainActivity, u)
                emit("authlogout", if (ok) JSONObject().put("ok", true) else JSONObject().put("ok", false).put("error", e ?: "Ошибка выхода"))
            } catch (e: Exception) {
                emit("authlogout", JSONObject().put("ok", false).put("error", e.message ?: "Ошибка выхода"))
            }
        }
    }


    private fun perms() = JSONObject().apply {
        put("notifications", Build.VERSION.SDK_INT < 33 ||
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
        put("files", Environment.isExternalStorageManager())
        put("install", packageManager.canRequestPackageInstalls())
        put("battery", (getSystemService(POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(packageName))
        put("mic", checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
    }

    private fun flags() = JSONObject().apply {
        for (k in FLAG_KEYS) put(k, Prefs.flag(this@MainActivity, k, k != "noseccomp"))
    }

    private fun cfgFile(): File {
        val dir = File(Runtime.home(this, uid()), ".config/opencode")
        val jsonc = File(dir, "opencode.jsonc")
        return if (jsonc.exists()) jsonc else File(dir, "opencode.json")
    }

    // ---------- Google sign-in ----------

    private fun doSignIn() {
        if (BuildConfig.GOOGLE_WEB_CLIENT_ID.isEmpty()) {
            // no Google client configured: a random guest profile instead of the old shared "local" one
            if (uid().isEmpty() || Prefs.get(this, "guest") == "1") randomGuest()
            emit("signin", JSONObject().put("ok", true).put("fallback", true)); return
        }
        val opt = GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false)
            .setServerClientId(BuildConfig.GOOGLE_WEB_CLIENT_ID)
            .setAutoSelectEnabled(true)
            .build()
        val req = GetCredentialRequest.Builder().addCredentialOption(opt).build()
        lifecycleScope.launch {
            try {
                val cred = CredentialManager.create(this@MainActivity).getCredential(this@MainActivity, req).credential
                if (cred is CustomCredential && cred.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                    val g = GoogleIdTokenCredential.createFrom(cred.data)
                    val sub = JSONObject(String(Base64.decode(g.idToken.split(".")[1], Base64.URL_SAFE))).getString("sub")
                    // one private folder per Google account; the hash cannot be reversed to the account id
                    val uid = MessageDigest.getInstance("SHA-256").digest(sub.toByteArray())
                        .joinToString("") { "%02x".format(it) }.take(24)
                    Prefs.put(this@MainActivity, "uid", uid)
                    Prefs.put(this@MainActivity, "email", g.id)
                    Prefs.put(this@MainActivity, "name", g.displayName ?: g.id)
                    Prefs.put(this@MainActivity, "guest", ""); Prefs.put(this@MainActivity, "guestpw", "")
                    emit("signin", JSONObject().put("ok", true))
                } else emit("signin", JSONObject().put("ok", false).put("error", "Unsupported credential"))
            } catch (e: Exception) {
                emit("signin", JSONObject().put("ok", false).put("error", e.message ?: "Sign-in cancelled"))
            }
        }
    }

    // ---------- uploads: AGENTS.md, agents, commands, plugins ----------

    private fun onPicked(uri: Uri?) {
        val kind = pendingKind ?: return
        pendingKind = null
        if (uri == null) return
        thread {
            try {
                val raw = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                    ?.use { if (it.moveToFirst()) it.getString(0) else null } ?: "file.md"
                var name = raw.replace(Regex("[^A-Za-z0-9._-]"), "_")
                val cfg = File(Runtime.home(this, uid()), ".config/opencode")
                val dest = when (kind) {
                    "rules" -> File(cfg, "AGENTS.md")
                    "project" -> File(Runtime.hostPath(this, uid(), pendingDir.ifEmpty { "/root" }), "AGENTS.md")
                    "plugin" -> File(File(cfg, "plugins"), name)
                    "skill" -> File(File(cfg, "skills"), name)
                    "backup" -> File(cacheDir, "restore.ocmbak")
                    else -> {
                        if (!name.endsWith(".md")) name += ".md"
                        File(File(cfg, if (kind == "command") "commands" else "agents"), name)
                    }
                }
                dest.parentFile?.mkdirs()
                contentResolver.openInputStream(uri)!!.use { i -> dest.outputStream().use { i.copyTo(it) } }
                emit("picked", JSONObject().put("ok", true).put("file", dest.name).put("path", dest.absolutePath).put("kind", kind))
            } catch (e: Exception) {
                emit("picked", JSONObject().put("ok", false).put("error", e.message ?: "failed"))
            }
        }
    }

    // ---------- OpenApp & Web Preview helpers ----------

    private fun checkOpenAppTrigger() {
        try {
            val root = Runtime.rootfs(this)
            val home = Runtime.home(this, uid())
            val appFiles = listOf(
                File(root, "tmp/.openapp"),
                File(home, ".openapp"),
                File(home, "tmp/.openapp")
            )
            for (f in appFiles) {
                if (f.exists()) {
                    val app = f.readText().trim()
                    f.delete()
                    if (app.isNotEmpty()) {
                        ui.post { launchApp(app) }
                        break
                    }
                }
            }

            val prevFiles = listOf(
                File(root, "tmp/.openpreview"),
                File(home, ".openpreview"),
                File(home, "tmp/.openpreview")
            )
            for (f in prevFiles) {
                if (f.exists()) {
                    val path = f.readText().trim()
                    prevFiles.forEach { runCatching { it.delete() } }
                    ui.post {
                        val url = prepareWebPreview(path)
                        emit("preview", JSONObject().put("path", path).put("url", url))
                    }
                    break
                }
            }
        } catch (_: Exception) {}
        ui.postDelayed({ checkOpenAppTrigger() }, 250)
    }

    fun launchApp(target: String): Boolean {
        val t = target.trim()
        if (t.isEmpty()) return false
        val pm = packageManager
        val lower = t.lowercase()

        // 1. Direct Package Launch via known aliases
        val known = mapOf(
            "telegram" to listOf("org.telegram.messenger", "org.telegram.messenger.web", "org.thunderdog.challegram", "org.telegram.plus"),
            "телеграм" to listOf("org.telegram.messenger", "org.telegram.messenger.web", "org.thunderdog.challegram", "org.telegram.plus"),
            "телега" to listOf("org.telegram.messenger", "org.thunderdog.challegram"),
            "tg" to listOf("org.telegram.messenger", "org.thunderdog.challegram"),
            "тг" to listOf("org.telegram.messenger", "org.thunderdog.challegram"),
            "vk" to listOf("com.vkontakte.android", "com.vk.im"),
            "вк" to listOf("com.vkontakte.android", "com.vk.im"),
            "вконтакте" to listOf("com.vkontakte.android", "com.vk.im"),
            "youtube" to listOf("com.google.android.youtube"),
            "ютуб" to listOf("com.google.android.youtube"),
            "chrome" to listOf("com.android.chrome"),
            "хром" to listOf("com.android.chrome"),
            "browser" to listOf("com.android.chrome", "org.mozilla.firefox", "com.opera.browser"),
            "браузер" to listOf("com.android.chrome", "org.mozilla.firefox"),
            "github" to listOf("com.github.android"),
            "гитхаб" to listOf("com.github.android"),
            "settings" to listOf("com.android.settings"),
            "настройки" to listOf("com.android.settings"),
            "камера" to listOf("com.android.camera", "com.google.android.GoogleCamera"),
            "camera" to listOf("com.android.camera", "com.google.android.GoogleCamera"),
            "галерея" to listOf("com.google.android.apps.photos", "com.android.gallery3d"),
            "photos" to listOf("com.google.android.apps.photos"),
            "фото" to listOf("com.google.android.apps.photos"),
            "диск" to listOf("com.google.android.apps.docs"),
            "файлы" to listOf("com.google.android.documentsui", "com.android.documentsui"),
            "files" to listOf("com.google.android.documentsui", "com.android.documentsui"),
            "проводник" to listOf("com.google.android.documentsui", "com.android.documentsui"),
            "whatsapp" to listOf("com.whatsapp"),
            "ватсап" to listOf("com.whatsapp"),
            "вацап" to listOf("com.whatsapp"),
            "калькулятор" to listOf("com.google.android.calculator", "com.android.calculator2"),
            "calculator" to listOf("com.google.android.calculator", "com.android.calculator2"),
            "музыка" to listOf("com.google.android.apps.youtube.music", "ru.yandex.music"),
            "music" to listOf("com.google.android.apps.youtube.music", "ru.yandex.music"),
            "яндекс" to listOf("ru.yandex.searchplugin")
        )
        val candidates = known[lower] ?: listOf(t)
        for (pkg in candidates) {
            try {
                val launchIntent = pm.getLaunchIntentForPackage(pkg)
                if (launchIntent != null) {
                    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    runOnUiThread {
                        try {
                            startActivity(launchIntent)
                            Toast.makeText(this@MainActivity, "Запуск: $t", Toast.LENGTH_SHORT).show()
                        } catch (e: Exception) {
                            Toast.makeText(this@MainActivity, "Ошибка запуска $t: ${e.message}", Toast.LENGTH_SHORT).show()
                        }
                    }
                    return true
                }
            } catch (_: Exception) {}
        }

        // 2. Fallback to Intent URI or Category actions
        val fallbackIntents = when {
            lower in listOf("telegram", "телеграм", "телега", "tg", "тг") ->
                listOf(Intent(Intent.ACTION_VIEW, Uri.parse("tg://resolve")), Intent(Intent.ACTION_VIEW, Uri.parse("https://t.me/")))
            lower in listOf("youtube", "ютуб") ->
                listOf(Intent(Intent.ACTION_VIEW, Uri.parse("vnd.youtube:")), Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/")))
            lower in listOf("vk", "вк", "вконтакте") ->
                listOf(Intent(Intent.ACTION_VIEW, Uri.parse("vk://vk.com")), Intent(Intent.ACTION_VIEW, Uri.parse("https://vk.com/")))
            lower in listOf("whatsapp", "ватсап", "вацап") ->
                listOf(Intent(Intent.ACTION_VIEW, Uri.parse("whatsapp://send")))
            lower in listOf("chrome", "хром", "browser", "браузер") ->
                listOf(Intent(Intent.ACTION_VIEW, Uri.parse("https://google.com")))
            lower in listOf("settings", "настройки") ->
                listOf(Intent(android.provider.Settings.ACTION_SETTINGS))
            lower in listOf("калькулятор", "calculator") ->
                listOf(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_CALCULATOR))
            lower in listOf("музыка", "music") ->
                listOf(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_MUSIC))
            lower in listOf("камера", "camera") ->
                listOf(Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE))
            lower in listOf("фото", "photos", "галерея") ->
                listOf(Intent(Intent.ACTION_VIEW).setType("image/*"))
            lower in listOf("файлы", "files", "проводник") ->
                listOf(Intent(Intent.ACTION_VIEW).setType("*/*"))
            else -> emptyList()
        }
        for (fi in fallbackIntents) {
            try {
                fi.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                runOnUiThread {
                    try {
                        startActivity(fi)
                        Toast.makeText(this@MainActivity, "Запуск: $t", Toast.LENGTH_SHORT).show()
                    } catch (_: Exception) {}
                }
                return true
            } catch (_: Exception) {}
        }

        // 3. Search all installed applications by label / name
        try {
            val apps = pm.getInstalledApplications(PackageManager.GET_META_DATA)
            for (info in apps) {
                val label = pm.getApplicationLabel(info).toString().lowercase()
                if (label == lower || label.contains(lower) || info.packageName.lowercase().contains(lower)) {
                    val launchIntent = pm.getLaunchIntentForPackage(info.packageName)
                    if (launchIntent != null) {
                        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        runOnUiThread {
                            try {
                                startActivity(launchIntent)
                                Toast.makeText(this@MainActivity, "Запуск: ${pm.getApplicationLabel(info)}", Toast.LENGTH_SHORT).show()
                            } catch (_: Exception) {}
                        }
                        return true
                    }
                }
            }
        } catch (_: Exception) {}

        if (t.contains("://")) {
            runOnUiThread { openExternal(Uri.parse(t)) }
            return true
        }
        runOnUiThread {
            Toast.makeText(this@MainActivity, "Приложение «$t» не найдено", Toast.LENGTH_SHORT).show()
        }
        return false
    }

    private fun prepareWebPreview(path: String): String {
        val u = uid()
        val p = path.trim()
        val candidate = File(p)
        val target: File = when {
            candidate.isAbsolute && candidate.exists() -> candidate
            p.startsWith("/storage/") -> File(p)
            p.isEmpty() || p == "." || p == "./" -> Runtime.hostPath(this, u, "/root")
            else -> Runtime.hostPath(this, u, if (p.startsWith("/")) p else "/root/$p")
        }

        val previewDir = File(cacheDir, "preview").apply {
            mkdirs()
            listFiles()?.forEach { it.deleteRecursively() }
        }

        var actualTarget = target
        val rootDir = Runtime.hostPath(this, u, "/root")

        // Auto-discover existing HTML if target does not exist or is a directory without index.html
        val needsDiscovery = (!actualTarget.exists()) || (actualTarget.isDirectory && !File(actualTarget, "index.html").exists())
        if (needsDiscovery) {
            val searchDir = if (actualTarget.isDirectory && actualTarget.exists()) actualTarget
                else actualTarget.parentFile?.takeIf { it.exists() && it.isDirectory } ?: rootDir
            if (searchDir.exists() && searchDir.isDirectory) {
                val candidateHtml = searchDir.walkTopDown().maxDepth(4)
                    .filter { f ->
                        f.isFile && (f.extension.equals("html", true) || f.extension.equals("htm", true))
                            && !f.path.contains("/.")
                    }
                    .maxByOrNull { it.lastModified() }
                if (candidateHtml != null) {
                    actualTarget = candidateHtml
                }
            }
        }

        var baseDir = if (actualTarget.isDirectory) actualTarget else actualTarget.parentFile ?: actualTarget
        var entryName = if (actualTarget.isFile) actualTarget.name else "index.html"

        if (baseDir.exists() && baseDir.isDirectory) {

            // Copy web files
            baseDir.walkTopDown().maxDepth(4).forEach { f ->
                val rel = f.relativeTo(baseDir).path
                if (rel.isNotEmpty()) {
                    val dest = File(previewDir, rel)
                    if (f.isDirectory) {
                        dest.mkdirs()
                    } else if (f.isFile && f.length() < 12_000_000) {
                        dest.parentFile?.mkdirs()
                        f.copyTo(dest, true)
                    }
                }
            }
        } else if (target.isFile) {
            target.copyTo(File(previewDir, entryName), true)
        }

        // If index.html still doesn't exist, create an interactive HUD directory preview
        val entryFile = File(previewDir, entryName)
        if (!entryFile.exists()) {
            val fileListHtml = StringBuilder()
            previewDir.listFiles()?.forEach { f ->
                val isH = f.name.endsWith(".html") || f.name.endsWith(".htm")
                val isImg = listOf("png", "jpg", "jpeg", "webp", "gif", "svg").any { f.name.endsWith(it, true) }
                fileListHtml.append("""
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #27272a;">
                        <span style="font-family:monospace;color:#e4e4e7;">${f.name}</span>
                        ${if (isH) "<a href=\"${f.name}\" style=\"color:#38bdf8;text-decoration:none;font-weight:600;\">Открыть ▶</a>" else if (isImg) "<a href=\"${f.name}\" style=\"color:#a1a1aa;text-decoration:none;\">Изображение 🖼</a>" else "<span style=\"color:#71717a;\">${f.length() / 1024} KB</span>"}
                    </div>
                """.trimIndent())
            }
            entryFile.writeText("""
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <title>OpenCode Web Preview</title>
                    <style>
                        body { background: #0d0d0f; color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; margin: 0; }
                        .card { max-width: 540px; margin: 20px auto; background: #141417; border: 1px solid #27272a; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
                        .hdr { padding: 16px; border-bottom: 1px solid #27272a; display: flex; align-items: center; gap: 10px; }
                        h2 { margin: 0; font-size: 16px; color: #38bdf8; }
                        p { color: #a1a1aa; font-size: 13px; margin: 6px 0 0; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <div class="hdr">
                            <div>
                                <h2>🌐 Встроенный Веб-Предпросмотр</h2>
                                <p>Проект: ${target.name}</p>
                            </div>
                        </div>
                        <div>
                            ${if (fileListHtml.isNotEmpty()) fileListHtml.toString() else "<div style='padding:24px;text-align:center;color:#71717a;'>В этой папке пока нет файлов проекта.<br>Создайте <b>index.html</b> или напишите агенту.</div>"}
                        </div>
                    </div>
                </body>
                </html>
            """.trimIndent())
        }

        return "https://appassets.androidplatform.net/_preview/$entryName"
    }

    // ---------- JS bridge ----------

    inner class Bridge {
        @JavascriptInterface fun state(): String = JSONObject().apply {
            put("version", BuildConfig.VERSION_NAME); put("code", BuildConfig.VERSION_CODE)
            put("user", Prefs.get(this@MainActivity, "email")); put("name", Prefs.get(this@MainActivity, "name"))
            put("guest", Prefs.get(this@MainActivity, "guest") == "1")
            if (Prefs.get(this@MainActivity, "guest") == "1") put("pw", Prefs.get(this@MainActivity, "guestpw"))
            put("googleConfigured", BuildConfig.GOOGLE_WEB_CLIENT_ID.isNotEmpty())
            put("installed", Runtime.isInstalled(this@MainActivity))
            put("assetStamp", try { assets.open("rootfs.id").bufferedReader().use { it.readText().trim() } } catch (_: Exception) { "" })
            put("core", Updater.installedCore(this@MainActivity))
            put("perms", perms()); put("flags", flags()); put("ready", ServerState.ready)
            put("port", ServerState.port); put("serverError", ServerState.error ?: "")
            put("overlay", try { Settings.canDrawOverlays(this@MainActivity) } catch (_: Exception) { false })
        }.toString()

        // --- account / lifecycle ---
        @JavascriptInterface fun signIn() { runOnUiThread { doSignIn() } }

        /** Гостевой профиль: у каждого гостя свой случайный ник и пароль (fresh=true — новый профиль). */
        @JavascriptInterface fun signInGuest(fresh: Boolean) {
            val gu = Prefs.get(this@MainActivity, "guestuid")
            when {
                fresh -> randomGuest()
                gu.isNotEmpty() -> { // return to the existing guest profile; its data is still on the phone
                    Prefs.put(this@MainActivity, "uid", gu)
                    Prefs.put(this@MainActivity, "email", Prefs.get(this@MainActivity, "guestemail"))
                    Prefs.put(this@MainActivity, "name", Prefs.get(this@MainActivity, "guestname"))
                    Prefs.put(this@MainActivity, "guest", "1")
                }
                else -> randomGuest()
            }
            emit("signin", JSONObject().put("ok", true).put("guest", true))
        }

        /** Настоящий вход в аккаунт opencode (Google/GitHub) — device flow через `opencode console login`. */
        @JavascriptInterface fun authLogin() { runOnUiThread { doAuthLogin() } }

        @JavascriptInterface fun authCancel() {
            try { loginProc?.destroy() } catch (_: Exception) {}
        }

        /** Выход из аккаунта opencode: `opencode console logout <email>`. */
        @JavascriptInterface fun authLogout(email: String) { runOnUiThread { doAuthLogout(email) } }

        /** Вход по email без Google: uid = SHA-256(email), как и для Google-аккаунтов. У каждого email — свой изолированный профиль. */
        @JavascriptInterface fun signInEmail(email: String) {
            val e = email.trim().lowercase()
            if (!Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$").matches(e)) {
                emit("signin", JSONObject().put("ok", false).put("error", "Некорректный email")); return
            }
            val uid = MessageDigest.getInstance("SHA-256").digest(e.toByteArray())
                .joinToString("") { "%02x".format(it) }.take(24)
            Prefs.put(this@MainActivity, "uid", uid)
            Prefs.put(this@MainActivity, "email", e)
            Prefs.put(this@MainActivity, "name", e.substringBefore('@'))
            Prefs.put(this@MainActivity, "guest", ""); Prefs.put(this@MainActivity, "guestpw", "")
            emit("signin", JSONObject().put("ok", true))
        }

        @JavascriptInterface fun signOut() {
            runOnUiThread {
                Net.sseStop()
                stopService(Intent(this@MainActivity, OpenCodeService::class.java))
                // keep uid: chats/files stay on the phone, only the shown profile resets,
                // and the next "continue as guest" returns to the same data
                Prefs.put(this@MainActivity, "email", ""); Prefs.put(this@MainActivity, "name", "")
                lifecycleScope.launch {
                    try { CredentialManager.create(this@MainActivity).clearCredentialState(ClearCredentialStateRequest()) } catch (_: Exception) {}
                    emit("signedout", JSONObject())
                }
            }
        }

        @JavascriptInterface fun install() {
            thread {
                try {
                    Runtime.install(this@MainActivity) { emit("install", JSONObject().put("pct", it)) }
                    emit("install", JSONObject().put("done", true))
                } catch (e: Throwable) {
                    emit("install", JSONObject().put("error", e.message ?: e.toString()))
                }
            }
        }

        /** Nuclear retry: wipes every leftover of previous installs (old rootfs, partial extracts,
         *  renamed-aside dirs), then installs from scratch. Fixes any stale state on the phone. */
        @JavascriptInterface fun resetInstall() {
            thread {
                try {
                    stopService(Intent(this@MainActivity, OpenCodeService::class.java))
                    Runtime.rmrf(Runtime.rootfs(this@MainActivity))
                    Runtime.rmrf(File(filesDir, "rootfs.new"))
                    filesDir.listFiles { f -> f.name.startsWith("rootfs.broken") }?.forEach { Runtime.rmrf(it) }
                    Runtime.install(this@MainActivity) { emit("install", JSONObject().put("pct", it)) }
                    emit("install", JSONObject().put("done", true))
                } catch (e: Throwable) {
                    emit("install", JSONObject().put("error", e.message ?: e.toString()))
                }
            }
        }

        @JavascriptInterface fun start() {
            runOnUiThread {
                val uid = ensureUid()
                ServerState.error = null; lastErr = null
                ContextCompat.startForegroundService(this@MainActivity, Intent(this@MainActivity, OpenCodeService::class.java).putExtra("uid", uid))
                if (ServerState.ready) emit("ready", JSONObject())
            }
        }

        @JavascriptInterface fun restartServer() {
            runOnUiThread {
                stopService(Intent(this@MainActivity, OpenCodeService::class.java))
                ServerState.ready = false
                ui.postDelayed({ start() }, 700)
            }
        }

        // Full restart: stop the server, then kill the whole app process.
        // A pending alarm relaunches the app once the process is gone, so the fresh
        // start never races with the dying process (which previously made the app
        // vanish without reopening).
        @JavascriptInterface fun hardRestart() {
            runOnUiThread {
                try { stopService(Intent(this@MainActivity, OpenCodeService::class.java)) } catch (_: Exception) {}
                ServerState.ready = false
                try {
                    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: Intent(this@MainActivity, MainActivity::class.java)
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
                    val pi = PendingIntent.getActivity(
                        this@MainActivity, 42, launch,
                        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_CANCEL_CURRENT
                    )
                    val am = getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
                    am.set(android.app.AlarmManager.RTC, System.currentTimeMillis() + 600, pi)
                } catch (_: Exception) {}
                ui.postDelayed({
                    try { java.lang.Runtime.getRuntime().exit(0) } catch (_: Exception) {}
                    try { android.os.Process.killProcess(android.os.Process.myPid()) } catch (_: Exception) {}
                }, 200)
            }
        }

        // ---- remote CI builds (GitHub/GitLab/Bitbucket/CircleCI/Azure/Codemagic/Bitrise/GCB) ----
        @JavascriptInterface fun ciState(): String {
            val o = JSONObject()
            for (p in listOf("github","gitlab","bitbucket","circleci","azure","codemagic","bitrise","googlecloud")) {
                val t = Prefs.get(this@MainActivity, "ci_$p")
                if (t.isNotEmpty()) o.put(p, JSONObject().put("connected", true).put("token", t))
            }
            return o.toString()
        }
        @JavascriptInterface fun ciSaveToken(id: String, provider: String, token: String) {
            runOnUiThread {
                Prefs.put(this@MainActivity, "ci_$provider", token.trim())
                emit("ci-save", JSONObject().put("id", id).put("ok", true))
            }
        }
        @JavascriptInterface fun ciClearToken(provider: String) {
            runOnUiThread { Prefs.put(this@MainActivity, "ci_$provider", "") }
        }
        @JavascriptInterface fun ciRequest(id: String, provider: String, method: String, path: String, body: String) {
            thread {
                val o = JSONObject().put("id", id)
                try {
                    val token = Prefs.get(this@MainActivity, "ci_$provider")
                    if (token.isEmpty()) throw IllegalStateException("Токен не подключён")
                    val base = when (provider) {
                        "github" -> "https://api.github.com"
                        "gitlab" -> "https://gitlab.com/api/v4"
                        "bitbucket" -> "https://api.bitbucket.org/2.0"
                        "circleci" -> "https://circleci.com/api/v2"
                        "codemagic" -> "https://api.codemagic.io"
                        "bitrise" -> "https://api.bitrise.io"
                        "googlecloud" -> "https://cloudbuild.googleapis.com"
                        "azure" -> "https://dev.azure.com"
                        else -> throw IllegalStateException("Неизвестный сервис")
                    }
                    val url = base + path
                    val client = okhttp3.OkHttpClient.Builder().connectTimeout(15, java.util.concurrent.TimeUnit.SECONDS).readTimeout(60, java.util.concurrent.TimeUnit.SECONDS).build()
                    val needsBody = method == "POST" || method == "PUT" || method == "PATCH"
                    val rb = if (needsBody) (if (body.isEmpty()) "{}" else body).toRequestBody("application/json".toMediaType()) else null
                    val req = okhttp3.Request.Builder().url(url).header("Authorization", "Bearer $token").method(method, rb).build()
                    client.newCall(req).execute().use { r ->
                        val bytes = r.body?.bytes() ?: ByteArray(0)
                        val txt = String(bytes, Charsets.UTF_8)
                        o.put("status", r.code)
                        try { o.put("body", org.json.JSONObject(txt)) } catch (_: Exception) { o.put("body", org.json.JSONObject().put("message", txt.take(400))) }
                    }
                } catch (e: Exception) { o.put("error", e.message ?: e.toString()) }
                emit("ci-resp", o)
            }
        }

        @JavascriptInterface fun resetConfig() {
            runOnUiThread {
                val u = uid()
                if (u.isNotEmpty()) {
                    Runtime.sanitizeConfig(this@MainActivity, u, forceReset = true)
                }
                restartServer()
            }
        }

        @JavascriptInterface fun minimize() { runOnUiThread { moveTaskToBack(true) } }

        @JavascriptInterface fun grant(kind: String) {
            runOnUiThread {
                val pkg = Uri.parse("package:$packageName")
                when (kind) {
                    "notifications" -> if (Build.VERSION.SDK_INT >= 33) notifPerm.launch(Manifest.permission.POST_NOTIFICATIONS)
                    "files" -> startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, pkg))
                    "install" -> startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, pkg))
                    "battery" -> startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg))
                    "mic" -> if (Build.VERSION.SDK_INT >= 23) micPerm.launch(Manifest.permission.RECORD_AUDIO)
                    "overlay" -> if (Settings.canDrawOverlays(this@MainActivity)) this@MainActivity.startOverlay()
                    else overlayPerm.launch(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, pkg))
                }
            }
        }

        @JavascriptInterface fun startOverlay() {
            runOnUiThread {
                if (!Settings.canDrawOverlays(this@MainActivity)) {
                    overlayPerm.launch(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
                } else this@MainActivity.startOverlay()
            }
        }

        @JavascriptInterface fun stopOverlay() { OverlayService.stop(this@MainActivity) }

        /** Publishes the live agent state for the floating bubble (phase, role dots, attention). */
        @JavascriptInterface fun setOverlayState(json: String) {
            try {
                val o = JSONObject(json)
                Prefs.put(this@MainActivity, "overlay_phase", o.optString("phase", ""))
                Prefs.put(this@MainActivity, "overlay_jobs", o.optString("jobs", ""))
                Prefs.putFlag(this@MainActivity, "overlay_attention", o.optBoolean("attention", false))
                Prefs.putFlag(this@MainActivity, "overlay_error", o.optBoolean("error", false))
            } catch (_: Exception) {}
        }

        @JavascriptInterface fun overlayState(): String = try {
            JSONObject().put("allowed", Settings.canDrawOverlays(this@MainActivity))
                .put("running", Prefs.flag(this@MainActivity, "overlay_enabled", false))
                .toString()
        } catch (e: Exception) { JSONObject().put("allowed", false).put("running", false).toString() }

        @JavascriptInterface fun setFlag(key: String, value: Boolean) {
            if (key in FLAG_KEYS) Prefs.putFlag(this@MainActivity, key, value)
        }

        @JavascriptInterface fun testSound(kind: String) { Notifier.beep(kind) }
        @JavascriptInterface fun notify(kind: String, title: String, text: String) {
            runOnUiThread {
                try {
                    Notifier.event(this@MainActivity, kind, title, text)
                } catch (_: Exception) {}
            }
        }

        // --- continuous speech input (call mode) ---
        @JavascriptInterface fun sttStart(mode: String, lang: String, bias: String) {
            runOnUiThread {
                if (stt == null) stt = SpeechInput(this@MainActivity) { n, d -> emit(n, d) }
                if (stt?.isAvailable() != true) {
                    emit("stt", JSONObject().put("t", "error").put("error", "no_recognizer"))
                    return@runOnUiThread
                }
                // Biasing strings (file names, commands, agent names) dramatically improve recognition
                // of the project's vocabulary; passed as a comma-separated list from the UI.
                val words = bias.split(',').map { it.trim() }.filter { it.isNotEmpty() }.take(200).toTypedArray()
                stt?.start(mode, lang, words)
            }
        }

        @JavascriptInterface fun sttStop() { runOnUiThread { stt?.stop() } }

        @JavascriptInterface fun sttAvailable(): Boolean = try { SpeechRecognizer.isRecognitionAvailable(this@MainActivity) } catch (_: Exception) { false }

        // --- speech output ---
        @JavascriptInterface fun ttsInit(voice: String, rate: Float, pitch: Float) {
            runOnUiThread {
                if (tts == null) tts = Speaker(this@MainActivity) { n, d -> emit(n, d) }
                tts?.init(voice, rate, pitch)
            }
        }

        @JavascriptInterface fun ttsSpeak(text: String) { runOnUiThread { tts?.speak(text) } }
        @JavascriptInterface fun ttsStop() { runOnUiThread { tts?.stop() } }
        @JavascriptInterface fun ttsConfigure(voice: String, rate: Float, pitch: Float) { runOnUiThread { tts?.configure(voice, rate, pitch) } }
        @JavascriptInterface fun ttsVoices(): String = try { tts?.voices() ?: "[]" } catch (_: Exception) { "[]" }

        @JavascriptInterface fun startVoiceInput(lang: String) {
            runOnUiThread {
                try {
                    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                        putExtra(RecognizerIntent.EXTRA_PROMPT, if (lang == "en") "Speak now..." else "Говорите...")
                        putExtra(RecognizerIntent.EXTRA_LANGUAGE, if (lang == "en") "en-US" else "ru-RU")
                    }
                    speechLauncher.launch(intent)
                } catch (e: Exception) {
                    Toast.makeText(this@MainActivity, "Голосовой ввод недоступен: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }

        // --- network (local server) ---
        @JavascriptInterface fun http(id: String, method: String, path: String, body: String) {
            Net.request(this@MainActivity, id, method, path, body) { n, d -> emit(n, d) }
        }
        @JavascriptInterface fun drop(id: String) { Net.drop(this@MainActivity, id) }
        @JavascriptInterface fun sseStart() { Net.sseStart { n, d -> emit(n, d) } }
        @JavascriptInterface fun sseStop() { Net.sseStop() }
        @JavascriptInterface fun wsOpen(id: String, path: String) { Net.wsOpen(id, path) { n, d -> emit(n, d) } }
        @JavascriptInterface fun wsSend(id: String, text: String) { Net.wsSend(id, text) }
        @JavascriptInterface fun wsClose(id: String) { Net.wsClose(id) }

        // --- files (paths as the agent sees them) ---
        @JavascriptInterface fun ls(path: String): String = Runtime.ls(this@MainActivity, uid(), path).toString()
        @JavascriptInterface fun fs(op: String, path: String, arg: String): String = Runtime.fs(this@MainActivity, uid(), op, path, arg).toString()

        @JavascriptInterface fun readText(path: String): String = try {
            val f = Runtime.hostPath(this@MainActivity, uid(), path)
            if (!f.isFile) JSONObject().put("ok", false).put("err", "Not a file").toString()
            else if (f.length() > 2_000_000) JSONObject().put("ok", false).put("err", "File is too large").toString()
            else JSONObject().put("ok", true).put("text", f.readText()).toString()
        } catch (e: Exception) { JSONObject().put("ok", false).put("err", e.message ?: "failed").toString() }

        @JavascriptInterface fun writeText(path: String, text: String): String = try {
            val f = Runtime.hostPath(this@MainActivity, uid(), path)
            f.parentFile?.mkdirs(); f.writeText(text)
            JSONObject().put("ok", true).toString()
        } catch (e: Exception) { JSONObject().put("ok", false).put("err", e.message ?: "failed").toString() }

        @JavascriptInterface fun cfgRead(): String = try { cfgFile().takeIf { it.exists() }?.readText() ?: "" } catch (_: Exception) { "" }

        @JavascriptInterface fun cfgWrite(text: String): String = try {
            val f = cfgFile(); f.parentFile?.mkdirs(); f.writeText(text)
            JSONObject().put("ok", true).toString()
        } catch (e: Exception) { JSONObject().put("ok", false).put("err", e.message ?: "failed").toString() }

        @JavascriptInterface fun readLog(): String = try { File(filesDir, "server.log").readText().takeLast(60_000) } catch (_: Exception) { "" }

        /** End-to-end self check of the local pipeline: UI → Kotlin → 127.0.0.1 → server. */
        @JavascriptInterface fun diagnose(): String = try {
            val o = JSONObject()
            o.put("ready", ServerState.ready)
            o.put("port", ServerState.port)
            o.put("pwLen", ServerState.password.length)
            o.put("error", ServerState.error ?: "")
            o.put("installed", Runtime.isInstalled(this@MainActivity))
            o.put("uidLen", Prefs.get(this@MainActivity, "uid").length)
            o.put("webReady", webReady)
            // 1) can we open a TCP connection to the loopback port?
            var tcp = false
            try {
                java.net.Socket().use { s ->
                    s.connect(java.net.InetSocketAddress("127.0.0.1", ServerState.port), 1500)
                    tcp = true
                }
            } catch (_: Exception) {}
            o.put("tcp", tcp)
            // 2) does the server answer /global/health with the stored password?
            var code = -1; var body = ""
            if (tcp) try {
                val con = java.net.URL("http://127.0.0.1:${ServerState.port}/global/health").openConnection() as java.net.HttpURLConnection
                con.connectTimeout = 2500; con.readTimeout = 3000
                con.setRequestProperty("Authorization", Runtime.basic(ServerState.password))
                code = con.responseCode
                body = try { con.inputStream.bufferedReader().use { it.readText() }.take(300) } catch (_: Exception) { "" }
                con.disconnect()
            } catch (e: Exception) { o.put("healthErr", e.message ?: "") }
            o.put("healthCode", code)
            o.put("healthBody", body)
            // 3) proxy shim (used for third-party OpenAI-compatible providers)
            o.put("shimPort", ProxyShim.currentPort(this@MainActivity))
            o.put("shimRunning", ProxyShim.isRunning())
            // 4) tail of the server log, the single most useful thing when startup fails
            o.put("logTail", try { File(filesDir, "server.log").readLines().takeLast(25).joinToString("\n") } catch (_: Exception) { "" })
            o.toString()
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "failed").toString()
        }

        @JavascriptInterface fun pickFile(kind: String, dir: String) {
            runOnUiThread { pendingKind = kind; pendingDir = dir; picker.launch(arrayOf("*/*")) }
        }

        @JavascriptInterface fun shimUrl(): String = ProxyShim.baseUrl(this@MainActivity)

        /** Runs `git -C <dir> <args>` inside proot and returns merged output. */
        @JavascriptInterface fun gitRun(dir: String, args: String): String = try {
            val u = uid()
            if (!Runtime.isInstalled(this@MainActivity)) JSONObject().put("ok", false).put("err", "runtime not installed").toString()
            else {
                val parts = Regex("\"([^\"]*)\"|'([^']*)'|(\\S+)").findAll(args).map {
                    it.groupValues[1].ifEmpty { it.groupValues[2].ifEmpty { it.groupValues[3] } }
                }.filter { it.isNotEmpty() }.toList()
                // git must never wait for credentials or a pager inside the sandbox: that used to
                // block the WebView thread forever. /bin/sh is always present in the rootfs (unlike
                // /usr/bin/env), and single quotes keep every argument literal.
                val q = { a: String -> "'" + a.replace("'", "'\\''") + "'" }
                val script = "export GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/true GIT_EDITOR=true GIT_PAGER=cat LC_ALL=C; " +
                    "exec /usr/bin/git -C " + q(dir.ifEmpty { "/root" }) + parts.joinToString("") { " " + q(it) } + " </dev/null"
                val p = Runtime.prootCmd(this@MainActivity, u, listOf("/bin/sh", "-c", script))
                val out = StringBuilder()
                val limit = 512 * 1024
                val reader = Thread {
                    try {
                        java.io.BufferedReader(java.io.InputStreamReader(p.inputStream, Charsets.UTF_8)).use { r ->
                            var line = r.readLine()
                            while (line != null) {
                                if (out.length < limit) out.append(line).append('\n')
                                line = r.readLine()
                            }
                        }
                    } catch (_: Exception) {}
                }
                reader.isDaemon = true
                reader.start()
                // `pull`/`push` on a slow network can take minutes; kill after 120s so the UI unblocks.
                val finished = p.waitFor(120, java.util.concurrent.TimeUnit.SECONDS)
                if (!finished) {
                    try { p.destroyForcibly() } catch (_: Exception) {}
                    JSONObject().put("ok", false).put("err", "git timed out").put("out", out.toString()).toString()
                } else {
                    val code = try { p.exitValue() } catch (_: Exception) { -1 }
                    JSONObject().put("ok", code == 0).put("code", code).put("out", out.toString()).toString()
                }
            }
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("err", e.message ?: "failed").toString()
        }

        /**
         * Snapshot of the working tree into a shadow git repo, so any prompt can be rolled back.
         * Uses `git stash create` semantics but keeps the objects: a commit is created in a
         * separate GIT_DIR so the user's own repository index/history is never touched.
         */
        @JavascriptInterface fun checkpointCreate(dir: String, label: String): String = try {
            // IMPORTANT: this used to run git synchronously inside a @JavascriptInterface call, which
            // blocks the WebView JS thread — every prompt paid several seconds (sometimes tens of
            // seconds) of "waiting for the model". It runs on a background thread now and reports
            // the result through the "checkpoint" event.
            val u = uid()
            if (!Runtime.isInstalled(this@MainActivity)) JSONObject().put("ok", false).put("err", "runtime not installed").toString()
            else {
                thread {
                    try {
                        val id = System.currentTimeMillis().toString()
                        val q = { a: String -> "'" + a.replace("'", "'\\''") + "'" }
                        val script = buildString {
                            append("export GIT_DIR=/root/.ocm/checkpoints/repo GIT_WORK_TREE=").append(q(dir.ifEmpty { "/root" }))
                            append(" GIT_TERMINAL_PROMPT=0 GIT_PAGER=cat LC_ALL=C; ")
                            append("mkdir -p /root/.ocm/checkpoints/repo/info; ")
                            append("printf 'node_modules/\n.git/\ndist/\nbuild/\n.cache/\ntmp/\n*.log\n' > /root/.ocm/checkpoints/repo/info/exclude; ")
                            append("git rev-parse --git-dir >/dev/null 2>&1 || git init -q; ")
                            append("git add -A >/dev/null 2>&1; ")
                            // --porcelain is empty when nothing changed: skip the commit entirely
                            append("if [ -z \"$(git status --porcelain)\" ]; then echo NONE; exit 0; fi; ")
                            append("git -c user.name=OCM -c user.email=bot@ocm.local commit -q -m ").append(q(label.ifEmpty { "checkpoint" })).append(" --allow-empty 2>&1; ")
                            append("git rev-parse HEAD")
                        }
                        val p = Runtime.prootCmd(this@MainActivity, u, listOf("/bin/sh", "-c", script))
                        val out = p.inputStream.bufferedReader().use { it.readText() }.trim()
                        val done = p.waitFor(90, java.util.concurrent.TimeUnit.SECONDS)
                        if (!done) try { p.destroyForcibly() } catch (_: Exception) {}
                        val sha = out.lines().lastOrNull { it.length in 7..64 && it.all { c -> c.isLetterOrDigit() } } ?: ""
                        if (sha.isEmpty()) {
                            emit("checkpoint", JSONObject().put("ok", true).put("skipped", out.contains("NONE")).put("id", id))
                        } else {
                            try {
                                java.io.File(Runtime.home(this@MainActivity, u), ".ocm/checkpoints/index.tsv").appendText(
                                    id + "\t" + sha + "\t" + dir + "\t" + label.replace('\t', ' ').replace('\n', ' ') + "\n"
                                )
                            } catch (_: Exception) {}
                            emit("checkpoint", JSONObject().put("ok", true).put("id", id).put("sha", sha))
                        }
                    } catch (e: Exception) {
                        emit("checkpoint", JSONObject().put("ok", false).put("err", e.message ?: "failed"))
                    }
                }
                JSONObject().put("ok", true).put("queued", true).toString()
            }
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("err", e.message ?: "failed").toString()
        }

        @JavascriptInterface fun checkpointList(): String = try {
            val u = uid()
            val meta = java.io.File(Runtime.home(this@MainActivity, u), ".ocm/checkpoints/index.tsv")
            val arr = org.json.JSONArray()
            if (meta.isFile) {
                meta.readLines().filter { it.isNotBlank() }.takeLast(200).reversed().forEach { line ->
                    val p = line.split('\t')
                    if (p.size >= 3) arr.put(JSONObject().put("id", p[0]).put("sha", p[1]).put("dir", p[2]).put("label", if (p.size > 3) p[3] else ""))
                }
            }
            JSONObject().put("ok", true).put("items", arr).toString()
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("err", e.message ?: "failed").toString()
        }

        /** Restores the working tree of `dir` to a checkpoint (tracked files only). */
        @JavascriptInterface fun checkpointRestore(dir: String, sha: String): String = try {
            val u = uid()
            if (!Runtime.isInstalled(this@MainActivity)) JSONObject().put("ok", false).put("err", "runtime not installed").toString()
            else {
                val q = { a: String -> "'" + a.replace("'", "'\\''") + "'" }
                val script = buildString {
                    append("export GIT_DIR=/root/.ocm/checkpoints/repo GIT_WORK_TREE=").append(q(dir.ifEmpty { "/root" }))
                    append(" GIT_TERMINAL_PROMPT=0 GIT_PAGER=cat LC_ALL=C; ")
                    append("git checkout -f ").append(q(sha)).append(" -- . 2>&1; ")
                    append("git clean -fdq 2>&1; ")
                    append("echo RESTORED")
                }
                val p = Runtime.prootCmd(this@MainActivity, u, listOf("/bin/sh", "-c", script))
                val out = p.inputStream.bufferedReader().use { it.readText() }
                val done = p.waitFor(120, java.util.concurrent.TimeUnit.SECONDS)
                if (!done) try { p.destroyForcibly() } catch (_: Exception) {}
                JSONObject().put("ok", done && out.contains("RESTORED")).put("out", out.takeLast(4000)).toString()
            }
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("err", e.message ?: "failed").toString()
        }

        @JavascriptInterface fun autoBackupState(): String = try {
            JSONObject().put("enabled", Prefs.flag(this@MainActivity, "auto_backup", false))
                .put("intervalHours", Prefs.get(this@MainActivity, "auto_backup_hours", "24"))
                .put("hasPassword", Prefs.get(this@MainActivity, "auto_backup_pw").isNotEmpty())
                .toString()
        } catch (e: Exception) { JSONObject().put("enabled", false).toString() }

        @JavascriptInterface fun autoBackupConfigure(enabled: Boolean, hours: Int, password: String): String = try {
            if (password.isNotEmpty()) Prefs.put(this@MainActivity, "auto_backup_pw", password)
            Prefs.putFlag(this@MainActivity, "auto_backup", enabled)
            Prefs.put(this@MainActivity, "auto_backup_hours", hours.coerceIn(6, 168).toString())
            val ctx = this@MainActivity
            val req = androidx.work.PeriodicWorkRequestBuilder<BackupWorker>(
                hours.coerceIn(6, 168).toLong(), java.util.concurrent.TimeUnit.HOURS
            ).build()
            val wm = androidx.work.WorkManager.getInstance(ctx)
            if (enabled) {
                wm.enqueueUniquePeriodicWork(
                    BackupWorker.UNIQUE,
                    androidx.work.ExistingPeriodicWorkPolicy.UPDATE,
                    req
                )
            } else {
                wm.cancelUniqueWork(BackupWorker.UNIQUE)
            }
            JSONObject().put("ok", true).toString()
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("err", e.message ?: "failed").toString()
        }

        @JavascriptInterface fun autoBackupNow(password: String): String = try {
            val home = Runtime.home(this@MainActivity, uid())
            val out = Backup.runAutoBackup(this@MainActivity, uid(), password.ifEmpty { Prefs.get(this@MainActivity, "auto_backup_pw") })
            JSONObject().put("ok", true).put("path", out.absolutePath).put("size", out.length()).toString()
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("err", e.message ?: "failed").toString()
        }

        @JavascriptInterface fun backupProfile(password: String): String = try {
            val home = Runtime.home(this@MainActivity, uid())
            val dir = Backup.backupDir(this@MainActivity)
            val out = File(dir, "OCM-backup-" + System.currentTimeMillis() + ".ocmbak")
            Backup.backupZip(home, out, password)
            JSONObject().put("ok", true).put("path", out.absolutePath).put("size", out.length()).toString()
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("err", e.message ?: "failed").toString()
        }

        @JavascriptInterface fun restoreProfile(password: String, path: String): String = try {
            val home = Runtime.home(this@MainActivity, uid())
            val src = File(path.ifEmpty { File(cacheDir, "restore.ocmbak").absolutePath })
            if (!src.exists()) JSONObject().put("ok", false).put("err", "backup file not found").toString()
            else {
                Backup.restoreZip(src, home, password)
                JSONObject().put("ok", true).put("path", src.absolutePath).toString()
            }
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("err", e.message ?: "failed").toString()
        }

        // --- clipboard / share / links ---
        @JavascriptInterface fun copy(text: String) {
            runOnUiThread { (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("OpenCode", text)) }
        }

        @JavascriptInterface fun pasteText(): String = try {
            (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).primaryClip?.getItemAt(0)?.coerceToText(this@MainActivity)?.toString() ?: ""
        } catch (_: Exception) { "" }

        @JavascriptInterface fun share(text: String) {
            runOnUiThread {
                val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text.take(400_000))
                startActivity(Intent.createChooser(send, null))
            }
        }

        @JavascriptInterface fun openLink(url: String) { runOnUiThread { openExternal(Uri.parse(url)) } }

        @JavascriptInterface fun openApp(target: String): Boolean = this@MainActivity.launchApp(target)

        @JavascriptInterface fun preparePreview(path: String): String = this@MainActivity.prepareWebPreview(path)

        // --- OTA ---
        @JavascriptInterface fun checkUpdates() {
            thread {
                val o = JSONObject()
                try {
                    val a = Updater.latestApp()
                    if (a != null && a.code > BuildConfig.VERSION_CODE) o.put("app", JSONObject().put("name", a.name))
                } catch (e: Exception) { o.put("error", e.message ?: "offline") }
                try {
                    val t = Updater.latestCore()
                    if (t != null && t != Updater.installedCore(this@MainActivity)) o.put("core", t)
                } catch (e: Exception) { o.put("error", e.message ?: "offline") }
                emit("update", o)
            }
        }

        @JavascriptInterface fun applyAppUpdate() {
            thread {
                try {
                    if (!packageManager.canRequestPackageInstalls()) {
                        grant("install"); emit("update", JSONObject().put("error", "Allow installing apps, then try again")); return@thread
                    }
                    val a = Updater.latestApp() ?: throw IllegalStateException("No release found")
                    val f = Updater.downloadApp(this@MainActivity, a) { emit("update", JSONObject().put("pct", it).put("what", "app")) }
                    runOnUiThread { Updater.installApk(this@MainActivity, f) }
                } catch (e: Exception) { emit("update", JSONObject().put("error", e.message ?: "failed")) }
            }
        }

        @JavascriptInterface fun applyCoreUpdate() {
            thread {
                try {
                    val tag = Updater.latestCore() ?: throw IllegalStateException("No 1.x release found")
                    Updater.updateCore(this@MainActivity, tag) { emit("update", JSONObject().put("pct", it).put("what", "core")) }
                    emit("update", JSONObject().put("coreDone", tag))
                    restartServer()
                } catch (e: Exception) { emit("update", JSONObject().put("error", e.message ?: "failed")) }
            }
        }
    }

    companion object {
        val FLAG_KEYS = listOf("snd_done", "snd_action", "snd_quota", "noseccomp", "overlay_only_busy")
    }
}
