package app.opencode_by_omma

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread

/**
 * Tiny loopback HTTP endpoint that lets the agent inside proot ask the app to generate media.
 *
 * Why a socket and not a bridge call: the agent only has `bash`, so the only reliable way for it to
 * reach the UI is a URL. The endpoint answers one small JSON request at a time, forwards it to the
 * WebView (which owns the provider keys and the queue), and waits for the answer.
 *
 * The port and a random token are written to `/root/.ocm/media.json` inside the profile, so the
 * agent (and a helper script) can find them; the token prevents any other app on the device from
 * using the endpoint.
 */
object MediaServer {
    @Volatile private var server: ServerSocket? = null
    @Volatile private var running = false
    @Volatile var port = 0
        private set
    @Volatile var token = ""
        private set

    /** request id -> callback waiting for the UI's answer. */
    private val pending = ConcurrentHashMap<String, (JSONObject) -> Unit>()

    fun start(c: Context, emit: (String, JSONObject) -> Unit) {
        if (running) { writeInfo(c); return }
        token = ByteArray(16).let { b ->
            java.security.SecureRandom().nextBytes(b)
            b.joinToString("") { "%02x".format(it) }
        }
        val ss = try { ServerSocket(0, 16, InetAddress.getByName("127.0.0.1")) } catch (_: Exception) { return }
        port = ss.localPort
        server = ss
        running = true
        writeInfo(c)
        thread(isDaemon = true) {
            while (running) {
                val sock = try { ss.accept() } catch (_: Exception) { break }
                thread(isDaemon = true) { handle(sock, emit) }
            }
        }
    }

    fun stop() {
        running = false
        try { server?.close() } catch (_: Exception) {}
        server = null
    }

    /** Called from the bridge when the UI finished a job. */
    fun answer(id: String, payload: JSONObject) {
        pending.remove(id)?.invoke(payload)
    }

    private fun writeInfo(c: Context) {
        try {
            val home = Runtime.home(c, Prefs.get(c, "uid"))
            val f = File(home, ".ocm/media.json")
            f.parentFile?.mkdirs()
            f.writeText(JSONObject().put("port", port).put("token", token).toString())
            // Helper script: `media-gen image "a red fox" [model]`
            val bin = File(home, "bin")
            bin.mkdirs()
            val script = File(bin, "media-gen")
            // The script is shell code, not a Kotlin template: `$` is written as § first and
            // substituted at the end, because a raw Kotlin string cannot escape a dollar sign.
            val sh = """
                |#!/bin/sh
                |# Ask the OpenCode Mobile media factory to generate something.
                |# Usage: media-gen <image|video|tts|music> <prompt> [model]
                |INFO="§HOME/.ocm/media.json"
                |[ -f "§INFO" ] || { echo 'media factory is not running' >&2; exit 1; }
                |PORT=§(sed -n 's/.*"port":\([0-9]*\).*/\1/p' "§INFO")
                |TOKEN=§(sed -n 's/.*"token":"\([a-f0-9]*\)".*/\1/p' "§INFO")
                |KIND="§1"; shift
                |PROMPT="§1"; shift
                |MODEL="§1"
                |BODY=§(python3 -c 'import json,sys;print(json.dumps({"kind":sys.argv[1],"prompt":sys.argv[2],"model":sys.argv[3]}))' "§KIND" "§PROMPT" "§MODEL")
                |curl -s --max-time 900 -X POST "http://127.0.0.1:§PORT/generate" \
                |  -H "X-OCM-Token: §TOKEN" -H 'Content-Type: application/json' -d "§BODY"
                |""".trimMargin().replace("§", "$")
            script.writeText(sh + "\n")
            try { android.system.Os.chmod(script.path, 0x1ED) } catch (_: Exception) {}
        } catch (_: Exception) {}
    }

    private fun handle(sock: java.net.Socket, emit: (String, JSONObject) -> Unit) {
        sock.use { s ->
            try {
                s.soTimeout = 900_000
                val input = s.getInputStream().bufferedReader()
                val requestLine = input.readLine() ?: return
                val parts = requestLine.split(" ")
                var contentLength = 0
                var givenToken = ""
                while (true) {
                    val line = input.readLine() ?: break
                    if (line.isEmpty()) break
                    val i = line.indexOf(':')
                    if (i <= 0) continue
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
                if (path != "/generate" || parts.getOrNull(0) != "POST") {
                    reply(404, JSONObject().put("ok", false).put("err", "not found").toString()); return
                }
                // Cap the request body: this listener is reachable by any local process, and an
                // arbitrary Content-Length used to allow multi-gigabyte allocations.
                if (contentLength > 4 * 1024 * 1024) {
                    reply(413, JSONObject().put("ok", false).put("err", "body too large").toString()); return
                }
                val buf = CharArray(contentLength.coerceAtLeast(0))
                var read = 0
                while (read < buf.size) {
                    val n = input.read(buf, read, buf.size - read)
                    if (n <= 0) break
                    read += n
                }
                val req = try { JSONObject(String(buf, 0, read)) } catch (_: Exception) { JSONObject() }
                val id = "media-" + System.currentTimeMillis().toString(36)
                // The callback runs on the UI/emit thread while this thread polls: a plain Boolean
                // gave no visibility guarantee and could time out a request that was answered.
                val answered = java.util.concurrent.atomic.AtomicBoolean(false)
                val done = java.util.concurrent.atomic.AtomicBoolean(false)
                pending[id] = { res ->
                    if (done.compareAndSet(false, true)) {
                        answered.set(true)
                        reply(200, res.toString())
                    }
                }
                emit("mediaRequest", JSONObject().put("id", id).put("kind", req.optString("kind", "image"))
                    .put("prompt", req.optString("prompt", "")).put("model", req.optString("model", "")))
                val deadline = System.currentTimeMillis() + 890_000
                while (!answered.get() && System.currentTimeMillis() < deadline) Thread.sleep(200)
                if (!answered.get() && done.compareAndSet(false, true)) {
                    pending.remove(id)
                    reply(504, JSONObject().put("ok", false).put("err", "timeout").toString())
                }
            } catch (_: Exception) {}
        }
    }
}