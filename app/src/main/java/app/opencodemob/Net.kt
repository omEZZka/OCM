package app.opencodemob

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * All traffic between the bundled UI and the local opencode server goes through here.
 * The UI never sees the port or the password, and needs no CORS or mixed-content tricks.
 */
object Net {
    private val http = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS).readTimeout(15, TimeUnit.MINUTES).writeTimeout(60, TimeUnit.SECONDS).build()
    private val stream = http.newBuilder().readTimeout(0, TimeUnit.SECONDS).pingInterval(20, TimeUnit.SECONDS).build()
    private val pool = Executors.newCachedThreadPool()
    private val sockets = ConcurrentHashMap<String, WebSocket>()
    @Volatile private var sseGen = 0
    @Volatile private var sseCall: okhttp3.Call? = null

    private fun base() = "127.0.0.1:${ServerState.port}"
    private fun auth() = Runtime.basic(ServerState.password)

    fun request(c: Context, id: String, method: String, path: String, body: String, emit: (String, JSONObject) -> Unit) {
        pool.execute {
            val o = JSONObject().put("id", id)
            try {
                val needsBody = method == "POST" || method == "PUT" || method == "PATCH"
                val rb = if (needsBody) (if (body.isEmpty()) "{}" else body).toRequestBody("application/json".toMediaType()) else null
                val req = Request.Builder().url("http://${base()}$path").header("Authorization", auth()).method(method, rb).build()
                http.newCall(req).execute().use { r: Response ->
                    o.put("status", r.code).put("ct", r.header("Content-Type") ?: "")
                    val bytes = r.body?.bytes() ?: ByteArray(0)
                    if (bytes.size < 200_000) o.put("body", String(bytes, Charsets.UTF_8))
                    else {
                        val dir = File(c.cacheDir, "resp").apply { mkdirs() }
                        File(dir, id).writeBytes(bytes)
                        o.put("file", true)
                    }
                }
            } catch (e: Exception) { o.put("err", e.message ?: e.toString()) }
            emit("http", o)
        }
    }

    fun drop(c: Context, id: String) { try { File(File(c.cacheDir, "resp"), id.replace("/", "")).delete() } catch (_: Exception) {} }

    // ---- server-sent events: /global/event, reconnects by itself ----
    fun sseStart(emit: (String, JSONObject) -> Unit) {
        sseStop()
        val g = ++sseGen
        pool.execute {
            while (g == sseGen) {
                try {
                    val req = Request.Builder().url("http://${base()}/global/event")
                        .header("Authorization", auth()).header("Accept", "text/event-stream").build()
                    val call = stream.newCall(req); sseCall = call
                    call.execute().use { r ->
                        if (!r.isSuccessful) throw IOException("sse ${r.code}")
                        emit("sse", JSONObject().put("t", "open"))
                        val src = r.body!!.source()
                        while (g == sseGen) {
                            val line = src.readUtf8Line() ?: break
                            if (line.startsWith("data:")) emit("sse", JSONObject().put("t", "data").put("d", line.substring(5).trim()))
                        }
                    }
                } catch (_: Exception) {}
                if (g == sseGen) { emit("sse", JSONObject().put("t", "close")); try { Thread.sleep(1500) } catch (_: InterruptedException) {} }
            }
        }
    }

    fun sseStop() { sseGen++; sseCall?.cancel(); sseCall = null }

    // ---- WebSocket (PTY terminal) ----
    fun wsOpen(id: String, path: String, emit: (String, JSONObject) -> Unit) {
        wsClose(id)
        val req = Request.Builder().url("ws://${base()}$path").header("Authorization", auth()).build()
        fun ev(t: String, d: String? = null) = emit("ws", JSONObject().put("id", id).put("t", t).apply { if (d != null) put("d", d) })
        sockets[id] = stream.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) = ev("open")
            override fun onMessage(ws: WebSocket, text: String) = ev("msg", text)
            override fun onMessage(ws: WebSocket, bytes: ByteString) {
                if (bytes.size > 0 && bytes[0].toInt() == 0) return // control frame, not terminal output
                ev("bin", bytes.base64())
            }
            override fun onClosed(ws: WebSocket, code: Int, reason: String) { sockets.remove(id); ev("close") }
            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) { sockets.remove(id); ev("err", t.message) }
        })
    }

    fun wsSend(id: String, text: String) { sockets[id]?.send(text) }
    fun wsClose(id: String) { sockets.remove(id)?.close(1000, null) }
}
