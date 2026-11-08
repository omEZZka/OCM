package app.opencodemob

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.InputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * Local Responses -> Chat Completions bridge.
 *
 * The bundled opencode core talks to OpenAI-compatible providers through
 * `@ai-sdk/openai`, which uses the /v1/responses endpoint. Many third-party
 * OpenAI-compatible providers only implement /v1/chat/completions. This shim
 * listens on 127.0.0.1, receives /v1/responses requests and forwards them as
 * /v1/chat/completions, translating the streaming events back.
 */
object ProxyShim {
    private const val PREF_PORT = "shimPort"
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.MINUTES)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()
    private val streamClient = client.newBuilder()
        .readTimeout(0, TimeUnit.SECONDS)
        .build()
    private val pool = Executors.newCachedThreadPool()
    private val seq = AtomicLong(0)

    @Volatile private var server: ServerSocket? = null
    @Volatile private var running = false
    @Volatile private var port = 0

    fun currentPort(c: Context): Int {
        if (port > 0) return port
        return Prefs.get(c, PREF_PORT).toIntOrNull() ?: 0
    }

    fun isRunning(): Boolean = running

    fun baseUrl(c: Context): String {
        val p = currentPort(c)
        return if (p > 0) "http://127.0.0.1:$p" else ""
    }

    @Synchronized
    fun start(c: Context, uid: String): Int {
        if (running && port > 0) return port
        val preferred = Prefs.get(c, PREF_PORT).toIntOrNull() ?: 0
        var candidate: ServerSocket? = null
        if (preferred in 1024..65535) {
            candidate = try {
                ServerSocket().apply {
                    reuseAddress = true
                    bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), preferred))
                }
            } catch (_: Exception) { null }
        }
        val ss: ServerSocket = candidate ?: ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        server = ss
        port = ss.localPort
        running = true
        Prefs.put(c, PREF_PORT, port.toString())
        pool.execute {
            while (running) {
                val s = try { ss.accept() } catch (_: Exception) { break }
                pool.execute { handle(c, uid, s) }
            }
        }
        return port
    }

    @Synchronized
    fun stop() {
        running = false
        try { server?.close() } catch (_: Exception) {}
        server = null
        port = 0
    }

    private fun handle(c: Context, uid: String, socket: Socket) {
        socket.use { s ->
            try {
                s.soTimeout = 300_000
                val input = BufferedInputStream(s.getInputStream())
                val out = BufferedOutputStream(s.getOutputStream())
                val requestLine = readLine(input) ?: return
                val parts = requestLine.split(" ")
                if (parts.size < 3) { writeJson(out, 400, error("bad request")); return }
                val method = parts[0]
                val target = parts[1]
                val headers = HashMap<String, String>()
                while (true) {
                    val line = readLine(input) ?: break
                    if (line.isEmpty()) break
                    val i = line.indexOf(':')
                    if (i > 0) headers[line.substring(0, i).trim().lowercase()] = line.substring(i + 1).trim()
                }
                val body = readBody(input, headers)
                val path = target.substringBefore('?')
                if (method == "GET" && (path == "/health" || path == "/")) {
                    writeJson(out, 200, JSONObject().put("ok", true).put("port", port))
                    return
                }
                if (method != "POST") { writeJson(out, 405, error("method not allowed")); return }
                if (path.endsWith("/responses")) {
                    handleResponses(c, uid, headers, body, out)
                } else if (path.endsWith("/chat/completions")) {
                    passthrough(c, uid, headers, body, out, path, target)
                } else {
                    writeJson(out, 404, error("not found: $path"))
                }
            } catch (e: Exception) {
                try { writeJson(BufferedOutputStream(s.getOutputStream()), 500, error(e.message ?: e.toString())) } catch (_: Exception) {}
            }
        }
    }

    private fun handleResponses(c: Context, uid: String, headers: Map<String, String>, raw: String, out: BufferedOutputStream) {
        val body = try { JSONObject(raw) } catch (e: Exception) { writeJson(out, 400, error("invalid json: ${e.message}")); return }
        val model = body.optString("model")
        val auth = headers["authorization"] ?: ""
        val up = resolveUpstream(c, uid, auth, model)
        if (up == null) {
            val msg = "no OpenAI-compatible provider found for model '$model'. Add one in Settings -> Models -> Custom API Provider."
            if (body.optBoolean("stream", true)) writeFailedStream(out, model, msg)
            else writeJson(out, 502, error(msg))
            return
        }
        val chatBody = responsesToChat(body)
        val req = Request.Builder()
            .url(chatUrl(up.baseURL))
            .post(chatBody.toString().toRequestBody(jsonType))
        var hasAuth = false
        for ((k, v) in headers) {
            if (k == "host" || k == "content-length" || k == "connection" || k == "accept-encoding" ||
                k == "transfer-encoding" || k == "content-type") continue
            if (k == "authorization") hasAuth = true
            try { req.header(k, v) } catch (_: Exception) {}
        }
        if (!hasAuth && up.apiKey.isNotEmpty()) req.header("Authorization", "Bearer ${up.apiKey}")
        val call = try { (if (body.optBoolean("stream", true)) streamClient else client).newCall(req.build()) } catch (e: Exception) {
            writeJson(out, 500, error(e.message ?: e.toString())); return
        }
        try {
            call.execute().use { r ->
                if (!r.isSuccessful) {
                    val txt = try { r.body?.string() ?: "" } catch (_: Exception) { "" }
                    val msg = "upstream ${r.code}: ${txt.take(800)}"
                    if (body.optBoolean("stream", true)) writeFailedStream(out, model, msg)
                    else writeJson(out, r.code, error(msg))
                    return
                }
                if (body.optBoolean("stream", true)) {
                    writeStreamHeaders(out)
                    val t = Translator(out, model, up.baseURL)
                    t.created()
                    val src = r.body?.source()
                    if (src == null) { t.fail("empty upstream body"); return }
                    while (true) {
                        val line = src.readUtf8Line() ?: break
                        if (!line.startsWith("data:")) continue
                        val data = line.substring(5).trim()
                        if (data == "[DONE]") break
                        val chunk = try { JSONObject(data) } catch (_: Exception) { continue }
                        t.chunk(chunk)
                    }
                    t.finish()
                } else {
                    val txt = r.body?.string() ?: "{}"
                    val resp = try { JSONObject(txt) } catch (e: Exception) {
                        writeJson(out, 502, error("bad upstream json: ${e.message}")); return
                    }
                    writeJson(out, 200, chatToResponse(resp, model))
                }
            }
        } catch (e: Exception) {
            if (body.optBoolean("stream", true)) {
                try { writeFailedStream(out, model, e.message ?: e.toString()) } catch (_: Exception) {}
            } else writeJson(out, 502, error(e.message ?: e.toString()))
        }
    }

    private fun passthrough(c: Context, uid: String, headers: Map<String, String>, raw: String, out: BufferedOutputStream, path: String, target: String) {
        val body = try { JSONObject(raw) } catch (_: Exception) { JSONObject() }
        val auth = headers["authorization"] ?: ""
        val up = resolveUpstream(c, uid, auth, body.optString("model"))
        if (up == null) { writeJson(out, 502, error("no provider")); return }
        val url = if (path.endsWith("/chat/completions")) chatUrl(up.baseURL) else up.baseURL.trimEnd('/') + path
        val req = Request.Builder().url(url).post(raw.toRequestBody(jsonType))
        var hasAuth = false
        for ((k, v) in headers) {
            if (k == "host" || k == "content-length" || k == "connection" || k == "accept-encoding" ||
                k == "transfer-encoding" || k == "content-type") continue
            if (k == "authorization") hasAuth = true
            try { req.header(k, v) } catch (_: Exception) {}
        }
        if (!hasAuth && up.apiKey.isNotEmpty()) req.header("Authorization", "Bearer ${up.apiKey}")
        try {
            client.newCall(req.build()).execute().use { r ->
                val bytes = r.body?.bytes() ?: ByteArray(0)
                val hdr = "HTTP/1.1 ${r.code} ${r.message.ifEmpty { "OK" }}\r\n" +
                    "Content-Type: ${r.header("Content-Type") ?: "application/json"}\r\n" +
                    "Content-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
                out.write(hdr.toByteArray()); out.write(bytes); out.flush()
            }
        } catch (e: Exception) { writeJson(out, 502, error(e.message ?: e.toString())) }
    }

    // ---- upstream resolution ----

    private class Upstream(val baseURL: String, val apiKey: String)

    private fun resolveUpstream(c: Context, uid: String, auth: String, model: String): Upstream? {
        val home = Runtime.home(c, uid)
        val cfgDir = File(home, ".config/opencode")
        val files = listOf(File(cfgDir, "opencode.json"), File(cfgDir, "opencode.jsonc"))
        val bearer = auth.removePrefix("Bearer ").removePrefix("bearer ").trim()
        var best: Upstream? = null
        var bestScore = -1
        for (f in files) {
            if (!f.exists()) continue
            val obj = try { JSONObject(stripJsonc(f.readText())) } catch (_: Exception) { continue }
            val prov = obj.optJSONObject("provider") ?: continue
            val it = prov.keys()
            while (it.hasNext()) {
                val id = it.next()
                if (id == "opencode" || id == "local" || id == "ollama" || id == "lmstudio" || id == "lm-studio") continue
                val p = prov.optJSONObject(id) ?: continue
                if (p.optString("npm") != "@ai-sdk/openai") continue
                val opts = p.optJSONObject("options") ?: continue
                val upstream = opts.optString("upstreamBaseURL").ifEmpty { opts.optString("baseURL") }
                if (upstream.isEmpty()) continue
                if (upstream.contains("127.0.0.1") || upstream.contains("localhost") || upstream.contains("[::1]")) continue
                val key = opts.optString("apiKey")
                var score = 0
                if (key.isNotEmpty() && bearer.isNotEmpty() && key == bearer) score = 3
                else if (key.isNotEmpty() && bearer.contains(key)) score = 2
                if (score < 2) {
                    val models = p.optJSONObject("models")
                    if (models != null && models.has(model)) score = 1
                }
                if (score > bestScore) { bestScore = score; best = Upstream(upstream, key) }
            }
        }
        return best
    }

    private fun chatUrl(base: String): String {
        val b = base.trimEnd('/')
        return when {
            b.endsWith("/chat/completions") -> b
            b.endsWith("/v1") || b.contains("/v1/") -> "$b/chat/completions"
            else -> "$b/v1/chat/completions"
        }
    }

    // ---- request translation ----

    private fun responsesToChat(body: JSONObject): JSONObject {
        val chat = JSONObject()
        val model = body.optString("model")
        if (model.isNotEmpty()) chat.put("model", model)
        val messages = JSONArray()
        val instr = body.optString("instructions")
        if (instr.isNotEmpty()) messages.put(JSONObject().put("role", "system").put("content", instr))

        var pendingTools = JSONArray()
        fun flushTools() {
            if (pendingTools.length() == 0) return
            val msg = JSONObject().put("role", "assistant").put("content", JSONObject.NULL)
            msg.put("tool_calls", pendingTools)
            messages.put(msg)
            pendingTools = JSONArray()
        }

        val input = body.opt("input")
        when (input) {
            is String -> if (input.isNotEmpty()) messages.put(JSONObject().put("role", "user").put("content", input))
            is JSONArray -> for (i in 0 until input.length()) {
                val item = input.opt(i)
                if (item is String) { flushTools(); messages.put(JSONObject().put("role", "user").put("content", item)); continue }
                if (item !is JSONObject) continue
                val type = item.optString("type")
                when (type) {
                    "function_call" -> {
                        val tc = JSONObject()
                            .put("id", item.optString("call_id").ifEmpty { item.optString("id") })
                            .put("type", "function")
                            .put("function", JSONObject()
                                .put("name", item.optString("name"))
                                .put("arguments", item.optString("arguments").ifEmpty { "{}" }))
                        pendingTools.put(tc)
                    }
                    "function_call_output" -> {
                        flushTools()
                        messages.put(JSONObject()
                            .put("role", "tool")
                            .put("tool_call_id", item.optString("call_id").ifEmpty { item.optString("id") })
                            .put("content", outputText(item.opt("output"))))
                    }
                    "reasoning" -> {}
                    else -> {
                        flushTools()
                        var role = item.optString("role").ifEmpty { "user" }
                        if (role == "developer") role = "system"
                        val msg = JSONObject().put("role", role)
                        val content = convertContent(item.opt("content"))
                        if (content == null) msg.put("content", "") else msg.put("content", content)
                        messages.put(msg)
                    }
                }
            }
            else -> {}
        }
        flushTools()
        if (messages.length() == 0) messages.put(JSONObject().put("role", "user").put("content", ""))

        chat.put("messages", messages)
        val tools = body.optJSONArray("tools")
        if (tools != null && tools.length() > 0) chat.put("tools", toolsToChat(tools))
        val tc = body.opt("tool_choice")
        if (tc != null) chat.put("tool_choice", toolChoice(tc))
        if (body.has("max_output_tokens")) chat.put("max_tokens", body.optInt("max_output_tokens"))
        for (k in listOf("temperature", "top_p", "presence_penalty", "frequency_penalty", "seed", "user", "parallel_tool_calls")) {
            if (body.has(k)) chat.put(k, body.opt(k))
        }
        if (body.has("stop")) chat.put("stop", body.opt("stop"))
        if (body.optBoolean("stream", true)) {
            chat.put("stream", true)
            chat.put("stream_options", JSONObject().put("include_usage", true))
        }
        return chat
    }

    private fun outputText(v: Any?): String = when (v) {
        null -> ""
        is String -> v
        is JSONObject -> v.optString("text").ifEmpty { v.optString("content") }.ifEmpty { v.toString() }
        is JSONArray -> {
            val sb = StringBuilder()
            for (i in 0 until v.length()) {
                val x = v.opt(i)
                if (x is JSONObject) {
                    val t = x.optString("text").ifEmpty { x.optString("content") }
                    if (t.isNotEmpty()) { if (sb.isNotEmpty()) sb.append('\n'); sb.append(t) }
                } else if (x != null) sb.append(x.toString())
            }
            sb.toString()
        }
        else -> v.toString()
    }

    private fun convertContent(v: Any?): Any? = when (v) {
        null -> null
        is String -> v
        is JSONArray -> {
            val out = JSONArray()
            for (i in 0 until v.length()) {
                val p = v.optJSONObject(i) ?: continue
                when (p.optString("type")) {
                    "input_text", "output_text", "text", "summary_text" ->
                        out.put(JSONObject().put("type", "text").put("text", p.optString("text")))
                    "input_image" -> {
                        val u = p.opt("image_url")
                        val url = if (u is JSONObject) u.optString("url") else u?.toString() ?: ""
                        out.put(JSONObject().put("type", "image_url").put("image_url", JSONObject().put("url", url)))
                    }
                    "input_file" -> {}
                }
            }
            if (out.length() == 0) null else out
        }
        else -> v.toString()
    }

    private fun toolsToChat(tools: JSONArray): JSONArray {
        val out = JSONArray()
        for (i in 0 until tools.length()) {
            val t = tools.optJSONObject(i) ?: continue
            val fn = t.optJSONObject("function")
            val f = if (fn != null) fn else JSONObject()
                .put("name", t.optString("name"))
                .put("description", t.optString("description"))
                .put("parameters", t.opt("parameters") ?: JSONObject().put("type", "object").put("properties", JSONObject()))
            out.put(JSONObject().put("type", "function").put("function", f))
        }
        return out
    }

    private fun toolChoice(v: Any?): Any = when (v) {
        is String -> v
        is JSONObject -> {
            val name = v.optString("name")
            if (v.optString("type") == "function" && name.isNotEmpty())
                JSONObject().put("type", "function").put("function", JSONObject().put("name", name))
            else v
        }
        else -> "auto"
    }

    // ---- non-streaming translation ----

    private fun chatToResponse(resp: JSONObject, model: String): JSONObject {
        val id = "resp_" + System.currentTimeMillis().toString(36)
        val output = JSONArray()
        val choices = resp.optJSONArray("choices")
        val msg = choices?.optJSONObject(0)?.optJSONObject("message")
        val text = msg?.opt("content") as? String ?: ""
        if (text.isNotEmpty()) {
            output.put(messageItem("msg_" + System.currentTimeMillis().toString(36), text))
        }
        val calls = msg?.optJSONArray("tool_calls")
        if (calls != null) for (i in 0 until calls.length()) {
            val tc = calls.optJSONObject(i) ?: continue
            val fn = tc.optJSONObject("function") ?: JSONObject()
            output.put(functionItem("fc_" + (tc.optString("id").ifEmpty { i.toString() }), tc.optString("id"), fn.optString("name"), fn.optString("arguments")))
        }
        val r = baseResponse(id, model, "completed", output)
        r.put("usage", usageOf(resp.optJSONObject("usage")))
        return r
    }

    // ---- streaming translation ----

    private class Translator(private val out: BufferedOutputStream, private val model: String, private val upstream: String) {
        private val id = "resp_" + System.currentTimeMillis().toString(36)
        private val createdAt = System.currentTimeMillis() / 1000
        private var outIndex = 0
        private var textIndex = -1
        private var textId = ""
        private val text = StringBuilder()
        private var textOpen = false
        private var textDone = false
        private val tools = LinkedHashMap<Int, ToolState>()
        private val items = LinkedHashMap<Int, JSONObject>()
        private var usage: JSONObject? = null
        private var failed = false

        private class ToolState(val key: Int) {
            var itemId = ""
            var callId = ""
            var name = ""
            var args = StringBuilder()
            var fullArgs = StringBuilder()
            var added = false
            var done = false
            var index = -1
        }

        fun created() {
            val r = ProxyShim.baseResponse(id, model, "in_progress", JSONArray())
            emit("response.created", JSONObject().put("type", "response.created").put("sequence_number", ProxyShim.seq.incrementAndGet()).put("response", r))
            emit("response.in_progress", JSONObject().put("type", "response.in_progress").put("sequence_number", ProxyShim.seq.incrementAndGet()).put("response", r))
        }

        fun chunk(c: JSONObject) {
            if (failed) return
            val u = c.optJSONObject("usage")
            if (u != null) usage = u
            val choices = c.optJSONArray("choices") ?: return
            val ch = choices.optJSONObject(0) ?: return
            val d = ch.optJSONObject("delta") ?: ch.optJSONObject("message") ?: return
            val content = d.opt("content") as? String ?: ""
            if (content.isNotEmpty()) textDelta(content)
            val calls = d.optJSONArray("tool_calls")
            if (calls != null) for (i in 0 until calls.length()) {
                val tc = calls.optJSONObject(i) ?: continue
                val key = if (tc.has("index")) tc.optInt("index") else i
                val st = tools.getOrPut(key) { ToolState(key) }
                val cid = tc.optString("id")
                if (cid.isNotEmpty()) st.callId = cid
                val fn = tc.optJSONObject("function")
                if (fn != null) {
                    val nm = fn.optString("name")
                    if (nm.isNotEmpty()) st.name += nm
                    val args = fn.optString("arguments")
                    if (args.isNotEmpty()) { st.args.append(args); st.fullArgs.append(args) }
                }
                if (!st.added && st.name.isNotEmpty()) addTool(st)
                if (st.added && st.args.isNotEmpty()) {
                    val a = st.args.toString()
                    st.args.setLength(0)
                    emit("response.function_call_arguments.delta", JSONObject()
                        .put("type", "response.function_call_arguments.delta")
                        .put("sequence_number", ProxyShim.seq.incrementAndGet())
                        .put("item_id", st.itemId).put("output_index", st.index).put("delta", a))
                }
            }
        }

        private fun textDelta(t: String) {
            if (textDone) return
            if (!textOpen) {
                textId = "msg_" + System.currentTimeMillis().toString(36)
                textIndex = outIndex++
                val item = JSONObject()
                    .put("id", textId).put("type", "message").put("status", "in_progress")
                    .put("role", "assistant").put("content", JSONArray())
                items[textIndex] = item
                emit("response.output_item.added", JSONObject()
                    .put("type", "response.output_item.added").put("sequence_number", ProxyShim.seq.incrementAndGet())
                    .put("output_index", textIndex).put("item", item))
                val part = JSONObject().put("type", "output_text").put("text", "").put("annotations", JSONArray())
                emit("response.content_part.added", JSONObject()
                    .put("type", "response.content_part.added").put("sequence_number", ProxyShim.seq.incrementAndGet())
                    .put("item_id", textId).put("output_index", textIndex).put("content_index", 0).put("part", part))
                textOpen = true
            }
            text.append(t)
            emit("response.output_text.delta", JSONObject()
                .put("type", "response.output_text.delta").put("sequence_number", ProxyShim.seq.incrementAndGet())
                .put("item_id", textId).put("output_index", textIndex).put("content_index", 0).put("delta", t))
        }

        private fun addTool(st: ToolState) {
            if (st.added) return
            st.itemId = "fc_" + (st.callId.ifEmpty { System.currentTimeMillis().toString(36) })
            st.index = outIndex++
            val item = JSONObject()
                .put("id", st.itemId).put("type", "function_call").put("status", "in_progress")
                .put("call_id", st.callId.ifEmpty { st.itemId }).put("name", st.name).put("arguments", "")
            items[st.index] = item
            emit("response.output_item.added", JSONObject()
                .put("type", "response.output_item.added").put("sequence_number", ProxyShim.seq.incrementAndGet())
                .put("output_index", st.index).put("item", item))
            st.added = true
            if (st.args.isNotEmpty()) {
                val a = st.args.toString()
                st.args.setLength(0)
                emit("response.function_call_arguments.delta", JSONObject()
                    .put("type", "response.function_call_arguments.delta")
                    .put("sequence_number", ProxyShim.seq.incrementAndGet())
                    .put("item_id", st.itemId).put("output_index", st.index).put("delta", a))
            }
        }

        fun finish() {
            if (failed) return
            if (textOpen && !textDone) {
                textDone = true
                val full = text.toString()
                emit("response.output_text.done", JSONObject()
                    .put("type", "response.output_text.done").put("sequence_number", ProxyShim.seq.incrementAndGet())
                    .put("item_id", textId).put("output_index", textIndex).put("content_index", 0).put("text", full))
                val part = JSONObject().put("type", "output_text").put("text", full).put("annotations", JSONArray())
                emit("response.content_part.done", JSONObject()
                    .put("type", "response.content_part.done").put("sequence_number", ProxyShim.seq.incrementAndGet())
                    .put("item_id", textId).put("output_index", textIndex).put("content_index", 0).put("part", part))
                val item = items[textIndex]
                if (item != null) {
                    item.put("status", "completed")
                    item.put("content", JSONArray().put(part))
                    emit("response.output_item.done", JSONObject()
                        .put("type", "response.output_item.done").put("sequence_number", ProxyShim.seq.incrementAndGet())
                        .put("output_index", textIndex).put("item", item))
                }
            }
            for (st in tools.values) {
                if (st.done) continue
                if (!st.added) addTool(st)
                val args = st.fullArgs.toString()
                emit("response.function_call_arguments.done", JSONObject()
                    .put("type", "response.function_call_arguments.done").put("sequence_number", ProxyShim.seq.incrementAndGet())
                    .put("item_id", st.itemId).put("output_index", st.index).put("arguments", args))
                val item = items[st.index]
                if (item != null) {
                    item.put("status", "completed")
                    item.put("arguments", args)
                    emit("response.output_item.done", JSONObject()
                        .put("type", "response.output_item.done").put("sequence_number", ProxyShim.seq.incrementAndGet())
                        .put("output_index", st.index).put("item", item))
                }
                st.done = true
            }
            val output = JSONArray()
            val keys = items.keys.sorted()
            for (k in keys) output.put(items[k])
            val r = ProxyShim.baseResponse(id, model, "completed", output)
            r.put("usage", ProxyShim.usageOf(usage))
            emit("response.completed", JSONObject()
                .put("type", "response.completed").put("sequence_number", ProxyShim.seq.incrementAndGet()).put("response", r))
            try { out.flush() } catch (_: Exception) {}
        }

        fun fail(msg: String) {
            failed = true
            val r = ProxyShim.baseResponse(id, model, "failed", JSONArray())
            r.put("error", JSONObject().put("code", "upstream_error").put("message", msg))
            emit("response.failed", JSONObject()
                .put("type", "response.failed").put("sequence_number", ProxyShim.seq.incrementAndGet()).put("response", r))
            try { out.flush() } catch (_: Exception) {}
        }

        private fun emit(event: String, data: JSONObject) {
            try {
                out.write("event: $event\n".toByteArray(Charsets.UTF_8))
                out.write("data: ${data}\n\n".toByteArray(Charsets.UTF_8))
                out.flush()
            } catch (_: Exception) { failed = true }
        }
    }

    private fun baseResponse(id: String, model: String, status: String, output: JSONArray): JSONObject =
        JSONObject()
            .put("id", id)
            .put("object", "response")
            .put("created_at", System.currentTimeMillis() / 1000)
            .put("status", status)
            .put("model", model)
            .put("output", output)
            .put("parallel_tool_calls", true)
            .put("tool_choice", "auto")
            .put("tools", JSONArray())
            .put("store", false)
            .put("truncation", "disabled")
            .put("metadata", JSONObject())
            .put("error", JSONObject.NULL)
            .put("incomplete_details", JSONObject.NULL)
            .put("usage", JSONObject.NULL)

    private fun messageItem(id: String, text: String): JSONObject {
        val part = JSONObject().put("type", "output_text").put("text", text).put("annotations", JSONArray())
        return JSONObject().put("id", id).put("type", "message").put("status", "completed")
            .put("role", "assistant").put("content", JSONArray().put(part))
    }

    private fun functionItem(itemId: String, callId: String, name: String, args: String): JSONObject =
        JSONObject().put("id", itemId).put("type", "function_call").put("status", "completed")
            .put("call_id", callId.ifEmpty { itemId }).put("name", name).put("arguments", args.ifEmpty { "{}" })

    private fun usageOf(u: JSONObject?): Any {
        if (u == null) return JSONObject.NULL
        val input = u.optInt("prompt_tokens", u.optInt("input_tokens", 0))
        val output = u.optInt("completion_tokens", u.optInt("output_tokens", 0))
        val cached = u.optJSONObject("prompt_tokens_details")?.optInt("cached_tokens", 0) ?: 0
        val reasoning = u.optJSONObject("completion_tokens_details")?.optInt("reasoning_tokens", 0) ?: 0
        return JSONObject()
            .put("input_tokens", input)
            .put("output_tokens", output)
            .put("total_tokens", u.optInt("total_tokens", input + output))
            .put("input_tokens_details", JSONObject().put("cached_tokens", cached))
            .put("output_tokens_details", JSONObject().put("reasoning_tokens", reasoning))
    }

    // ---- low level http ----

    private fun readLine(input: InputStream): String? {
        val sb = StringBuilder()
        while (true) {
            val b = input.read()
            if (b == -1) return if (sb.isEmpty()) null else sb.toString()
            if (b == '\n'.code) break
            if (b != '\r'.code) sb.append(b.toChar())
            if (sb.length > 16384) break
        }
        return sb.toString()
    }

    private fun readBody(input: InputStream, headers: Map<String, String>): String {
        val te = headers["transfer-encoding"] ?: ""
        if (te.contains("chunked", true)) {
            val sb = StringBuilder()
            while (true) {
                val sizeLine = readLine(input) ?: break
                val n = sizeLine.trim().substringBefore(';').toIntOrNull(16) ?: break
                if (n == 0) { readLine(input); break }
                val buf = ByteArray(n)
                var off = 0
                while (off < n) {
                    val r = input.read(buf, off, n - off)
                    if (r < 0) break
                    off += r
                }
                sb.append(String(buf, 0, off, Charsets.UTF_8))
                readLine(input)
            }
            return sb.toString()
        }
        val len = headers["content-length"]?.toIntOrNull() ?: return ""
        if (len <= 0) return ""
        val buf = ByteArray(len)
        var off = 0
        while (off < len) {
            val r = input.read(buf, off, len - off)
            if (r < 0) break
            off += r
        }
        return String(buf, 0, off, Charsets.UTF_8)
    }

    private fun writeStreamHeaders(out: BufferedOutputStream) {
        val h = "HTTP/1.1 200 OK\r\n" +
            "Content-Type: text/event-stream; charset=utf-8\r\n" +
            "Cache-Control: no-cache\r\n" +
            "Connection: close\r\n" +
            "X-Accel-Buffering: no\r\n\r\n"
        out.write(h.toByteArray(Charsets.UTF_8)); out.flush()
    }

    private fun writeFailedStream(out: BufferedOutputStream, model: String, msg: String) {
        writeStreamHeaders(out)
        val id = "resp_" + System.currentTimeMillis().toString(36)
        val r = baseResponse(id, model, "failed", JSONArray())
        r.put("error", JSONObject().put("code", "upstream_error").put("message", msg))
        val data = JSONObject().put("type", "response.failed").put("sequence_number", 1).put("response", r)
        out.write("event: response.failed\n".toByteArray(Charsets.UTF_8))
        out.write("data: $data\n\n".toByteArray(Charsets.UTF_8))
        out.flush()
    }

    private fun writeJson(out: BufferedOutputStream, code: Int, obj: JSONObject) {
        val bytes = obj.toString().toByteArray(Charsets.UTF_8)
        val reason = when (code) { 200 -> "OK"; 400 -> "Bad Request"; 404 -> "Not Found"; 405 -> "Method Not Allowed"; 500 -> "Internal Server Error"; 502 -> "Bad Gateway"; else -> "Error" }
        val h = "HTTP/1.1 $code $reason\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
        out.write(h.toByteArray(Charsets.UTF_8)); out.write(bytes); out.flush()
    }

    private fun error(msg: String): JSONObject = JSONObject().put("error", JSONObject().put("message", msg).put("type", "proxy_error"))

    // ---- jsonc ----

    fun stripJsoncPublic(t: String): String = stripJsonc(t)

    private fun stripJsonc(t: String): String {
        val sb = StringBuilder()
        var i = 0
        var inStr = false
        var esc = false
        while (i < t.length) {
            val c = t[i]
            if (inStr) {
                sb.append(c)
                if (esc) esc = false else if (c == '\\') esc = true else if (c == '"') inStr = false
                i++; continue
            }
            if (c == '"') { inStr = true; sb.append(c); i++; continue }
            if (c == '/' && i + 1 < t.length && t[i + 1] == '/') {
                while (i < t.length && t[i] != '\n') i++
                continue
            }
            if (c == '/' && i + 1 < t.length && t[i + 1] == '*') {
                i += 2
                while (i + 1 < t.length && !(t[i] == '*' && t[i + 1] == '/')) i++
                i += 2
                continue
            }
            sb.append(c); i++
        }
        return sb.toString().replace(Regex(",(\\s*[\\x7d\\]])"), "$1")
    }
}
