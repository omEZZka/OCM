package app.opencode_by_omma

import android.content.Context
import android.util.Base64
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * Non-root Cloudflare WARP, WireGuard .conf, Psiphon, and HTTP/SOCKS5 IP rotator with a
 * persistent local ProxyGate (ported cleanly from opencode-infinite for Android).
 */
object WarpManager {
    const val GATE_PORT = 18120
    private const val BURNED_TTL_MS = 24L * 60L * 60L * 1000L
    private const val GATE_WAIT_MS = 65_000L
    private const val WARP_TEST_URL = "http://detectportal.firefox.com/success.txt"
    private val IPV4_RE = Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")
    private val WG_KEY_RE = Regex("^[A-Za-z0-9+/]{43}=$")

    sealed class Upstream {
        object Direct : Upstream()
        data class Http(val host: String, val port: Int, val user: String = "", val pass: String = "") : Upstream()
        data class Socks5(val host: String, val port: Int, val user: String = "", val pass: String = "") : Upstream()
    }

    data class WgPeer(
        val publicKey: String,
        val endpoint: String,
        val allowedIps: List<String>,
        val presharedKey: String = "",
        val keepalive: Int? = null
    )

    data class WgConf(
        val privateKey: String,
        val addresses: List<String>,
        val dns: List<String>,
        val peers: List<WgPeer>
    )

    data class WgParseResult(val ok: Boolean, val conf: WgConf? = null, val errors: List<String> = emptyList())

    data class SavedWg(val id: String, val name: String, val endpoint: String, val conf: String)

    data class GeoInfo(
        val ok: Boolean,
        val ip: String = "",
        val city: String = "",
        val country: String = "",
        val countryCode: String = "",
        val warpState: String = "",
        val colo: String = "",
        val isp: String = "",
        val error: String = ""
    )

    private val lock = Any()
    private var appCtx: Context? = null
    private var gateThread: Thread? = null
    private var gateServer: ServerSocket? = null
    private val openSockets = CopyOnWriteArraySet<Socket>()

    @Volatile private var currentUpstream: Upstream = Upstream.Direct
    @Volatile private var activeProc: Process? = null
    @Volatile private var tunnelPort: Int = 0
    @Volatile private var rotatingFlag: Boolean = false
    @Volatile private var statusState: String = "idle" // idle, connecting, connected, rotating, error
    @Volatile private var activeModeState: String = "direct"
    @Volatile private var lastError: String = ""
    @Volatile private var lastMessage: String = ""

    // Settings
    @Volatile private var configuredMode: String = "direct" // direct, warp, warp_scan, warp_gool, wireguard, proxy, cfon
    @Volatile private var autoRotate: Boolean = true
    @Volatile private var autoFallback: Boolean = true
    @Volatile private var cfonCountry: String = "DE"
    @Volatile private var proxyListText: String = ""
    @Volatile private var rotateUrl: String = ""
    @Volatile private var selectedWgId: String = ""
    private val wgProfiles = ArrayList<SavedWg>()
    private var currentHttpProxyToken: String = ""

    // Telemetry & Burned IP tracking
    private val burnedIps = ConcurrentHashMap<String, Long>()
    @Volatile private var currentIp: String = ""
    @Volatile private var currentCity: String = ""
    @Volatile private var currentCountry: String = ""
    @Volatile private var currentCountryCode: String = ""
    @Volatile private var currentWarpState: String = ""
    @Volatile private var currentColo: String = ""
    @Volatile private var currentIsp: String = ""
    @Volatile private var rotationsCount: Int = 0
    @Volatile private var lastRotatedAt: Long = 0L
    @Volatile private var autoStreak: Int = 0
    @Volatile private var lastAutoTriggerAt: Long = 0L

    private var onChangeListener: ((String) -> Unit)? = null

    fun setOnChange(listener: ((String) -> Unit)?) {
        onChangeListener = listener
    }

    private fun notifyChange() {
        val cb = onChangeListener ?: return
        try {
            cb(statusJson())
        } catch (_: Exception) {}
    }

    private fun warpDir(c: Context): File = File(c.filesDir, "warp").apply { mkdirs() }
    private fun stateFile(c: Context): File = File(warpDir(c), "state.json")
    private fun warpCacheDir(c: Context): File = File(warpDir(c), "cache").apply { mkdirs() }
    private fun runtimeWgFile(c: Context): File = File(warpDir(c), "active_wg.conf")

    fun binaryFile(c: Context): File? {
        val lib = File(c.applicationInfo.nativeLibraryDir, "libwarp.so")
        if (lib.exists() && lib.canExecute()) return lib
        if (lib.exists()) {
            try { lib.setExecutable(true) } catch (_: Exception) {}
            if (lib.canExecute()) return lib
        }
        val alt = File(c.filesDir, "bin/warp")
        return if (alt.exists() && alt.canExecute()) alt else null
    }

    fun init(c: Context) {
        val ctx = c.applicationContext
        synchronized(lock) {
            if (appCtx == null) {
                appCtx = ctx
                loadStateLocked(ctx)
            }
        }
        ensureGateRunning(ctx)
        if (configuredMode != "direct" && activeModeState == "direct" && !rotatingFlag) {
            thread(name = "warp-boot") {
                applyModeInternal(ctx, configuredMode, forceNewIdentity = false)
                refreshGeo(ctx)
            }
        }
    }

    fun ensureGateRunning(c: Context) {
        synchronized(lock) {
            if (appCtx == null) {
                appCtx = c.applicationContext
                loadStateLocked(c.applicationContext)
            }
            if (gateServer != null && gateServer?.isClosed == false && gateThread?.isAlive == true) return
            try {
                val ss = ServerSocket()
                ss.reuseAddress = true
                ss.bind(InetSocketAddress("127.0.0.1", GATE_PORT), 64)
                gateServer = ss
                gateThread = thread(isDaemon = true, name = "warp-proxy-gate") {
                    while (!ss.isClosed) {
                        try {
                            val client = ss.accept()
                            thread(isDaemon = true, name = "gate-conn") {
                                handleGateClient(client)
                            }
                        } catch (_: Exception) {
                            if (ss.isClosed) break
                        }
                    }
                }
            } catch (_: Exception) {
                // Another socket is already listening on GATE_PORT
            }
        }
    }

    fun shutdown() {
        stopTunnelProcess()
        dropGateTunnels()
        try { gateServer?.close() } catch (_: Exception) {}
        gateServer = null
    }

    // ---- Persistence ----

