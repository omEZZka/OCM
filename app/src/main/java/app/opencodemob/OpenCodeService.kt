package app.opencodemob

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.app.ServiceCompat
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/** Keeps `opencode serve` alive in the background and turns its events into sounds/notifications. */
class OpenCodeService : Service() {
    private var proc: Process? = null
    private var worker: Thread? = null
    private var watcher: Thread? = null
    private var wake: PowerManager.WakeLock? = null
    @Volatile private var stopping = false
    private var lastIdle = 0L

    override fun onBind(i: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "stop") { stopSelf(); return START_NOT_STICKY }
        Notifier.ensureChannels(this)
        ServiceCompat.startForeground(
            this, 1, Notifier.runtime(this, "Запуск"),
            if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        )
        val uid = intent?.getStringExtra("uid") ?: Prefs.get(this, "uid")
        if (uid.isEmpty()) { stopSelf(); return START_NOT_STICKY }
        if (worker?.isAlive != true) worker = thread { runLoop(uid) }
        return START_STICKY
    }

    private fun runLoop(uid: String) {
        wake = (getSystemService(POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "opencode:server").apply { acquire() }
        var attempt = 0
        while (!stopping && attempt < 4) {
            val t0 = SystemClock.elapsedRealtime()
            val port = Runtime.stablePort(this)
            val pw = Runtime.stablePassword(this)
            // two failed starts in a row -> retry without the seccomp fast path (slower, but works on odd kernels)
            val noSeccomp = Prefs.flag(this, "noseccomp", false) || attempt >= 2
            ServerState.ready = false
            ServerState.phase = "proxy"
            try { ProxyShim.start(this, uid) } catch (_: Exception) {}
            ServerState.phase = "starting"
            val p = try { Runtime.startServer(this, uid, port, pw, noSeccomp) } catch (e: Exception) {
                ServerState.error = e.message ?: e.toString(); break
            }
            proc = p
            val log = File(filesDir, "server.log")
            thread(isDaemon = true) { try { p.inputStream.copyTo(FileOutputStream(log, false)) } catch (_: Exception) {} }
            ServerState.phase = "waiting"
            val ok = Runtime.waitReady(p, port, pw, 35_000)
            if (ok) {
                ServerState.port = port; ServerState.password = pw
                ServerState.error = null; ServerState.ready = true
                ServerState.phase = "ready"
                Notifier.updateRuntime(this, "Работает")
                WidgetUpdater.idle(this)
                ServerTileService.sync(this)
                startWatcher(port, pw)
                p.waitFor()
                ServerState.ready = false
                ServerState.phase = "down"
                ServerTileService.sync(this)
            } else {
                if (!p.isAlive) {
                    val code = try { p.exitValue() } catch (_: Exception) { -1 }
                    val logTail = try {
                        val lf = File(filesDir, "server.log")
                        if (lf.exists()) lf.readLines().takeLast(8).joinToString("\n") else ""
                    } catch (_: Exception) { "" }
                    ServerState.error = "OpenCode завершился с ошибкой ($code)" + (if (logTail.isNotEmpty()) ":\n$logTail" else "")
                    // Auto-heal config if startup crashed
                    Runtime.sanitizeConfig(this, uid, forceReset = (attempt >= 1))
                }
                p.destroy()
            }
            attempt = if (SystemClock.elapsedRealtime() - t0 > 60_000) 0 else attempt + 1
        }
        if (!stopping && ServerState.error == null) {
            val logTail = try {
                val lf = File(filesDir, "server.log")
                if (lf.exists()) lf.readLines().takeLast(8).joinToString("\n") else ""
            } catch (_: Exception) { "" }
            ServerState.error = "Не удалось запустить сервер OpenCode" + (if (logTail.isNotEmpty()) ":\n$logTail" else "")
        }
    }

    @Volatile private var watcherGen = 0
    @Volatile private var watcherConn: HttpURLConnection? = null

    private fun startWatcher(port: Int, pw: String) {
        // Interrupting the previous thread does not unblock a socket read, so an old watcher could
        // survive a restart and keep sending duplicate notifications. Bump a generation and close
        // its connection instead.
        val gen = ++watcherGen
        try { watcherConn?.disconnect() } catch (_: Exception) {}
        watcher?.interrupt()
        watcher = thread(isDaemon = true) {
            while (!stopping && ServerState.ready && gen == watcherGen) {
                try {
                    val c = URL("http://127.0.0.1:$port/global/event").openConnection() as HttpURLConnection
                    c.setRequestProperty("Authorization", Runtime.basic(pw))
                    c.setRequestProperty("Accept", "text/event-stream")
                    c.connectTimeout = 3000; c.readTimeout = 0
                    watcherConn = c
                    c.inputStream.bufferedReader().forEachLine { l -> if (l.startsWith("data:") && gen == watcherGen) onEvent(l.substring(5).trim()) }
                } catch (_: Exception) {}
                try { Thread.sleep(2000) } catch (_: InterruptedException) { return@thread }
            }
            if (gen == watcherGen) try { watcherConn?.disconnect() } catch (_: Exception) {}
        }
    }

    private val quotaRe = Regex("(?i)quota|usage.?limit|rate.?limit|limit\\s+reached|insufficient|exceeded|credit|\\b429\\b")

    /** Best-effort human title for a session, used in notifications. */
    private val titleCache = java.util.concurrent.ConcurrentHashMap<String, String>()
    private fun cleanTitle(t: String): String =
        if (t.isEmpty() || Regex("(?i)^(New session|Child session|Новая сессия)").containsMatchIn(t)) "" else t
    private fun sessionTitle(sid: String): String {
        if (sid.isEmpty()) return ""
        titleCache[sid]?.let { return it }
        if (titleCache.size > 200) titleCache.clear() // unbounded growth over weeks of use
        val t = try {
            val port = ServerState.port
            if (port <= 0) return ""
            val c = URL("http://127.0.0.1:$port/session/$sid").openConnection() as HttpURLConnection
            c.setRequestProperty("Authorization", Runtime.basic(ServerState.password))
            // Short: this runs on the SSE watcher thread, so a slow lookup stalls every other event.
            c.connectTimeout = 1200; c.readTimeout = 1200
            val txt = c.inputStream.bufferedReader().use { it.readText() }
            JSONObject(txt).optString("title")
        } catch (_: Exception) { "" }
        val clean = cleanTitle(t)
        if (clean.isNotEmpty()) titleCache[sid] = clean
        return clean
    }

    private fun onEvent(json: String) {
        val root = try { JSONObject(json) } catch (_: Exception) { return }
        val o = root.optJSONObject("payload") ?: root
        val type = o.optString("type")
        val props = o.optJSONObject("properties") ?: o
        val sid = props.optString("sessionID").ifEmpty { o.optString("sessionID") }
        val permId = props.optString("permissionID").ifEmpty { if (type.startsWith("permission.")) props.optString("id") else "" }
        val qId = props.optString("questionID").ifEmpty { if (type.startsWith("question.")) props.optString("id") else "" }
        when {
            type == "session.status" -> {
                val rawStatus = props.opt("status")
                val st = when (rawStatus) {
                    is String -> rawStatus
                    is JSONObject -> rawStatus.optString("type")
                    else -> props.optString("type")
                }
                if (st == "busy" || st == "running" || st == "retry") {
                    val title = props.optString("title").ifEmpty { "Задача выполняется" }
                    WidgetUpdater.set(this, title, if (sid.isNotEmpty()) "Сессия ${sid.take(8)}" else "OpenCode работает", true)
                    // The UI publishes MM progress in Prefs; mirror it into a determinate notification.
                    val mmDone = Prefs.get(this, "overlay_jobs", "").split(',').count { it == "done" }
                    val mmAll = Prefs.get(this, "overlay_jobs", "").split(',').count { it.isNotBlank() }
                    if (mmAll > 0) Notifier.progress(this, Prefs.get(this, "overlay_phase", ""), mmDone, mmAll, sid)
                } else if (st == "idle") {
                    WidgetUpdater.idle(this)
                    Notifier.cancelProgress(this)
                }
            }
            type == "session.idle" -> {
                val now = SystemClock.elapsedRealtime()
                if (now - lastIdle > 3000) {
                    lastIdle = now
                    Notifier.event(this, Notifier.DONE, "Задача завершена", "OpenCode завершил работу.", sessionId = sid, sessionTitle = sessionTitle(sid))
                }
                WidgetUpdater.idle(this)
            }
            type == "question.asked" || (type.startsWith("permission.") && (type.endsWith("updated") || type.endsWith("asked"))) ->
                Notifier.event(this, Notifier.ACTION, "Требуется действие", "OpenCode ждёт вашего ответа или подтверждения.", sessionId = sid, sessionTitle = sessionTitle(sid), permissionId = permId, questionId = qId)
            type == "session.error" && quotaRe.containsMatchIn(o.toString()) ->
                Notifier.event(this, Notifier.QUOTA, "Квота исчерпана", "Лимит модели исчерпан. Подключите свой ключ: Настройки → Модели → Подключить провайдера.", sessionId = sid, sessionTitle = sessionTitle(sid))
        }
    }

    override fun onDestroy() {
        stopping = true
        ServerState.ready = false
        watcherGen++
        try { watcherConn?.disconnect() } catch (_: Exception) {}
        watcher?.interrupt()
        proc?.destroy()
        try { ProxyShim.stop() } catch (_: Exception) {}
        try { wake?.release() } catch (_: Exception) {}
        ServerTileService.sync(this)
        super.onDestroy()
    }
}
