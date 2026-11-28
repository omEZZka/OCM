package app.opencode_by_omma

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

    override fun onBind(i: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "stop") { stopSelf(); return START_NOT_STICKY }
        Notifier.ensureChannels(this)
        // WARP stays off unless the user explicitly enabled it; only then load its state,
        // start the proxy gate and let the service react to quota-driven IP rotation.
        if (Runtime.warpEnabled(this)) WarpManager.init(this)
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
        // Giving up must not leave a wake lock behind for days: that drained the battery after every
        // failed start. stopSelf() also suppresses the START_STICKY restart, which would otherwise
        // loop the same failing start forever; the UI's "start" button launches a fresh instance.
        if (!stopping) {
            ServerState.ready = false
            ServerState.phase = "down"
            try { ProxyShim.stop() } catch (_: Exception) {}
            try { wake?.release() } catch (_: Exception) {}
            wake = null
            Notifier.updateRuntime(this, "Остановлен: " + (ServerState.error ?: "ошибка запуска").lineSequence().first())
            ServerTileService.sync(this)
            stopSelf()
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

    // Only real provider quota/limit errors. Generic rate-limit/429 patterns matched transient
    // retries of a WORKING model and fired "quota exhausted" while the answer kept streaming.
    private val quotaRe = Regex("(?i)FreeUsageLimitError|GoUsageLimitError|BudgetLimitError|insufficient_quota|insufficient credit|quota\\s+(exceeded|exhausted)|billing.{0,20}(limit|hard)")
    private val notQuotaRe = Regex("(?i)ContextOverflow|OutputLength|MessageAborted")
    // One quota alert per burst: the core emits session.error for every retry attempt.
    private var lastQuotaNotif = 0L
    // DONE notifications: session.idle fires after EVERY tool round and for every MM child
    // session — not only when the user's task actually finished. Track busy periods per session,
    // require a real assistant answer in the period, debounce per session, and skip child sessions
    // while their parent is still working.
    private val busySince = java.util.concurrent.ConcurrentHashMap<String, Long>()
    private val sawAnswer = java.util.concurrent.ConcurrentHashMap<String, Boolean>()
    private val lastDone = java.util.concurrent.ConcurrentHashMap<String, Long>()
    private val lastUserPrompt = java.util.concurrent.ConcurrentHashMap<String, Long>()
    private val parentOf = java.util.concurrent.ConcurrentHashMap<String, String>()
    // Sessions that must NEVER produce a DONE notification: internal side tasks (AI pack titles,
    // summaries, TOC, smart search, duels, second opinions) and MM role children. The UI marks
    // them via the 'silent_session' bridge flag; title patterns are a safety net for older UIs.
    private val silentSessions = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
    private val sideTitleRe = Regex("(?i)^(OCM side task|Duel ·|Opinion ·|Child session)")
    companion object {
        private val silentStatic = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
        /** UI marks internal side-task sessions so they never fire DONE notifications. */
        @JvmStatic fun markSilentSession(sid: String) {
            if (sid.isEmpty()) return
            silentStatic.add(sid)
            if (silentStatic.size > 400) silentStatic.clear()
        }
    }
    private fun isSilent(sid: String): Boolean {
        if (silentStatic.contains(sid)) return true
        if (parentOf.containsKey(sid)) return true // any child session: parent owns the DONE
        val t = titleCache[sid] ?: ""
        return sideTitleRe.containsMatchIn(t)
    }

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
            type == "session.updated" || type == "session.created" -> {
                val info = props.optJSONObject("info")
                if (info != null) {
                    val id = info.optString("id")
                    val parent = info.optString("parentID")
                    if (id.isNotEmpty()) {
                        if (parent.isNotEmpty()) parentOf[id] = parent else parentOf.remove(id)
                        val t = cleanTitle(info.optString("title"))
                        if (t.isNotEmpty()) titleCache[id] = t
                    }
                }
            }
            type == "message.updated" -> {
                // a USER message = the user actually asked something in this session
                val info = props.optJSONObject("info")
                if (info != null && info.optString("role") == "user") {
                    val msid = info.optString("sessionID").ifEmpty { sid }
                    if (msid.isNotEmpty()) {
                        if (lastUserPrompt.size > 300) lastUserPrompt.clear()
                        lastUserPrompt[msid] = SystemClock.elapsedRealtime()
                    }
                }
            }
            type == "message.part.updated" || type == "message.part.delta" -> {
                // a text part with actual content = the model produced an answer this period
                val part = props.optJSONObject("part")
                val psid = part?.optString("sessionID") ?: sid
                val ptype = part?.optString("type") ?: ""
                val txt = part?.optString("text") ?: props.optString("delta")
                if (psid.isNotEmpty() && (ptype == "text" || props.optString("field") == "text") && txt.isNotBlank()) {
                    sawAnswer[psid] = true
                }
            }
            type == "session.status" -> {
                val rawStatus = props.opt("status")
                val st = when (rawStatus) {
                    is String -> rawStatus
                    is JSONObject -> rawStatus.optString("type")
                    else -> props.optString("type")
                }
                if (st == "busy" || st == "running" || st == "retry") {
                    if (sid.isNotEmpty() && !busySince.containsKey(sid)) {
                        busySince[sid] = SystemClock.elapsedRealtime()
                        sawAnswer.remove(sid)
                    }
                    val title = props.optString("title").ifEmpty { "Задача выполняется" }
                    WidgetUpdater.set(this, title, if (sid.isNotEmpty()) "Сессия ${sid.take(8)}" else "OpenCode работает", true)
                    // The UI publishes MM progress in Prefs; mirror it into a determinate notification.
                    val mmDone = Prefs.get(this, "overlay_jobs", "").split(',').count { it == "done" }
                    val mmAll = Prefs.get(this, "overlay_jobs", "").split(',').count { it.isNotBlank() }
                    if (mmAll > 0) Notifier.progress(this, Prefs.get(this, "overlay_phase", ""), mmDone, mmAll, sid)
                } else if (st == "idle") {
                    maybeDone(sid)
                    WidgetUpdater.idle(this)
                    Notifier.cancelProgress(this)
                }
            }
            type == "session.idle" -> {
                maybeDone(sid)
                WidgetUpdater.idle(this)
            }
            type == "question.asked" || (type.startsWith("permission.") && (type.endsWith("updated") || type.endsWith("asked"))) ->
                Notifier.event(this, Notifier.ACTION, "Требуется действие", "OpenCode ждёт вашего ответа или подтверждения.", sessionId = sid, sessionTitle = sessionTitle(sid), permissionId = permId, questionId = qId)
            type == "session.error" -> {
                val err = props.optJSONObject("error")
                val errJson = err?.toString() ?: ""
                if (err != null && !notQuotaRe.containsMatchIn(errJson) && quotaRe.containsMatchIn(errJson)) {
                    val now = SystemClock.elapsedRealtime()
                    if (now - lastQuotaNotif > 60_000) {
                        lastQuotaNotif = now
                        if (WarpManager.isAutoRotateEnabled() && WarpManager.isProxied()) {
                            // WARP rotation is on: tell the user the exit IP is being changed.
                            Notifier.ipRotated(this, "Обнаружен лимит квоты. Выполняется ротация IP через WARP.", sid, sessionTitle(sid))
                        } else {
                            Notifier.event(this, Notifier.QUOTA, "Квота исчерпана", "Лимит модели исчерпан. Подключите свой ключ: Настройки → Модели → Подключить провайдера.", sessionId = sid, sessionTitle = sessionTitle(sid))
                        }
                    }
                }
            }
        }
    }

    /**
     * "Task completed" only when a real work period ends: the session was busy, the model actually
     * answered, no busy parent (MM child), and at most one notification per 8s per session.
     * A tool round finishing mid-task no longer fires DONE.
     */
    private fun maybeDone(sid: String) {
        if (sid.isEmpty()) return
        val started = busySince.remove(sid) ?: return
        val answered = sawAnswer.remove(sid) == true
        val now = SystemClock.elapsedRealtime()
        // a period shorter than 2s with no answer is a tool blip, not a finished task
        if (!answered && now - started < 2000) return
        if (!answered) return
        // internal side tasks and MM children never notify "task completed"
        if (isSilent(sid)) return
        // MM child sessions: the parent is still working — the task is NOT done
        val parent = parentOf[sid]
        if (parent != null && busySince.containsKey(parent)) return
        // The user must have actually prompted this session recently: a spontaneous idle with an
        // old answer (server housekeeping, compaction, title generation) is not a finished task.
        val prompted = lastUserPrompt[sid] ?: 0L
        if (prompted == 0L || now - prompted > 30 * 60_000L) return
        val last = lastDone[sid] ?: 0L
        if (now - last < 8000) return
        if (lastDone.size > 200) lastDone.clear()
        lastDone[sid] = now
        Notifier.event(this, Notifier.DONE, "Задача завершена", "OpenCode завершил работу.", sessionId = sid, sessionTitle = sessionTitle(sid))
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