    private fun loadStateLocked(c: Context) {
        val f = stateFile(c)
        if (!f.exists()) return
        try {
            val o = JSONObject(f.readText())
            configuredMode = normalizeMode(o.optString("mode", "direct"))
            autoRotate = o.optBoolean("autoRotate", true)
            autoFallback = o.optBoolean("autoFallback", true)
            cfonCountry = o.optString("cfonCountry", "DE").ifBlank { "DE" }
            proxyListText = o.optString("proxyList", "")
            rotateUrl = o.optString("rotateUrl", "")
            selectedWgId = o.optString("selectedWgId", "")
            rotationsCount = o.optInt("rotations", 0)
            lastRotatedAt = o.optLong("lastRotatedAt", 0L)
            currentIp = o.optString("lastIp", "")
            currentCity = o.optString("lastCity", "")
            currentCountry = o.optString("lastCountry", "")
            currentCountryCode = o.optString("lastCountryCode", "")
            currentIsp = o.optString("lastIsp", "")

            wgProfiles.clear()
            val arr = o.optJSONArray("wgConfigs")
            if (arr != null) {
                for (i in 0 until arr.length()) {
                    val item = arr.optJSONObject(i) ?: continue
                    val id = item.optString("id", "").ifBlank { UUID.randomUUID().toString() }
                    val name = item.optString("name", "WireGuard")
                    val ep = item.optString("endpoint", "")
                    val conf = item.optString("conf", "")
                    if (conf.isNotBlank()) wgProfiles.add(SavedWg(id, name, ep, conf))
                }
            }
            if (selectedWgId.isBlank() && wgProfiles.isNotEmpty()) selectedWgId = wgProfiles[0].id

            burnedIps.clear()
            val bObj = o.optJSONObject("burned")
            val now = System.currentTimeMillis()
            if (bObj != null) {
                val keys = bObj.keys()
                while (keys.hasNext()) {
                    val k = keys.next()
                    val ts = bObj.optLong(k, 0L)
                    if (ts > 0 && now - ts <= BURNED_TTL_MS) burnedIps[k] = ts
                }
            }
        } catch (_: Exception) {}
    }

    private fun saveStateLocked(c: Context) {
        try {
            val now = System.currentTimeMillis()
            val burnedJson = JSONObject()
            val it = burnedIps.entries.iterator()
            while (it.hasNext()) {
                val e = it.next()
                if (now - e.value > BURNED_TTL_MS) it.remove() else burnedJson.put(e.key, e.value)
            }
            val wgArr = JSONArray()
            for (p in wgProfiles) {
                wgArr.put(JSONObject().apply {
                    put("id", p.id)
                    put("name", p.name)
                    put("endpoint", p.endpoint)
                    put("conf", p.conf)
                })
            }
            val root = JSONObject().apply {
                put("mode", configuredMode)
                put("autoRotate", autoRotate)
                put("autoFallback", autoFallback)
                put("cfonCountry", cfonCountry)
                put("proxyList", proxyListText)
                put("rotateUrl", rotateUrl)
                put("selectedWgId", selectedWgId)
                put("rotations", rotationsCount)
                put("lastRotatedAt", lastRotatedAt)
                put("lastIp", currentIp)
                put("lastCity", currentCity)
                put("lastCountry", currentCountry)
                put("lastCountryCode", currentCountryCode)
                put("lastIsp", currentIsp)
                put("wgConfigs", wgArr)
                put("burned", burnedJson)
            }
            stateFile(c).writeText(root.toString(2))
        } catch (_: Exception) {}
    }

    private fun normalizeMode(m: String): String = when (m.lowercase().trim()) {
        "warp", "warp_direct", "warp-direct" -> "warp"
        "warp_scan", "warp-scan", "scan" -> "warp_scan"
        "warp_gool", "warp-gool", "gool" -> "warp_gool"
        "wireguard", "wg", "route64" -> "wireguard"
        "proxy", "http", "socks", "socks5" -> "proxy"
        "cfon", "psiphon" -> "cfon"
        else -> "direct"
    }

    // ---- Burned IPs & Cooldown ----

    private fun burnIp(ip: String?) {
        if (ip.isNullOrBlank()) return
        burnedIps[ip.trim()] = System.currentTimeMillis()
    }

    private fun isBurned(ip: String?): Boolean {
        if (ip.isNullOrBlank()) return false
        val ts = burnedIps[ip.trim()] ?: return false
        if (System.currentTimeMillis() - ts > BURNED_TTL_MS) {
            burnedIps.remove(ip.trim())
            return false
        }
        return true
    }

    fun clearBurned(c: Context): String {
        synchronized(lock) {
            burnedIps.clear()
            saveStateLocked(c)
            lastMessage = "Burned IP history cleared"
        }
        notifyChange()
        return statusJson()
    }

    fun isProxied(): Boolean = configuredMode != "direct"

    fun isAutoRotateEnabled(): Boolean = autoRotate

    fun shouldAutoRotateNow(): Boolean {
        val now = System.currentTimeMillis()
        if (!autoRotate || rotatingFlag) return false
        if (now - lastAutoTriggerAt < 3_000L) return false
        if (now - lastAutoTriggerAt > 180_000L) autoStreak = 0
        if (autoStreak >= 8) {
            lastError = "Auto-rotate paused briefly after 8 consecutive attempts"
            notifyChange()
            return false
        }
        lastAutoTriggerAt = now
        autoStreak++
        return true
    }

    // ---- WireGuard .conf Parser (ported from opencode-infinite wireguard-conf.ts) ----

