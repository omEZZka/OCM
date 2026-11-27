package app.opencode_by_omma

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread

/**
 * Loopback HTTP endpoint that lets the agent (inside proot, bash-only) control the phone
 * WITHOUT ADB: taps, swipes, text search, screenshots, flashlight, DND, apps.
 *
 * Port + token live in /root/.ocm/phone.json; the `phone` CLI reads them.
 * Every mutating request can require user confirmation (configurable) — the UI shows a card.
 */
object PhoneServer {
    @Volatile private var server: ServerSocket? = null
    @Volatile private var running = false
    @Volatile var port = 0
        private set
    @Volatile var token = ""
        private set

    private val pending = ConcurrentHashMap<String, (JSONObject) -> Unit>()

    fun start(c: Context, emit: (String, JSONObject) -> Unit) {
        if (running) { writeInfo(c); return }
        token = ByteArray(16).let { b -> java.security.SecureRandom().nextBytes(b); b.joinToString("") { "%02x".format(it) } }
        val ss = try { ServerSocket(0, 16, InetAddress.getByName("127.0.0.1")) } catch (_: Exception) { return }
        port = ss.localPort
        server = ss
        running = true
        writeInfo(c)
        thread(isDaemon = true) {
            while (running) {
                val sock = try { ss.accept() } catch (_: Exception) { break }
                thread(isDaemon = true) { handle(c, sock, emit) }
            }
        }
    }

    fun stop() {
        running = false
        try { server?.close() } catch (_: Exception) {}
        server = null
    }

    fun answer(id: String, payload: JSONObject) { pending.remove(id)?.invoke(payload) }

    private fun writeInfo(c: Context) {
        try {
            val home = Runtime.home(c, Prefs.get(c, "uid"))
            val f = File(home, ".ocm/phone.json")
            f.parentFile?.mkdirs()
            f.writeText(JSONObject().put("port", port).put("token", token).toString())
            val bin = File(home, "bin"); bin.mkdirs()
            val script = File(bin, "phone")
            val S = "$"
            val sh = """
                |#!/bin/sh
                |# Phone control without ADB. Usage:
                |#   phone status
                |#   phone open <app|package>
                |#   phone tap <x> <y> | phone swipe <x1> <y1> <x2> <y2> [ms]
                |#   phone text "<visible text>"      (tap by text)
                |#   phone type "<text>"              (into focused field)
                |#   phone screen                     (visible texts JSON)
                |#   phone shot [path]                (screenshot; auto-attached to the agent's next prompt)
                |#   phone see ["question"]           (screenshot + immediate vision analysis; returns description)
                |#   phone back|home|recents|notifications|quicksettings
                |#   phone torch on|off
                |#   phone dnd off|priority|silent
                |#   phone volume media <0-15>
                |#   phone find "<text>"             (smart tap: fuzzy+translit+scroll+verify)
                |#   phone scroll down|up
                |#   phone waittext "<text>" [ms]
                |INFO="§HOME/.ocm/phone.json"
                |[ -f "§INFO" ] || { echo 'phone bridge is not running' >&2; exit 1; }
                |PORT=§(sed -n 's/.*"port":\([0-9]*\).*/\1/p' "§INFO")
                |TOKEN=§(sed -n 's/.*"token":"\([a-f0-9]*\)".*/\1/p' "§INFO")
                |CMD="§1"; shift 2>/dev/null || true
                |ARGS=§(python3 -c 'import json,sys;print(json.dumps(sys.argv[1:]))' "§@")
                |BODY=§(python3 -c 'import json,sys;print(json.dumps({"cmd":sys.argv[1],"args":json.loads(sys.argv[2])}))' "§CMD" "§ARGS")
                |curl -s --max-time 120 -X POST "http://127.0.0.1:§PORT/phone" \
                |  -H "X-OCM-Token: §TOKEN" -H 'Content-Type: application/json' -d "§BODY"
                |""".trimMargin().replace("§", S)
            script.writeText(sh + "\n")
            try { android.system.Os.chmod(script.path, 0x1ED) } catch (_: Exception) {}
        } catch (_: Exception) {}
    }

    private fun handle(c: Context, sock: java.net.Socket, emit: (String, JSONObject) -> Unit) {
        sock.use { s ->
            try {
                s.soTimeout = 120_000
                val input = s.getInputStream().bufferedReader()
                val requestLine = input.readLine() ?: return
                val parts = requestLine.split(" ")
                var contentLength = 0
                var givenToken = ""
                while (true) {
                    val line = input.readLine() ?: break
                    if (line.isEmpty()) break
                    val i = line.indexOf(':'); if (i <= 0) continue
                    val k = line.substring(0, i).trim().lowercase()
                    val v = line.substring(i + 1).trim()
                    if (k == "content-length") contentLength = v.toIntOrNull() ?: 0
                    if (k == "x-ocm-token") givenToken = v
                }
                fun reply(code: Int, body: String) {
                    val out = s.getOutputStream()
                    val bytes = body.toByteArray()
                    out.write(("HTTP/1.1 $code OK\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n").toByteArray())
                    out.write(bytes); out.flush()
                }
                if (givenToken != token) { reply(401, JSONObject().put("ok", false).put("err", "bad token").toString()); return }
                val path = parts.getOrNull(1)?.substringBefore('?') ?: ""
                if (path != "/phone" || parts.getOrNull(0) != "POST") { reply(404, JSONObject().put("ok", false).put("err", "not found").toString()); return }
                if (contentLength > 1024 * 1024) { reply(413, JSONObject().put("ok", false).put("err", "body too large").toString()); return }
                val buf = CharArray(contentLength.coerceAtLeast(0))
                var read = 0
                while (read < buf.size) { val n = input.read(buf, read, buf.size - read); if (n <= 0) break; read += n }
                val req = try { JSONObject(String(buf, 0, read)) } catch (_: Exception) { JSONObject() }
                val id = "ph-" + System.currentTimeMillis().toString(36) + (100..999).random()
                val answered = java.util.concurrent.atomic.AtomicBoolean(false)
                val done = java.util.concurrent.atomic.AtomicBoolean(false)
                pending[id] = { res -> if (done.compareAndSet(false, true)) { answered.set(true); reply(200, res.toString()) } }
                emit("phoneRequest", JSONObject().put("id", id).put("cmd", req.optString("cmd", "")).put("args", req.optJSONArray("args") ?: org.json.JSONArray()))
                val deadline = System.currentTimeMillis() + 110_000
                while (!answered.get() && System.currentTimeMillis() < deadline) Thread.sleep(150)
                if (!answered.get() && done.compareAndSet(false, true)) {
                    pending.remove(id)
                    reply(504, JSONObject().put("ok", false).put("err", "timeout").toString())
                }
            } catch (_: Exception) {}
        }
    }
}