    fun parseWireGuardConf(text: String): WgParseResult {
        val errors = ArrayList<String>()
        var currentSection: String? = null
        val ifaceFields = LinkedHashMap<String, String>()
        val peerFieldsList = ArrayList<LinkedHashMap<String, String>>()

        for (rawLine in text.split(Regex("\\r?\\n"))) {
            val line = rawLine.replace(Regex("#.*$"), "").trim()
            if (line.isEmpty()) continue
            val secMatch = Regex("^\\[(Interface|Peer)]$", RegexOption.IGNORE_CASE).matchEntire(line)
            if (secMatch != null) {
                currentSection = secMatch.groupValues[1].lowercase()
                if (currentSection == "peer") peerFieldsList.add(LinkedHashMap())
                continue
            }
            val eqIdx = line.indexOf('=')
            val sec = currentSection
            if (eqIdx <= 0 || sec == null) {
                errors.add("Line is not a [Section] or Key = Value")
                continue
            }
            val k = line.substring(0, eqIdx).trim().lowercase()
            val v = line.substring(eqIdx + 1).trim()
            if (k.isEmpty() || v.isEmpty()) continue
            if (sec == "interface") {
                if (ifaceFields.containsKey(k) && (k == "address" || k == "dns")) {
                    ifaceFields[k] = ifaceFields[k] + "," + v
                } else {
                    ifaceFields[k] = v
                }
            } else {
                val peerMap = peerFieldsList.lastOrNull()
                if (peerMap != null) {
                    if (peerMap.containsKey(k) && k == "allowedips") {
                        peerMap[k] = peerMap[k] + "," + v
                    } else {
                        peerMap[k] = v
                    }
                }
            }
        }

        if (ifaceFields.isEmpty()) errors.add("Missing [Interface] section")
        if (peerFieldsList.isEmpty()) errors.add("Missing [Peer] section")
        if (errors.isNotEmpty()) return WgParseResult(false, errors = errors)

        val priv = ifaceFields["privatekey"]
        if (!isWgKey(priv)) errors.add("Interface PrivateKey is missing or invalid")
        val addrs = splitCsv(ifaceFields["address"])
        if (addrs.isEmpty()) errors.add("Interface Address is missing")

        val peers = ArrayList<WgPeer>()
        peerFieldsList.forEachIndexed { idx, pf ->
            val n = idx + 1
            val pub = pf["publickey"] ?: ""
            val ep = pf["endpoint"] ?: ""
            val allowed = splitCsv(pf["allowedips"])
            if (!isWgKey(pub)) errors.add("Peer $n: PublicKey is missing or invalid")
            if (!isEndpointOk(ep)) errors.add("Peer $n: Endpoint must be host:port")
            if (allowed.isEmpty()) errors.add("Peer $n: AllowedIPs is missing")
            val kaRaw = pf["persistentkeepalive"]
            val ka = if (kaRaw != null && kaRaw.lowercase() != "off") kaRaw.toIntOrNull() else null
            peers.add(WgPeer(pub, ep, allowed, pf["presharedkey"] ?: "", ka))
        }

        if (errors.isNotEmpty()) return WgParseResult(false, errors = errors)
        val dns = splitCsv(ifaceFields["dns"])
        return WgParseResult(
            ok = true,
            conf = WgConf(priv!!, addrs, dns, peers)
        )
    }

    private fun isWgKey(v: String?): Boolean {
        if (v == null || !WG_KEY_RE.matches(v)) return false
        return try { Base64.decode(v, Base64.DEFAULT).size == 32 } catch (_: Exception) { false }
    }

    private fun isEndpointOk(v: String?): Boolean {
        if (v.isNullOrBlank()) return false
        val m = Regex("^(\\[[0-9A-Fa-f:.]+]|[^\\s:\\[\\]]+):(\\d{1,5})$").matchEntire(v) ?: return false
        val port = m.groupValues[2].toIntOrNull() ?: return false
        return port in 1..65535
    }

    private fun splitCsv(v: String?): List<String> =
        (v ?: "").split(',').map { it.trim() }.filter { it.isNotEmpty() }

    private fun resolveWgConfText(parsed: WgConf): String {
        val sb = StringBuilder()
        sb.append("[Interface]\n")
        sb.append("PrivateKey = ").append(parsed.privateKey).append("\n")
        sb.append("Address = ").append(parsed.addresses.joinToString(", ")).append("\n")
        val dns = if (parsed.dns.isNotEmpty()) parsed.dns else listOf("1.1.1.1")
        sb.append("DNS = ").append(dns.joinToString(", ")).append("\n")
        for (peer in parsed.peers) {
            sb.append("\n[Peer]\n")
            sb.append("PublicKey = ").append(peer.publicKey).append("\n")
            sb.append("Endpoint = ").append(resolveEndpoint(peer.endpoint)).append("\n")
            sb.append("AllowedIPs = ").append(peer.allowedIps.joinToString(", ")).append("\n")
            if (peer.presharedKey.isNotEmpty()) sb.append("PresharedKey = ").append(peer.presharedKey).append("\n")
            if (peer.keepalive != null && peer.keepalive > 0) sb.append("PersistentKeepalive = ").append(peer.keepalive).append("\n")
        }
        return sb.toString()
    }

    private fun resolveEndpoint(ep: String): String {
        val idx = ep.lastIndexOf(':')
        if (idx <= 0) return ep
        val rawHost = ep.substring(0, idx).removePrefix("[").removeSuffix("]")
        val port = ep.substring(idx + 1)
        if (IPV4_RE.matches(rawHost) || rawHost.contains(':')) return ep
        return try {
            val all = InetAddress.getAllByName(rawHost)
            val v4 = all.firstOrNull { it is Inet4Address }?.hostAddress ?: all.firstOrNull()?.hostAddress
            if (v4 != null) {
                if (v4.contains(':')) "[$v4]:$port" else "$v4:$port"
            } else ep
        } catch (_: Exception) {
            ep
        }
    }

    // ---- WireGuard CRUD ----

    fun importWgConfig(c: Context, name: String, confText: String): String {
        val parsed = parseWireGuardConf(confText)
        if (!parsed.ok || parsed.conf == null) {
            return JSONObject().apply {
                put("ok", false)
                put("message", parsed.errors.joinToString("; "))
            }.toString()
        }
        val ep = parsed.conf.peers.firstOrNull()?.endpoint ?: ""
        val cleanName = name.trim().ifBlank { ep.substringBefore(':').ifBlank { "WireGuard" } }
        val id = "wg_" + UUID.randomUUID().toString().replace("-", "").take(10)
        synchronized(lock) {
            wgProfiles.add(SavedWg(id, cleanName, ep, confText.trim()))
            if (selectedWgId.isBlank() || wgProfiles.size == 1) selectedWgId = id
            saveStateLocked(c)
        }
        notifyChange()
        return JSONObject().apply {
            put("ok", true)
            put("id", id)
            put("endpoint", ep)
            put("message", "Saved WireGuard config ($ep)")
            put("status", JSONObject(statusJson()))
        }.toString()
    }

    fun selectWgConfig(c: Context, id: String): String {
        synchronized(lock) {
            if (wgProfiles.any { it.id == id }) {
                selectedWgId = id
                saveStateLocked(c)
            }
        }
        if (configuredMode == "wireguard") {
            thread(name = "wg-switch") {
                applyModeInternal(c, "wireguard", forceNewIdentity = false)
                refreshGeo(c)
            }
        }
        notifyChange()
        return statusJson()
    }

    fun deleteWgConfig(c: Context, id: String): String {
        synchronized(lock) {
            wgProfiles.removeAll { it.id == id }
            if (selectedWgId == id) selectedWgId = wgProfiles.firstOrNull()?.id ?: ""
            saveStateLocked(c)
        }
        notifyChange()
        return statusJson()
    }

    // ---- Proxy List Parsing ----

    fun parseProxyToken(rawLine: String): Upstream? {
        var s = rawLine.trim()
        if (s.isEmpty() || s.startsWith("#")) return null
        if (!s.contains("://")) s = "http://$s"
        return try {
            val u = URI(s)
            val scheme = (u.scheme ?: "http").lowercase()
            val host = u.host ?: return null
            val port = if (u.port > 0) u.port else if (scheme == "https") 443 else if (scheme.startsWith("socks")) 1080 else 8080
            val ui = u.userInfo ?: ""
            val user = if (ui.contains(':')) ui.substringBefore(':') else ui
            val pass = if (ui.contains(':')) ui.substringAfter(':') else ""
            if (scheme.startsWith("socks")) Upstream.Socks5(host, port, user, pass)
            else Upstream.Http(host, port, user, pass)
        } catch (_: Exception) {
            null
        }
    }

    private fun parsedProxyEntries(): List<Pair<String, Upstream>> =
        proxyListText.split(Regex("\\r?\\n"))
            .map { it.trim() }
            .filter { it.isNotEmpty() && !it.startsWith("#") }
            .mapNotNull { line -> parseProxyToken(line)?.let { line to it } }

    // ---- Process & Mode Control ----

    private fun freeLocalPort(): Int = try {
        ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { it.localPort }
    } catch (_: Exception) {
        18121 + (System.currentTimeMillis() % 500).toInt()
    }

    private fun stopTunnelProcess() {
        val p = activeProc
        activeProc = null
        tunnelPort = 0
        if (p != null) {
            try { p.destroy() } catch (_: Exception) {}
            try {
                if (p.isAlive) {
                    p.waitFor(400, TimeUnit.MILLISECONDS)
                    if (p.isAlive) p.destroyForcibly()
                }
            } catch (_: Exception) {}
        }
    }

    private fun startLibWarpProcess(c: Context, mode: String, freshIdentity: Boolean): Boolean {
        val bin = binaryFile(c)
        if (bin == null) {
            lastError = "WARP tunnel binary (libwarp.so) missing from APK build"
            return false
        }
        stopTunnelProcess()

        val cache = warpCacheDir(c)
        if (freshIdentity && (mode == "warp" || mode == "warp_scan" || mode == "warp_gool" || mode == "cfon")) {
            try { File(cache, "primary").deleteRecursively() } catch (_: Exception) {}
            try { File(cache, "secondary").deleteRecursively() } catch (_: Exception) {}
        }

        val port = freeLocalPort()
        val args = ArrayList<String>().apply {
            add(bin.absolutePath)
            add("-v")
            add("-4")
            add("--test-url")
            add(WARP_TEST_URL)
            add("-b")
            add("127.0.0.1:$port")
            add("--cache-dir")
            add(cache.absolutePath)
            when (mode) {
                "warp_scan" -> add("--scan")
                "warp_gool" -> add("--gool")
                "cfon" -> {
                    add("--cfon")
                    add("--country")
                    add(cfonCountry.uppercase().ifBlank { "DE" })
                }
                "wireguard" -> {
                    val chosen = synchronized(lock) {
                        wgProfiles.firstOrNull { it.id == selectedWgId } ?: wgProfiles.firstOrNull()
                    }
                    if (chosen == null) {
                        lastError = "No WireGuard .conf imported"
                        return false
                    }
                    val parsed = parseWireGuardConf(chosen.conf)
                    if (!parsed.ok || parsed.conf == null) {
                        lastError = parsed.errors.joinToString("; ")
                        return false
                    }
                    val runtimeFile = runtimeWgFile(c)
                    runtimeFile.writeText(resolveWgConfText(parsed.conf))
                    add("--wgconf")
                    add(runtimeFile.absolutePath)
                }
            }
        }

        val logFile = File(warpDir(c), "warp.log")
        return try {
            logFile.writeText("")
            val pb = ProcessBuilder(args)
                .directory(warpDir(c))
                .redirectErrorStream(true)
            val proc = pb.start()
            activeProc = proc
            tunnelPort = port

            val outputLines = ArrayList<String>()
            val readerThread = thread(isDaemon = true, name = "warp-log") {
                try {
                    proc.inputStream.bufferedReader().forEachLine { ln ->
                        synchronized(outputLines) {
                            outputLines.add(ln)
                            if (outputLines.size > 120) outputLines.removeAt(0)
                        }
                        try { logFile.appendText(ln + "\n") } catch (_: Exception) {}
                    }
                } catch (_: Exception) {}
            }

            val waitMs = if (mode == "warp_scan" || mode == "cfon") 35_000L else 22_000L
            val deadline = System.currentTimeMillis() + waitMs
            var ready = false
            while (System.currentTimeMillis() < deadline && proc.isAlive) {
                val hasServing = synchronized(outputLines) {
                    outputLines.any { it.contains("serving proxy", ignoreCase = true) }
                }
                if (hasServing || canTcpConnect("127.0.0.1", port, 300)) {
                    ready = true
                    break
                }
                Thread.sleep(250)
            }
            if (!ready) {
                val tail = synchronized(outputLines) {
                    outputLines.takeLast(4).joinToString(" | ")
                }
                lastError = if (tail.isNotBlank()) "Tunnel timeout ($mode): $tail" else "Tunnel failed to start ($mode)"
                stopTunnelProcess()
                false
            } else {
                currentUpstream = Upstream.Socks5("127.0.0.1", port)
                activeModeState = mode
                lastError = ""
                dropGateTunnels()
                true
            }
        } catch (e: Exception) {
            lastError = e.message ?: "Failed launching WARP tunnel"
            stopTunnelProcess()
            false
        }
    }

    private fun canTcpConnect(host: String, port: Int, timeoutMs: Int): Boolean = try {
        Socket().use { s ->
            s.connect(InetSocketAddress(host, port), timeoutMs)
            true
        }
    } catch (_: Exception) {
        false
    }

    private fun startProxyUpstream(preferNext: Boolean): Boolean {
        stopTunnelProcess()
        val list = parsedProxyEntries()
        if (list.isEmpty()) {
            lastError = "Proxy list is empty. Add HTTP/SOCKS5 proxies in WARP Settings."
            return false
        }
        val candidates = if (preferNext && list.size > 1) {
            list.filter { it.first != currentHttpProxyToken } + list.filter { it.first == currentHttpProxyToken }
        } else list

        for ((token, up) in candidates) {
            val probe = probeGeoWithUpstream(up)
            if (probe.ok && (!preferNext || !isBurned(probe.ip) || candidates.size == 1)) {
                currentHttpProxyToken = token
                currentUpstream = up
                activeModeState = "proxy"
                applyGeoResult(probe)
                lastError = ""
                dropGateTunnels()
                return true
            }
        }
        lastError = "No working proxy responded in list (${list.size})"
        return false
    }

    private fun triggerChangeIpWebhook(): Boolean {
        val u = rotateUrl.trim()
        if (u.isEmpty()) return false
        return try {
            val client = OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(15, TimeUnit.SECONDS)
                .build()
            client.newCall(Request.Builder().url(u).build()).execute().use { r ->
                if (r.isSuccessful) Thread.sleep(2000)
                r.isSuccessful
            }
        } catch (_: Exception) {
            false
        }
    }

    private fun buildAttemptOrder(primary: String): List<String> {
        if (!autoFallback) return listOf(primary)
        val out = LinkedHashSet<String>()
        out.add(primary)
        if (primary != "direct") {
            if (primary == "warp") out.add("warp_scan")
            if (wgProfiles.isNotEmpty()) out.add("wireguard")
            if (parsedProxyEntries().isNotEmpty()) out.add("proxy")
            if (primary != "cfon") out.add("cfon")
            if (primary != "warp") out.add("warp")
        }
        return out.toList()
    }

    private fun applyModeInternal(c: Context, targetMode: String, forceNewIdentity: Boolean): Boolean {
        val mode = normalizeMode(targetMode)
        if (mode == "direct") {
            stopTunnelProcess()
            currentUpstream = Upstream.Direct
            activeModeState = "direct"
            statusState = "idle"
            lastError = ""
            lastMessage = "Direct connection active"
            dropGateTunnels()
            notifyChange()
            return true
        }

        statusState = if (forceNewIdentity) "rotating" else "connecting"
        notifyChange()

        val chain = buildAttemptOrder(mode)
        for (candidate in chain) {
            val ok = when (candidate) {
                "warp", "warp_scan", "warp_gool", "cfon" -> startLibWarpProcess(c, candidate, forceNewIdentity)
                "wireguard" -> {
                    val list = synchronized(lock) { wgProfiles.toList() }
                    if (forceNewIdentity && list.size > 1) {
                        synchronized(lock) {
                            val idx = wgProfiles.indexOfFirst { it.id == selectedWgId }
                            selectedWgId = wgProfiles[(idx + 1).coerceAtLeast(0) % wgProfiles.size].id
                            saveStateLocked(c)
                        }
                    }
                    startLibWarpProcess(c, "wireguard", false)
                }
                "proxy" -> {
                    if (forceNewIdentity) triggerChangeIpWebhook()
                    startProxyUpstream(preferNext = forceNewIdentity)
                }
                else -> false
            }
            if (ok) {
                activeModeState = candidate
                statusState = "connected"
                if (candidate != mode) lastMessage = "WARP fallback -> $candidate"
                notifyChange()
                return true
            }
        }

        statusState = "error"
        // Never leak real IP silently when user asked for proxy/WARP unless explicit direct
        notifyChange()
        return false
    }

    fun applyConfigJson(c: Context, rawJson: String) {
        synchronized(lock) {
            try {
                val o = JSONObject(rawJson)
                if (o.has("mode")) configuredMode = normalizeMode(o.optString("mode", configuredMode))
                if (o.has("autoRotate")) autoRotate = o.optBoolean("autoRotate", autoRotate)
                if (o.has("autoFallback")) autoFallback = o.optBoolean("autoFallback", autoFallback)
                if (o.has("cfonCountry")) cfonCountry = o.optString("cfonCountry", cfonCountry).uppercase().ifBlank { "DE" }
                if (o.has("proxyList")) proxyListText = o.optString("proxyList", proxyListText)
                if (o.has("rotateUrl")) rotateUrl = o.optString("rotateUrl", rotateUrl)
                if (o.has("selectedWgId")) selectedWgId = o.optString("selectedWgId", selectedWgId)
                saveStateLocked(c)
            } catch (_: Exception) {}
        }
        notifyChange()
        thread(name = "warp-apply") {
            val ok = applyModeInternal(c, configuredMode, forceNewIdentity = false)
            if (ok) refreshGeo(c)
            notifyChange()
        }
    }

    fun rotateNow(c: Context): JSONObject {
        synchronized(lock) {
            if (rotatingFlag) {
                return JSONObject().apply {
                    put("ok", false)
                    put("message", "Rotation already in progress")
                    put("status", JSONObject(statusJson()))
                }
            }
            rotatingFlag = true
        }
        val targetMode = if (configuredMode == "direct") "warp" else configuredMode
        if (configuredMode == "direct") {
            synchronized(lock) {
                configuredMode = "warp"
                saveStateLocked(c)
            }
        }

        return try {
            val prevIp = currentIp
            burnIp(prevIp)
            statusState = "rotating"
            lastMessage = "Rotating IP..."
            notifyChange()

            var bestGeo: GeoInfo? = null
            val maxAttempts = if (targetMode == "wireguard" && wgProfiles.size <= 1) 1 else 4
            for (attempt in 1..maxAttempts) {
                val started = applyModeInternal(c, targetMode, forceNewIdentity = true)
                if (!started) continue
                val geo = probeGeoWithUpstream(Upstream.Http("127.0.0.1", GATE_PORT))
                if (geo.ok) {
                    bestGeo = geo
                    applyGeoResult(geo)
                    if (geo.ip.isNotBlank() && geo.ip != prevIp && !isBurned(geo.ip)) {
                        break
                    }
                    if (attempt < maxAttempts) burnIp(geo.ip)
                }
            }

            if (statusState == "connected" && (bestGeo == null || !bestGeo.ok)) {
                bestGeo = refreshGeo(c)
            }

            val ok = statusState == "connected"
            if (ok) {
                rotationsCount++
                lastRotatedAt = System.currentTimeMillis()
                lastMessage = buildString {
                    append("IP: ").append(currentIp.ifBlank { "?" })
                    if (currentCity.isNotBlank() || currentCountry.isNotBlank()) {
                        append(" (")
                        append(listOf(currentCity, currentCountry).filter { it.isNotBlank() }.joinToString(", "))
                        append(")")
                    }
                }
            } else if (lastError.isBlank()) {
                lastError = "Unable to acquire new exit IP"
            }
            synchronized(lock) { saveStateLocked(c) }
            notifyChange()
            JSONObject().apply {
                put("ok", ok)
                put("ip", currentIp)
                put("city", currentCity)
                put("country", currentCountry)
                put("countryCode", currentCountryCode)
                put("mode", activeModeState)
                put("message", if (ok) lastMessage else lastError)
                put("status", JSONObject(statusJson()))
            }
        } finally {
            rotatingFlag = false
            notifyChange()
        }
    }

    // ---- Geo IP Lookup ----

    private fun applyGeoResult(geo: GeoInfo) {
        if (geo.ip.isNotBlank()) currentIp = geo.ip
        if (geo.city.isNotBlank()) currentCity = geo.city
        if (geo.country.isNotBlank()) currentCountry = geo.country
        if (geo.countryCode.isNotBlank()) currentCountryCode = geo.countryCode
        if (geo.warpState.isNotBlank()) currentWarpState = geo.warpState
        if (geo.colo.isNotBlank()) currentColo = geo.colo
        if (geo.isp.isNotBlank()) currentIsp = geo.isp
    }

    fun refreshGeo(c: Context): GeoInfo {
        val gateProxy = if (activeModeState == "direct") Upstream.Direct else Upstream.Http("127.0.0.1", GATE_PORT)
        val geo = probeGeoWithUpstream(gateProxy)
        if (geo.ok) {
            applyGeoResult(geo)
            synchronized(lock) { saveStateLocked(c) }
        } else if (geo.error.isNotBlank()) {
            lastError = geo.error
        }
        notifyChange()
        return geo
    }

    private fun clientForUpstream(up: Upstream): OkHttpClient {
        val b = OkHttpClient.Builder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
        when (up) {
            is Upstream.Http -> b.proxy(Proxy(Proxy.Type.HTTP, InetSocketAddress(up.host, up.port)))
            is Upstream.Socks5 -> b.proxy(Proxy(Proxy.Type.SOCKS, InetSocketAddress(up.host, up.port)))
            is Upstream.Direct -> {}
        }
        return b.build()
    }

    private fun probeGeoWithUpstream(up: Upstream): GeoInfo {
        val client = clientForUpstream(up)
        var ip = ""
        var loc = ""
        var warp = ""
        var colo = ""
        var err = ""

        try {
            val req = Request.Builder()
                .url("https://www.cloudflare.com/cdn-cgi/trace")
                .header("User-Agent", "OpenCode-Mobile/2.2.1")
                .build()
            client.newCall(req).execute().use { r ->
                if (r.isSuccessful) {
                    val body = r.body?.string() ?: ""
                    for (ln in body.lines()) {
                        when {
                            ln.startsWith("ip=") -> ip = ln.substring(3).trim()
                            ln.startsWith("loc=") -> loc = ln.substring(4).trim()
                            ln.startsWith("warp=") -> warp = ln.substring(5).trim()
                            ln.startsWith("colo=") -> colo = ln.substring(5).trim()
                        }
                    }
                }
            }
        } catch (e: Exception) {
            err = e.message ?: "trace failed"
        }

        if (ip.isBlank()) {
            try {
                val req = Request.Builder().url("https://api64.ipify.org?format=json").build()
                client.newCall(req).execute().use { r ->
                    if (r.isSuccessful) {
                        ip = JSONObject(r.body?.string() ?: "{}").optString("ip", "")
                    }
                }
            } catch (e: Exception) {
                if (err.isBlank()) err = e.message ?: "ip check failed"
            }
        }

        if (ip.isBlank()) {
            return GeoInfo(false, error = err.ifBlank { "No exit IP response" })
        }

        var city = ""
        var country = ""
        var code = loc
        var isp = ""

        try {
            val geoReq = Request.Builder()
                .url("https://ipwho.is/$ip")
                .header("User-Agent", "OpenCode-Mobile/2.2.1")
                .build()
            client.newCall(geoReq).execute().use { r ->
                if (r.isSuccessful) {
                    val j = JSONObject(r.body?.string() ?: "{}")
                    if (j.optBoolean("success", true)) {
                        city = j.optString("city", "")
                        country = j.optString("country", "")
                        val cc = j.optString("country_code", "")
                        if (cc.isNotBlank()) code = cc
                        val conn = j.optJSONObject("connection")
                        isp = conn?.optString("isp", "")?.ifBlank { conn.optString("org", "") } ?: ""
                    }
                }
            }
        } catch (_: Exception) {}

        if (city.isBlank() && country.isBlank()) {
            try {
                val fbReq = Request.Builder().url("https://ipinfo.io/$ip/json").build()
                client.newCall(fbReq).execute().use { r ->
                    if (r.isSuccessful) {
                        val j = JSONObject(r.body?.string() ?: "{}")
                        city = j.optString("city", "")
                        val cc = j.optString("country", "")
                        if (cc.isNotBlank()) code = cc
                        country = countryNameFromCode(cc).ifBlank { cc }
                        isp = j.optString("org", "")
                    }
                }
            } catch (_: Exception) {}
        }

        if (country.isBlank() && code.isNotBlank()) country = countryNameFromCode(code).ifBlank { code }
        return GeoInfo(true, ip, city, country, code, warp, colo, isp)
    }

    private fun countryNameFromCode(cc: String): String = try {
        if (cc.length == 2) java.util.Locale("", cc).getDisplayCountry(java.util.Locale.ENGLISH) else ""
    } catch (_: Exception) { "" }

    // ---- Status JSON ----

    fun statusJson(): String {
        val arr = JSONArray()
        synchronized(lock) {
            for (p in wgProfiles) {
                arr.put(JSONObject().apply {
                    put("id", p.id)
                    put("name", p.name)
                    put("endpoint", p.endpoint)
                    put("active", p.id == selectedWgId)
                })
            }
        }
        return JSONObject().apply {
            put("enabled", configuredMode != "direct")
            put("mode", configuredMode)
            put("activeMode", activeModeState)
            put("status", statusState)
            put("rotating", rotatingFlag)
            put("error", lastError)
            put("lastMessage", lastMessage)
            put("ip", currentIp)
            put("city", currentCity)
            put("country", currentCountry)
            put("countryCode", currentCountryCode)
            put("warpState", currentWarpState)
            put("colo", currentColo)
            put("isp", currentIsp)
            put("burnedCount", burnedIps.size)
            put("rotations", rotationsCount)
            put("lastRotatedAt", lastRotatedAt)
            put("autoRotate", autoRotate)
            put("autoFallback", autoFallback)
            put("cfonCountry", cfonCountry)
            put("proxyList", proxyListText)
            put("rotateUrl", rotateUrl)
            put("selectedWgId", selectedWgId)
            put("wgConfigs", arr)
            put("gatePort", GATE_PORT)
            put("binaryReady", appCtx?.let { binaryFile(it) != null } ?: false)
        }.toString()
    }

    // ---- Local ProxyGate Server (HTTP CONNECT + plain HTTP over Direct / HttpProxy / Socks5) ----

    private fun dropGateTunnels() {
        for (s in openSockets) {
            try { s.close() } catch (_: Exception) {}
        }
        openSockets.clear()
    }

    private fun handleGateClient(client: Socket) {
        openSockets.add(client)
        try {
            client.soTimeout = 30_000
            val cin = BufferedInputStream(client.getInputStream())
            val cout = client.getOutputStream()
            val headerBytes = readHttpHeaderBytes(cin) ?: return
            val headerStr = headerBytes.toString(StandardCharsets.ISO_8859_1)
            val lines = headerStr.split("\r\n")
            val firstLine = lines.firstOrNull() ?: return
            val parts = firstLine.split(' ')
            if (parts.size < 3) return
            val method = parts[0].uppercase()
            val target = parts[1]

            if (method == "CONNECT") {
                val (host, port) = splitHostPort(target, 443) ?: return
                val upSock = connectThroughGate(host, port) ?: run {
                    try { cout.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n".toByteArray()) } catch (_: Exception) {}
                    return
                }
                openSockets.add(upSock)
                try {
                    client.soTimeout = 0
                    upSock.soTimeout = 0
                    cout.write("HTTP/1.1 200 Connection Established\r\n\r\n".toByteArray())
                    cout.flush()
                    pipeBidirectional(cin, cout, upSock.getInputStream(), upSock.getOutputStream())
                } finally {
                    openSockets.remove(upSock)
                    try { upSock.close() } catch (_: Exception) {}
                }
            } else {
                // Plain HTTP request (e.g. http://example.com/path or http://127.0.0.1/...)
                val uri = try { URI(target) } catch (_: Exception) { null }
                val hostHeader = lines.drop(1).firstOrNull { it.startsWith("Host:", ignoreCase = true) }
                    ?.substringAfter(':')?.trim()
                val reqHost = uri?.host ?: hostHeader?.let { splitHostPort(it, 80)?.first } ?: return
                val reqPort = if (uri != null && uri.port > 0) uri.port else if (uri?.scheme == "https") 443 else 80
                val up = currentUpstream
                val upSock = connectWithRetry(up, reqHost, reqPort) ?: run {
                    try { cout.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n".toByteArray()) } catch (_: Exception) {}
                    return
                }
                openSockets.add(upSock)
                try {
                    client.soTimeout = 0
                    upSock.soTimeout = 0
                    val outBytes = rewritePlainHttpHeader(headerStr, parts, up)
                    val upOut = upSock.getOutputStream()
                    upOut.write(outBytes)
                    upOut.flush()
                    pipeBidirectional(cin, cout, upSock.getInputStream(), upOut)
                } finally {
                    openSockets.remove(upSock)
                    try { upSock.close() } catch (_: Exception) {}
                }
            }
        } catch (_: Exception) {
        } finally {
            openSockets.remove(client)
            try { client.close() } catch (_: Exception) {}
        }
    }

    private fun readHttpHeaderBytes(inp: InputStream): ByteArray? {
        val baos = ByteArrayOutputStream()
        var matched = 0
        while (baos.size() < 65536) {
            val b = inp.read()
            if (b < 0) return null
            baos.write(b)
            matched = when (matched) {
                0 -> if (b == '\r'.code) 1 else 0
                1 -> if (b == '\n'.code) 2 else if (b == '\r'.code) 1 else 0
                2 -> if (b == '\r'.code) 3 else 0
                3 -> if (b == '\n'.code) 4 else 0
                else -> 0
            }
            if (matched == 4) return baos.toByteArray()
        }
        return null
    }

    private fun splitHostPort(authority: String, defaultPort: Int): Pair<String, Int>? {
        val s = authority.trim()
        if (s.startsWith("[")) {
            val end = s.indexOf(']')
            if (end < 0) return null
            val host = s.substring(1, end)
            val rest = s.substring(end + 1)
            val port = if (rest.startsWith(":")) rest.substring(1).toIntOrNull() ?: defaultPort else defaultPort
            return host to port
        }
        val colon = s.lastIndexOf(':')
        if (colon > 0) {
            val port = s.substring(colon + 1).toIntOrNull()
            if (port != null) return s.substring(0, colon) to port
        }
        return s to defaultPort
    }

    private fun rewritePlainHttpHeader(headerStr: String, firstParts: List<String>, up: Upstream): ByteArray {
        val lines = headerStr.split("\r\n").filter { it.isNotEmpty() }.toMutableList()
        if (lines.isEmpty()) return headerStr.toByteArray(StandardCharsets.ISO_8859_1)
        if (up is Upstream.Http) {
            if (up.user.isNotEmpty() && lines.none { it.startsWith("Proxy-Authorization:", ignoreCase = true) }) {
                val creds = Base64.encodeToString("${up.user}:${up.pass}".toByteArray(), Base64.NO_WRAP)
                lines.add("Proxy-Authorization: Basic $creds")
            }
            return (lines.joinToString("\r\n") + "\r\n\r\n").toByteArray(StandardCharsets.ISO_8859_1)
        }
        // Direct or SOCKS5: convert full proxy URL back to origin-form path
        val target = firstParts[1]
        val originTarget = try {
            val u = URI(target)
            val p = (u.rawPath ?: "").ifEmpty { "/" }
            if (u.rawQuery != null) "$p?${u.rawQuery}" else p
        } catch (_: Exception) {
            target
        }
        lines[0] = "${firstParts[0]} $originTarget ${firstParts[2]}"
        val filtered = lines.filterNot {
            it.startsWith("Proxy-Connection:", ignoreCase = true) ||
                it.startsWith("Connection:", ignoreCase = true)
        }.toMutableList()
        filtered.add("Connection: close")
        return (filtered.joinToString("\r\n") + "\r\n\r\n").toByteArray(StandardCharsets.ISO_8859_1)
    }

    private fun connectThroughGate(host: String, port: Int): Socket? {
        if (host == "127.0.0.1" || host.equals("localhost", ignoreCase = true) || host == "::1") {
            return try {
                Socket().apply { connect(InetSocketAddress(host, port), 5000) }
            } catch (_: Exception) { null }
        }
        val deadline = System.currentTimeMillis() + GATE_WAIT_MS
        while (true) {
            val up = currentUpstream
            val sock = dialUpstreamConnect(up, host, port)
            if (sock != null) return sock
            val shouldWait = (rotatingFlag || statusState == "connecting" || statusState == "rotating") &&
                System.currentTimeMillis() < deadline
            if (!shouldWait) return null
            try { Thread.sleep(300) } catch (_: Exception) { return null }
        }
    }

    private fun connectWithRetry(up: Upstream, host: String, port: Int): Socket? {
        val sock = when (up) {
            is Upstream.Direct -> try { Socket().apply { connect(InetSocketAddress(host, port), 10_000) } } catch (_: Exception) { null }
            is Upstream.Http -> try { Socket().apply { connect(InetSocketAddress(up.host, up.port), 10_000) } } catch (_: Exception) { null }
            is Upstream.Socks5 -> dialSocks5(up, host, port)
        }
        return sock
    }

    private fun dialUpstreamConnect(up: Upstream, host: String, port: Int): Socket? = when (up) {
        is Upstream.Direct -> try {
            Socket().apply { connect(InetSocketAddress(host, port), 12_000) }
        } catch (_: Exception) { null }
        is Upstream.Http -> dialHttpConnect(up, host, port)
        is Upstream.Socks5 -> dialSocks5(up, host, port)
    }

    private fun dialHttpConnect(up: Upstream.Http, host: String, port: Int): Socket? {
        val sock = try {
            Socket().apply {
                soTimeout = 15_000
                connect(InetSocketAddress(up.host, up.port), 8_000)
            }
        } catch (_: Exception) { return null }
        return try {
            val out = sock.getOutputStream()
            val targetHost = if (host.contains(':')) "[$host]:$port" else "$host:$port"
            val sb = StringBuilder("CONNECT $targetHost HTTP/1.1\r\nHost: $targetHost\r\n")
            if (up.user.isNotEmpty()) {
                val creds = Base64.encodeToString("${up.user}:${up.pass}".toByteArray(), Base64.NO_WRAP)
                sb.append("Proxy-Authorization: Basic ").append(creds).append("\r\n")
            }
            sb.append("\r\n")
            out.write(sb.toString().toByteArray(StandardCharsets.ISO_8859_1))
            out.flush()
            val respBytes = readHttpHeaderBytes(sock.getInputStream())
            val first = respBytes?.toString(StandardCharsets.ISO_8859_1)?.substringBefore("\r\n") ?: ""
            if (Regex("^HTTP/1\\.[01] 2\\d\\d").containsMatchIn(first)) {
                sock
            } else {
                sock.close()
                null
            }
        } catch (_: Exception) {
            try { sock.close() } catch (_: Exception) {}
            null
        }
    }

    private fun dialSocks5(up: Upstream.Socks5, host: String, port: Int): Socket? {
        val sock = try {
            Socket().apply {
                soTimeout = 15_000
                connect(InetSocketAddress(up.host, up.port), 8_000)
            }
        } catch (_: Exception) { return null }
        return try {
            val inp = sock.getInputStream()
            val out = sock.getOutputStream()
            val hasAuth = up.user.isNotEmpty() || up.pass.isNotEmpty()
            val greet = if (hasAuth) byteArrayOf(5, 2, 0, 2) else byteArrayOf(5, 1, 0)
            out.write(greet)
            out.flush()
            val sel = readExact(inp, 2) ?: throw IllegalStateException("socks5 eof")
            if (sel[0].toInt() != 5) throw IllegalStateException("bad socks ver")
            if (sel[1].toInt() == 2) {
                val u = up.user.toByteArray(StandardCharsets.UTF_8)
                val p = up.pass.toByteArray(StandardCharsets.UTF_8)
                val authReq = ByteArray(3 + u.size + p.size)
                authReq[0] = 1
                authReq[1] = u.size.toByte()
                System.arraycopy(u, 0, authReq, 2, u.size)
                authReq[2 + u.size] = p.size.toByte()
                System.arraycopy(p, 0, authReq, 3 + u.size, p.size)
                out.write(authReq)
                out.flush()
                val authResp = readExact(inp, 2) ?: throw IllegalStateException("socks5 auth eof")
                if (authResp[1].toInt() != 0) throw IllegalStateException("socks5 auth failed")
            } else if (sel[1].toInt() != 0) {
                throw IllegalStateException("socks5 no auth method")
            }

            val hostBytes = host.toByteArray(StandardCharsets.UTF_8)
            val req = ByteArray(4 + 1 + hostBytes.size + 2)
            req[0] = 5; req[1] = 1; req[2] = 0; req[3] = 3
            req[4] = hostBytes.size.toByte()
            System.arraycopy(hostBytes, 0, req, 5, hostBytes.size)
            req[5 + hostBytes.size] = ((port ushr 8) and 0xFF).toByte()
            req[6 + hostBytes.size] = (port and 0xFF).toByte()
            out.write(req)
            out.flush()

            val rep = readExact(inp, 4) ?: throw IllegalStateException("socks5 reply eof")
            if (rep[1].toInt() != 0) throw IllegalStateException("socks5 connect err ${rep[1].toInt()}")
            val skipBytes = when (rep[3].toInt()) {
                1 -> 4
                4 -> 16
                3 -> {
                    val lenArr = readExact(inp, 1) ?: throw IllegalStateException("socks5 atyp len")
                    lenArr[0].toInt() and 0xFF
                }
                else -> throw IllegalStateException("socks5 bad atyp")
            }
            if (skipBytes > 0) readExact(inp, skipBytes) ?: throw IllegalStateException("socks5 addr eof")
            readExact(inp, 2) ?: throw IllegalStateException("socks5 port eof")
            sock
        } catch (_: Exception) {
            try { sock.close() } catch (_: Exception) {}
            null
        }
    }

    private fun readExact(inp: InputStream, n: Int): ByteArray? {
        val buf = ByteArray(n)
        var off = 0
        while (off < n) {
            val r = inp.read(buf, off, n - off)
            if (r < 0) return null
            off += r
        }
        return buf
    }

    private fun pipeBidirectional(cIn: InputStream, cOut: OutputStream, sIn: InputStream, sOut: OutputStream) {
        val t1 = thread(isDaemon = true) { copyStream(cIn, sOut) }
        copyStream(sIn, cOut)
        try { t1.join(500) } catch (_: Exception) {}
    }

    private fun copyStream(inp: InputStream, out: OutputStream) {
        val buf = ByteArray(16384)
        try {
            while (true) {
                val n = inp.read(buf)
                if (n <= 0) break
                out.write(buf, 0, n)
                out.flush()
            }
        } catch (_: Exception) {}
        try { out.flush() } catch (_: Exception) {}
    }
}
