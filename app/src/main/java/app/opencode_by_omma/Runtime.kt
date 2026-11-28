package app.opencode_by_omma

import android.content.Context
import android.system.Os
import android.util.Base64
import org.apache.commons.compress.archivers.tar.TarArchiveEntry
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.xz.XZCompressorInputStream
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.ServerSocket
import java.net.URL
import java.nio.file.FileVisitResult
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.SimpleFileVisitor
import java.nio.file.attribute.BasicFileAttributes
import java.security.SecureRandom

object Prefs {
    private fun sp(c: Context) = c.getSharedPreferences("oc", Context.MODE_PRIVATE)
    fun get(c: Context, k: String, d: String = ""): String = sp(c).getString(k, d) ?: d
    fun put(c: Context, k: String, v: String) = sp(c).edit().putString(k, v).apply()
    fun flag(c: Context, k: String, d: Boolean = true): Boolean = sp(c).getBoolean(k, d)
    fun putFlag(c: Context, k: String, v: Boolean) = sp(c).edit().putBoolean(k, v).apply()
}

/** Shared between the service (writer) and the activity (reader). */
object ServerState {
    @Volatile var port = 0
    @Volatile var password = ""
    @Volatile var ready = false
    @Volatile var error: String? = null
    /** Coarse startup stage: idle | installing | proxy | starting | waiting | ready | down. */
    @Volatile var phase: String = "idle"
}

object Runtime {
    fun rootfs(c: Context) = File(c.filesDir, "rootfs")

    /** Every Google account gets its own HOME: sessions, auth.json, config. Nothing is shared. */
    fun home(c: Context, uid: String): File = File(c.filesDir, "users/$uid/home").apply { mkdirs() }

    /** Maps a path as the agent sees it (inside proot) to the real file on the phone. */
    fun hostPath(c: Context, uid: String, guest: String): File {
        val g = File("/", guest).normalize().path
        return when {
            g == "/root" || g.startsWith("/root/") -> File(home(c, uid), g.removePrefix("/root").removePrefix("/"))
            g == "/sdcard" || g.startsWith("/sdcard/") -> File("/storage/emulated/0", g.removePrefix("/sdcard").removePrefix("/"))
            g == "/storage/emulated/0" || g.startsWith("/storage/emulated/0/") -> File(g)
            else -> File(rootfs(c), g.removePrefix("/"))
        }
    }

    fun ls(c: Context, uid: String, guest: String): org.json.JSONObject {
        val l = hostPath(c, uid, guest).listFiles()
            ?: return org.json.JSONObject().put("ok", false).put("err", "Cannot read $guest")
        val arr = org.json.JSONArray()
        l.sortedWith(compareBy({ !it.isDirectory }, { it.name.lowercase() })).forEach {
            arr.put(org.json.JSONObject().put("name", it.name).put("dir", it.isDirectory).put("size", it.length()))
        }
        return org.json.JSONObject().put("ok", true).put("path", guest).put("items", arr)
    }

    fun fs(c: Context, uid: String, op: String, guest: String, arg: String): org.json.JSONObject {
        val r = org.json.JSONObject()
        return try {
            val f = hostPath(c, uid, guest)
            when (op) {
                "mkdir" -> check(f.mkdirs() || f.isDirectory) { "Cannot create folder" }
                "create" -> { f.parentFile?.mkdirs(); check(f.createNewFile() || f.exists()) { "Cannot create file" } }
                "rename" -> {
                    val dst = if (arg.startsWith("/")) hostPath(c, uid, arg) else File(f.parentFile, arg)
                    check(f.renameTo(dst)) { "Cannot rename" }
                }
                "move", "copy" -> {
                    val dst = hostPath(c, uid, arg)
                    if (op == "move") {
                        if (!f.renameTo(dst)) { copyRecursive(f, dst); rmrf(f) }
                    } else copyRecursive(f, dst)
                }
                "delete" -> rmrf(f)
                else -> error("Unknown operation")
            }
            r.put("ok", true)
        } catch (e: Exception) { r.put("ok", false).put("err", e.message ?: e.toString()) }
    }

    fun isInstalled(c: Context): Boolean {
        val stamp = File(rootfs(c), ".stamp")
        return stamp.exists() && stamp.readText().trim() == assetId(c)
    }

    private fun assetId(c: Context): String =
        c.assets.open("rootfs.id").bufferedReader().use { it.readText().trim() }

    /** Human-readable error for install failures (disk full, permissions, tar entry). */
    private fun friendly(e: Exception, prefix: String): String {
        val m = e.message ?: e.toString()
        return when {
            m.contains("ENOSPC") || m.contains("No space left", true) ->
                "На телефоне закончилось свободное место. Освободите минимум 2 ГБ и нажмите «Повторить»."
            m.contains("EACCES") || m.contains("Permission denied", true) ->
                "$prefix: нет доступа к файлам. Нажмите «Сбросить и установить заново»."
            else -> "$prefix: $m"
        }
    }

    /** Deletes rootfs.broken-* dirs left aside by previous installs (best effort, background). */
    fun cleanupBroken(c: Context) {
        c.filesDir.listFiles { f -> f.name.startsWith("rootfs.broken") }?.forEach {
            kotlin.concurrent.thread(isDaemon = true) { try { rmrf(it) } catch (_: Exception) {} }
        }
    }

    // ---------- install (xz -> rootfs), progress 0..100 ----------

    private class Counting(inp: InputStream) : FilterInputStream(inp) {
        var n = 0L
        override fun read(): Int = super.read().also { if (it >= 0) n++ }
        override fun read(b: ByteArray, o: Int, l: Int): Int = super.read(b, o, l).also { if (it > 0) n += it }
    }

    /** SHA-256 of the bundled archive, used to prove the asset survived packaging intact. */
    private fun assetSha(c: Context): String =
        try { c.assets.open("rootfs.sha256").bufferedReader().use { it.readText().trim().lowercase() } } catch (_: Exception) { "" }

    private fun sha256(f: File): String = try {
        val md = java.security.MessageDigest.getInstance("SHA-256")
        f.inputStream().use { inp ->
            val buf = ByteArray(1 shl 16)
            while (true) { val n = inp.read(buf); if (n <= 0) break; md.update(buf, 0, n) }
        }
        md.digest().joinToString("") { "%02x".format(it) }
    } catch (_: Exception) { "" }

    // Serialised: the UI can start an install and a "reset and reinstall" at the same time; both
    // share rootfs.new and swap rootfs, so concurrent runs corrupted each other's extraction.
    @Synchronized
    fun install(c: Context, progress: (Int) -> Unit) {
        val id = assetId(c)
        // Verify the archive before touching the old environment. A truncated APK download (very
        // common on flaky mobile networks) used to surface as "Compressed data is corrupt" in the
        // middle of a big file like libnode.so — after gigabytes of extraction had already run.
        val want = assetSha(c)
        if (want.isNotEmpty()) {
            var got = ""
            try {
                val cache = File(c.cacheDir, "rootfs.verify.tar.xz").apply { parentFile?.mkdirs() }
                c.assets.open("rootfs.tar.xz").use { inp -> cache.outputStream().use { out -> inp.copyTo(out, 1 shl 16) } }
                got = sha256(cache)
                cache.delete()
            } catch (e: Exception) {
                throw IOException(friendly(e, "Не удалось проверить окружение"))
            }
            if (got.isNotEmpty() && !got.equals(want, ignoreCase = true)) {
                throw IOException("Файл окружения повреждён при установке (ожидался ${want.take(12)}…, получен ${got.take(12)}…). Переустановите APK из официального релиза: сборка скачалась не полностью.")
            }
        }
        val tmp = File(c.filesDir, "rootfs.new")
        cleanupBroken(c)
        rmrf(tmp); tmp.mkdirs()
        val total = c.assets.openFd("rootfs.tar.xz").use { it.length }.coerceAtLeast(1)
        val cnt = Counting(c.assets.open("rootfs.tar.xz"))
        var last = -1
        TarArchiveInputStream(XZCompressorInputStream(BufferedInputStream(cnt, 1 shl 16))).use { tar ->
            var e = tar.nextEntry
            while (e != null) {
                try { extract(tmp, tar, e as TarArchiveEntry) }
                catch (ex: Exception) { throw IOException(friendly(ex, "Не удалось распаковать элемент «${e.name}»")) }
                val pct = (cnt.n * 100 / total).toInt().coerceIn(0, 99)
                if (pct != last) { last = pct; progress(pct) }
                e = tar.nextEntry
            }
        }
        try {
            File(tmp, "etc/resolv.conf").apply { quietDelete(this); writeText("nameserver 1.1.1.1\nnameserver 8.8.8.8\n") }
            File(tmp, "etc/hosts").apply { quietDelete(this); writeText("127.0.0.1 localhost\n::1 localhost\n") }
            File(tmp, "tmp").apply { mkdirs(); Os.chmod(path, 0x3FF) } // 1777
            File(tmp, "root").mkdirs()
            File(tmp, ".stamp").writeText(id)
        } catch (ex: Exception) { throw IOException(friendly(ex, "Не удалось подготовить окружение")) }
        // Replace the old rootfs. Its leftover files (from any previous version) can be
        // undeletable (read-only/locked), so: best-effort delete -> rename aside -> swap in.
        val old = rootfs(c)
        try { rmrf(old) } catch (_: Exception) {}
        if (old.exists()) {
            val aside = File(c.filesDir, "rootfs.broken-" + System.currentTimeMillis())
            if (!old.renameTo(aside))
                throw IOException("Не удалось заменить старое Linux-окружение. Нажмите «Сбросить и установить заново», а если не поможет — очистите данные OpenCode в настройках Android.")
            kotlin.concurrent.thread(isDaemon = true) { try { rmrf(aside) } catch (_: Exception) {} }
        }
        if (!tmp.renameTo(rootfs(c))) throw IOException("Не удалось переместить Linux-окружение")
        progress(100)
    }

    private fun extract(root: File, tar: TarArchiveInputStream, e: TarArchiveEntry) {
        val name = e.name.removePrefix("./").trimEnd('/')
        if (name.isEmpty() || name.split('/').any { it == ".." }) return
        val f = File(root, name)
        when {
            e.isDirectory -> { f.mkdirs(); Os.chmod(f.path, (e.mode and 0x1FF) or 0x1C0) }
            e.isSymbolicLink -> { f.parentFile?.mkdirs(); quietDelete(f); Os.symlink(e.linkName, f.path) }
            e.isLink -> {
                f.parentFile?.mkdirs(); quietDelete(f)
                val target = File(root, e.linkName.removePrefix("./"))
                try { Os.link(target.path, f.path) } catch (_: Exception) { target.copyTo(f, true) }
            }
            e.isFile -> {
                f.parentFile?.mkdirs(); quietDelete(f)
                FileOutputStream(f).use { tar.copyTo(it) }
                Os.chmod(f.path, (e.mode and 0x1FF) or 0x180)
            }
            else -> Unit // devices/fifos are provided by proot binds
        }
    }

    private fun quietDelete(f: File) { try { Files.deleteIfExists(f.toPath()) } catch (_: Exception) {} }

    /** Recursive copy used by the file manager (copy / move across filesystems). */
    fun copyRecursive(src: File, dst: File) {
        if (Files.isSymbolicLink(src.toPath())) {
            val target = Files.readSymbolicLink(src.toPath())
            dst.parentFile?.mkdirs()
            try { Files.deleteIfExists(dst.toPath()) } catch (_: Exception) {}
            Files.createSymbolicLink(dst.toPath(), target)
            return
        }
        if (src.isDirectory) {
            dst.mkdirs()
            src.listFiles()?.forEach { child -> copyRecursive(child, File(dst, child.name)) }
        } else {
            dst.parentFile?.mkdirs()
            Files.copy(src.toPath(), dst.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING)
        }
    }

    fun rmrf(f: File) {
        val p = f.toPath()
        if (!Files.exists(p, java.nio.file.LinkOption.NOFOLLOW_LINKS)) return
        Files.walkFileTree(p, object : SimpleFileVisitor<Path>() {
            private fun writable(x: Path) {
                if (Files.isSymbolicLink(x)) return // deleting a symlink needs no perms on the target
                try {
                    Files.setPosixFilePermissions(x, java.nio.file.attribute.PosixFilePermissions.fromString("rwxrwxrwx"))
                } catch (_: Exception) {}
            }
            override fun preVisitDirectory(dir: Path, attrs: BasicFileAttributes): FileVisitResult {
                writable(dir); return FileVisitResult.CONTINUE
            }
            override fun visitFile(file: Path, attrs: BasicFileAttributes): FileVisitResult {
                try {
                    try { Files.delete(file) }
                    catch (_: Exception) { writable(file); Files.delete(file) }
                } catch (_: Exception) { /* keep going; install() renames the dir aside */ }
                return FileVisitResult.CONTINUE
            }
            override fun visitFileFailed(file: Path, e: IOException): FileVisitResult {
                try { file.toFile().delete() } catch (_: Exception) {}
                return FileVisitResult.CONTINUE
            }
            override fun postVisitDirectory(dir: Path, e: IOException?): FileVisitResult {
                try { Files.delete(dir) } catch (_: Exception) {}
                return FileVisitResult.CONTINUE
            }
        })
    }

    // ---------- per-install port + password (never shared between users or phones) ----------

    /** Random port chosen once per install and kept, so the WebView origin (localStorage, IndexedDB) stays stable. */
    fun stablePort(c: Context): Int {
        // A port that was free once can end up inside Android's ephemeral range and be grabbed by
        // another app, which shows up as "cannot connect to the local server". Prefer the saved
        // port, but verify it is actually bindable now and otherwise pick a fresh one.
        val saved = Prefs.get(c, "port").toIntOrNull()
        if (saved != null && saved in 20000..60999) {
            try {
                ServerSocket().use { ss ->
                    ss.reuseAddress = true
                    ss.bind(java.net.InetSocketAddress(java.net.InetAddress.getByName("127.0.0.1"), saved))
                }
                return saved
            } catch (_: Exception) {}
        }
        val p = ServerSocket(0, 0, java.net.InetAddress.getByName("127.0.0.1")).use { it.localPort }
        Prefs.put(c, "port", p.toString())
        return p
    }

    fun stablePassword(c: Context): String {
        var pw = Prefs.get(c, "pw")
        if (pw.isEmpty()) {
            pw = ByteArray(24).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
            Prefs.put(c, "pw", pw)
        }
        return pw
    }

    fun basic(pw: String) = "Basic " + Base64.encodeToString("opencode:$pw".toByteArray(), Base64.NO_WRAP)

    // ---------- launch: proot -> opencode serve (1.x) ----------

    /** Common proot invocation (same binds as the server) for a one-shot command like `opencode console login`. */
    private fun prootBase(c: Context, uid: String): MutableList<String> {
        val lib = c.applicationInfo.nativeLibraryDir
        val home = home(c, uid)
        val ptmp = File(c.filesDir, "proot-tmp").apply { mkdirs() }
        val a = mutableListOf(
            "$lib/libproot.so", "--kill-on-exit", "--link2symlink", "--sysvipc", "-0",
            "-r", rootfs(c).path, "-w", "/root",
            "-b", "/dev", "-b", "/proc", "-b", "/sys",
            "-b", "/dev/urandom:/dev/random",
            "-b", "/proc/self/fd:/dev/fd",
            "-b", "/proc/self/fd/0:/dev/stdin",
            "-b", "/proc/self/fd/1:/dev/stdout",
            "-b", "/proc/self/fd/2:/dev/stderr",
            "-b", "${home.path}:/root",
        )
        if (File("/storage/emulated/0").exists()) {
            a += listOf("-b", "/storage/emulated/0:/storage/emulated/0", "-b", "/storage/emulated/0:/sdcard")
        }
        return a
    }

    /** True only when the user explicitly enabled a non-direct WARP mode (persisted by WarpManager). */
    fun warpEnabled(c: Context): Boolean = try {
        val f = File(c.filesDir, "warp/state.json")
        if (!f.exists()) false
        else {
            val m = org.json.JSONObject(f.readText()).optString("mode", "direct").lowercase().trim()
            m.isNotEmpty() && m != "direct"
        }
    } catch (_: Exception) { false }

    /** Checks if the device currently has an active internet-capable network. */
    fun isOnline(c: Context): Boolean = try {
        val cm = c.getSystemService(Context.CONNECTIVITY_SERVICE) as? android.net.ConnectivityManager ?: return false
        val net = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(net) ?: return false
        caps.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET)
    } catch (_: Exception) {
        false
    }

    /** Disposes the running OpenCode server instance so updated opencode.json models load immediately. */
    fun disposeRunningInstance() {
        if (!ServerState.ready || ServerState.port <= 0) return
        kotlin.concurrent.thread(isDaemon = true) {
            try {
                val con = URL("http://127.0.0.1:${ServerState.port}/instance/dispose").openConnection() as HttpURLConnection
                con.requestMethod = "POST"
                con.connectTimeout = 2500
                con.readTimeout = 4000
                con.setRequestProperty("Authorization", basic(ServerState.password))
                con.setRequestProperty("Content-Type", "application/json")
                con.doOutput = true
                con.outputStream.use { it.write("{}".toByteArray()) }
                con.responseCode
                con.disconnect()

                // Warm up provider registry right away so SessionPrompt.getModel sees new models
                val warm = URL("http://127.0.0.1:${ServerState.port}/config/providers").openConnection() as HttpURLConnection
                warm.connectTimeout = 2500
                warm.readTimeout = 5000
                warm.setRequestProperty("Authorization", basic(ServerState.password))
                warm.responseCode
                warm.disconnect()
            } catch (_: Exception) {}
        }
    }

    /** Runs a short-lived command inside the proot env with merged piped output (for `opencode console login/logout`). */
    fun prootCmd(c: Context, uid: String, cmd: List<String>): Process {
        val lib = c.applicationInfo.nativeLibraryDir
        val ptmp = File(c.filesDir, "proot-tmp").apply { mkdirs() }
        val a = prootBase(c, uid) + cmd
        val pb = ProcessBuilder(a).redirectErrorStream(true).directory(c.filesDir)
        pb.environment().apply {
            clear()
            put("LD_LIBRARY_PATH", lib)
            put("PROOT_LOADER", "$lib/libproot-loader.so")
            put("PROOT_TMP_DIR", ptmp.path)
            put("HOME", "/root"); put("USER", "root"); put("SHELL", "/bin/bash")
            put("LANG", "C.UTF-8"); put("TERM", "dumb"); put("TMPDIR", "/tmp")
            put("PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
            put("OPENCODE_DISABLE_AUTOUPDATE", "1")
        }
        return pb.start()
    }

    /** Strip JSONC comments and trailing commas outside string literals so URLs like https:// are preserved. */
    internal fun cleanJson(raw: String): String {
        val noComments = StringBuilder(raw.length)
        var i = 0
        val n = raw.length
        var inString = false
        var escaped = false
        while (i < n) {
            val c = raw[i]
            if (inString) {
                noComments.append(c)
                if (escaped) {
                    escaped = false
                } else if (c == '\\') {
                    escaped = true
                } else if (c == '\u0022') {
                    inString = false
                }
                i++
                continue
            }
            if (c == '\u0022') {
                inString = true
                noComments.append(c)
                i++
                continue
            }
            if (c == '/' && i + 1 < n) {
                val next = raw[i + 1]
                if (next == '/') {
                    i += 2
                    while (i < n && raw[i] != '\n') i++
                    continue
                }
                if (next == '*') {
                    i += 2
                    while (i + 1 < n && !(raw[i] == '*' && raw[i + 1] == '/')) i++
                    i = if (i + 1 < n) i + 2 else n
                    continue
                }
            }
            noComments.append(c)
            i++
        }

        val s = noComments.toString()
        val out = StringBuilder(s.length)
        inString = false
        escaped = false
        var idx = 0
        val len = s.length
        while (idx < len) {
            val c = s[idx]
            if (inString) {
                out.append(c)
                if (escaped) {
                    escaped = false
                } else if (c == '\\') {
                    escaped = true
                } else if (c == '\u0022') {
                    inString = false
                }
                idx++
                continue
            }
            if (c == '\u0022') {
                inString = true
                out.append(c)
                idx++
                continue
            }
            if (c == ',') {
                var j = idx + 1
                while (j < len && s[j].isWhitespace()) j++
                if (j < len && (s[j] == '\u007D' || s[j] == ']')) {
                    idx++
                    continue
                }
            }
            out.append(c)
            idx++
        }
        return out.toString().trim()
    }

    fun sanitizeConfig(c: Context, uid: String, forceReset: Boolean = false) {
        try {
            val home = home(c, uid)
            val cfgDir = File(home, ".config/opencode").apply { mkdirs() }
            val configFile = File(cfgDir, "opencode.json")
            val jsoncFile = File(cfgDir, "opencode.jsonc")

            // Migrate jsonc contents into json so there is no split-brain config. Keep a backup
            // of the original jsonc: users with custom settings must not lose a single line.
            if (jsoncFile.exists()) {
                if (!configFile.exists() || configFile.length() == 0L) {
                    try { jsoncFile.copyTo(configFile, overwrite = true) } catch (_: Exception) {}
                } else {
                    try {
                        val from = org.json.JSONObject(cleanJson(jsoncFile.readText()))
                        val to = org.json.JSONObject(cleanJson(configFile.readText()))
                        var merged = false
                        val keys = from.keys()
                        while (keys.hasNext()) {
                            val k = keys.next()
                            if (!to.has(k)) { to.put(k, from.get(k)); merged = true }
                        }
                        if (merged) configFile.writeText(to.toString(2))
                    } catch (_: Exception) {}
                }
                try {
                    jsoncFile.copyTo(File(cfgDir, "opencode.jsonc.migrated-" + System.currentTimeMillis()), overwrite = true)
                } catch (_: Exception) {}
                try { jsoncFile.delete() } catch (_: Exception) {}
            }

            if (forceReset) {
                if (configFile.exists()) {
                    val bak = File(cfgDir, "opencode.json.bak-" + System.currentTimeMillis())
                    try { configFile.renameTo(bak) } catch (_: Exception) {}
                }
                val fresh = org.json.JSONObject()
                configFile.writeText(fresh.toString(2))
                return
            }

            if (!configFile.exists()) {
                configFile.writeText(org.json.JSONObject().toString(2))
                return
            }

            val txt = configFile.readText().trim()
            if (txt.isEmpty()) {
                configFile.writeText(org.json.JSONObject().toString(2))
                return
            }

            try {
                val cleaned = cleanJson(txt)
                val obj = org.json.JSONObject(cleaned)
                val fixed = cleanBrokenProviderOverrides(obj)
                if (cleaned != txt || fixed) {
                    configFile.writeText(obj.toString(2))
                }
            } catch (_: Exception) {
                val bak = File(cfgDir, "opencode.json.corrupt-" + System.currentTimeMillis())
                try { configFile.copyTo(bak, overwrite = true) } catch (_: Exception) {}
                configFile.writeText(org.json.JSONObject().toString(2))
            }
        } catch (_: Exception) {}
    }

    /** Removes only the known-broken rotator plugins and repairs @ai-sdk/openai relays.
     *  `local` / `ollama` (localmodels.js) are never touched. */
    private fun cleanBrokenProviderOverrides(rootObj: org.json.JSONObject): Boolean {
        var changed = false
        try {
            val prov = rootObj.optJSONObject("provider") ?: return false
            for (id in listOf("clawrouter", "opencode-ip-rotator")) {
                if (prov.has(id)) { prov.remove(id); changed = true }
            }
            val it = prov.keys()
            while (it.hasNext()) {
                val pid = it.next()
                if (pid == "local" || pid == "ollama" || pid == "lmstudio" || pid == "lm-studio") continue
                val p = prov.optJSONObject(pid) ?: continue
                if (p.optString("npm", "") != "@ai-sdk/openai") continue
                val baseUrl = p.optJSONObject("options")?.optString("baseURL", "") ?: ""
                if (baseUrl.isNotEmpty() && !baseUrl.contains("api.openai.com")) {
                    p.put("npm", "@ai-sdk/openai-compatible")
                    changed = true
                }
            }
        } catch (_: Exception) {}
        return changed
    }

    /** Routes custom OpenAI-compatible providers through the local Responses -> Chat Completions shim. */
    fun rewriteOpenAiProviders(c: Context, uid: String) {
        try {
            val shim = ProxyShim.currentPort(c)
            if (shim <= 0) return
            val cfgDir = File(home(c, uid), ".config/opencode").apply { mkdirs() }
            for (f in listOf(File(cfgDir, "opencode.json"), File(cfgDir, "opencode.jsonc"))) {
                if (!f.exists()) continue
                val obj = try { org.json.JSONObject(ProxyShim.stripJsoncPublic(f.readText())) } catch (_: Exception) { continue }
                val prov = obj.optJSONObject("provider") ?: continue
                var changed = false
                val it = prov.keys()
                while (it.hasNext()) {
                    val id = it.next()
                    if (id == "opencode" || id == "local" || id == "ollama" || id == "lmstudio" || id == "lm-studio") continue
                    val p = prov.optJSONObject(id) ?: continue
                    if (p.optString("npm") != "@ai-sdk/openai") continue
                    val opts = p.optJSONObject("options") ?: org.json.JSONObject().also { p.put("options", it) }
                    val base = opts.optString("baseURL")
                    if (base.isEmpty()) continue
                    val saved = opts.optString("upstreamBaseURL")
                    val isLocal = base.contains("127.0.0.1") || base.contains("localhost") || base.contains("[::1]")
                    if (isLocal) {
                        if (saved.isNotEmpty()) {
                            val want = "http://127.0.0.1:$shim/v1"
                            if (base != want) { opts.put("baseURL", want); changed = true }
                        }
                        continue
                    }
                    opts.put("upstreamBaseURL", saved.ifEmpty { base })
                    opts.put("baseURL", "http://127.0.0.1:$shim/v1")
                    changed = true
                }
                if (changed) f.writeText(obj.toString(2))
            }
        } catch (_: Exception) {}
    }

    fun ensureDefaults(c: Context, uid: String) {
        try {
            sanitizeConfig(c, uid)
            rewriteOpenAiProviders(c, uid)
            val root = rootfs(c)
            val home = home(c, uid)
            val cfg = File(home, ".config/opencode").apply { mkdirs() }
            val dotOpencode = File(home, ".opencode").apply { mkdirs() }

            // Purge poisoned/empty models cache from previous builds
            val cacheDir = File(home, ".cache/opencode").apply { mkdirs() }
            val cacheModels = File(cacheDir, "models.json")
            if (cacheModels.exists()) {
                try {
                    val txt = cacheModels.readText()
                    if (txt.length < 50000 || txt.contains("\"models\": {}") || !txt.contains("\"anthropic\"")) {
                        cacheModels.delete()
                    }
                } catch (_: Exception) {
                    cacheModels.delete()
                }
            }
            val rootCacheModels = File(root, "root/.cache/opencode/models.json")
            if (!cacheModels.exists() && rootCacheModels.exists()) {
                try { rootCacheModels.copyTo(cacheModels, overwrite = true) } catch (_: Exception) {}
            }

            // Ensure tmp directories exist with proper access
            File(root, "tmp").apply { mkdirs(); setReadable(true, false); setWritable(true, false); setExecutable(true, false) }
            File(home, "tmp").apply { mkdirs() }
            val homeBin = File(home, "bin").apply { mkdirs() }
            val rootBin = File(root, "usr/local/bin").apply { mkdirs() }
            val rootUsrBin = File(root, "usr/bin").apply { mkdirs() }

            // Helper script: openapp (Android App Launch Skill)
            val S = "$"
            val openappContent = """
                #!/bin/sh
                if [ -z "${S}1" ]; then
                    echo "Usage: openapp <app_name_or_package>"
                    exit 1
                fi
                APP="${S}*"
                echo "${S}APP" > /tmp/.openapp 2>/dev/null || true
                echo "${S}APP" > /root/.openapp 2>/dev/null || true
                echo "${S}APP" > "${S}HOME/.openapp" 2>/dev/null || true
                echo "Opening ${S}APP on Android..."
            """.trimIndent() + "\n"

            // Helper script: openpreview (In-App Web Preview Skill)
            val openpreviewContent = """
                #!/bin/sh
                TARGET="${S}{1:-.}"
                echo "${S}TARGET" > /tmp/.openpreview 2>/dev/null || echo "${S}TARGET" > "${S}HOME/.openpreview" 2>/dev/null || true
                echo "Opening web preview for ${S}TARGET..."
            """.trimIndent() + "\n"

            val t2iContent = """
                #!/usr/bin/env python3
                import base64, json, os, re, sys, time, urllib.error, urllib.request

                def load_provider():
                    cfg_path = os.path.expanduser("~/.config/opencode/opencode.json")
                    if not os.path.exists(cfg_path):
                        return None
                    try:
                        cfg = json.load(open(cfg_path, encoding="utf-8"))
                    except Exception:
                        return None
                    prov = cfg.get("provider") or {}
                    req_model = sys.argv[3] if len(sys.argv) > 3 else os.environ.get("T2I_MODEL", "")
                    req_pid = os.environ.get("T2I_PROVIDER", "")
                    candidates = []
                    for pid, p in prov.items():
                        if not isinstance(p, dict):
                            continue
                        opts = p.get("options") or {}
                        base = str(opts.get("baseURL") or "").rstrip("/")
                        key = str(opts.get("apiKey") or "")
                        if not base:
                            continue
                        models = p.get("models") or {}
                        for mid, m in models.items():
                            is_t2i = bool(isinstance(m, dict) and ((m.get("options") or {}).get("t2i") or "image" in ((m.get("modalities") or {}).get("output") or [])))
                            if re.search(r"image|flux|dall-e|imagen|sdxl|midjourney|ideogram|seedream|nano-banana|t2i", mid, re.I):
                                is_t2i = True
                            score = 0
                            if req_pid and pid == req_pid:
                                score += 10
                            if req_model and mid == req_model:
                                score += 20
                            if is_t2i:
                                score += 5
                            candidates.append((score, base, key, mid))
                    candidates.sort(key=lambda x: x[0], reverse=True)
                    return candidates[0] if candidates else None

                def main():
                    if len(sys.argv) < 2 or not sys.argv[1].strip():
                        print("Usage: t2i <prompt> [out.png] [model_id]", file=sys.stderr)
                        sys.exit(1)
                    prompt = sys.argv[1].strip()
                    out_path = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2].strip() else f"/root/.cache/opencode-mob/media/t2i_{int(time.time()*1000)}.png"
                    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
                    pick = load_provider()
                    if not pick:
                        print("ERROR: No custom API provider with baseURL configured for T2I.", file=sys.stderr)
                        sys.exit(2)
                    _, base, key, model = pick
                    if base.endswith("/v1"):
                        img_ep = base + "/images/generations"
                        chat_ep = base + "/chat/completions"
                    else:
                        img_ep = base + "/v1/images/generations"
                        chat_ep = base + "/v1/chat/completions"
                    hdr = {"Content-Type": "application/json"}
                    if key:
                        hdr["Authorization"] = "Bearer " + key
                    img_bytes = None
                    try:
                        req = urllib.request.Request(img_ep, data=json.dumps({"model": model, "prompt": prompt, "n": 1}).encode("utf-8"), headers=hdr)
                        with urllib.request.urlopen(req, timeout=90) as r:
                            res = json.loads(r.read().decode("utf-8", "replace"))
                        item = (res.get("data") or [{}])[0]
                        if item.get("b64_json"):
                            img_bytes = base64.b64decode(item["b64_json"])
                        elif item.get("url"):
                            with urllib.request.urlopen(item["url"], timeout=60) as ir:
                                img_bytes = ir.read()
                    except Exception:
                        img_bytes = None
                    if img_bytes is None:
                        try:
                            req = urllib.request.Request(chat_ep, data=json.dumps({"model": model, "messages": [{"role": "user", "content": prompt}]}).encode("utf-8"), headers=hdr)
                            with urllib.request.urlopen(req, timeout=90) as r:
                                res = json.loads(r.read().decode("utf-8", "replace"))
                            msg = ((res.get("choices") or [{}])[0].get("message") or {})
                            imgs = msg.get("images") or []
                            if imgs:
                                u = (imgs[0].get("image_url") or {}).get("url") or imgs[0].get("url") or ""
                                if u.startswith("data:image/"):
                                    img_bytes = base64.b64decode(u.split(",", 1)[1])
                                elif u.startswith("http"):
                                    with urllib.request.urlopen(u, timeout=60) as ir:
                                        img_bytes = ir.read()
                            if img_bytes is None and isinstance(msg.get("content"), str):
                                m = re.search(r"data:image/[a-zA-Z0-9+]+;base64,([A-Za-z0-9+/=]+)", msg["content"])
                                if m:
                                    img_bytes = base64.b64decode(m.group(1))
                        except Exception as e:
                            print(f"ERROR: T2I request failed: {e}", file=sys.stderr)
                            sys.exit(3)
                    if not img_bytes:
                        print("ERROR: Model returned no image payload.", file=sys.stderr)
                        sys.exit(4)
                    with open(out_path, "wb") as f:
                        f.write(img_bytes)
                    abs_p = os.path.abspath(out_path)
                    print(f"MEDIA_SAVED:{abs_p}")
                    print(f"![Generated Image]({abs_p})")

                if __name__ == "__main__":
                    main()
            """.trimIndent() + "\n"

            val appBins = listOf(
                File(rootBin, "openapp"), File(rootBin, "open-app"),
                File(rootUsrBin, "openapp"), File(homeBin, "openapp")
            )
            for (f in appBins) {
                try {
                    f.writeText(openappContent)
                    Os.chmod(f.path, 0x1ED)
                } catch (_: Exception) {}
            }

            val prevBins = listOf(
                File(rootBin, "openpreview"), File(rootBin, "open-preview"),
                File(rootUsrBin, "openpreview"), File(homeBin, "openpreview")
            )
            for (f in prevBins) {
                try {
                    f.writeText(openpreviewContent)
                    Os.chmod(f.path, 0x1ED)
                } catch (_: Exception) {}
            }

            val t2iBins = listOf(File(rootBin, "t2i"), File(rootUsrBin, "t2i"), File(homeBin, "t2i"))
            for (f in t2iBins) {
                try {
                    f.writeText(t2iContent)
                    Os.chmod(f.path, 0x1ED)
                } catch (_: Exception) {}
            }

            // Skills & Commands definitions
            val skillAppDir = File(cfg, "skills/open-android-app").apply { mkdirs() }
            val skillAppHome = File(home, "skills/open-android-app").apply { mkdirs() }
            val skillAppDot = File(dotOpencode, "skills/open-android-app").apply { mkdirs() }
            val skillAppContent = """
                ---
                name: open-android-app
                description: Open or switch to an installed Android application or settings screen on the user's device (Telegram, YouTube, Chrome, Settings, VK, WhatsApp, Camera, etc.).
                ---

                # Android App Launcher Skill

                Use this skill whenever the user asks to open, launch, or switch to an Android application.

                ## Execution
                Run the shell command via bash:
                ```bash
                openapp <app_name_or_package>
                ```

                Common aliases:
                - `telegram`, `tg`, `телеграм`, `телега`
                - `youtube`, `ютуб`
                - `chrome`, `browser`, `хром`, `браузер`
                - `settings`, `настройки`
                - `vk`, `вк`, `вконтакте`
                - `whatsapp`, `ватсап`
                - `camera`, `камера`
                - `photos`, `gallery`, `галерея`, `фото`
                - `calculator`, `калькулятор`
                - `files`, `файлы`, `проводник`
                - `music`, `музыка`
                - Any package name, e.g. `org.telegram.messenger`

                You can also output an interactive HUD button:
                `<button data-action="open_app" data-target="telegram">📱 Открыть Telegram</button>`
            """.trimIndent() + "\n"

            try {
                File(skillAppDir, "SKILL.md").writeText(skillAppContent)
                File(skillAppHome, "SKILL.md").writeText(skillAppContent)
                File(skillAppDot, "SKILL.md").writeText(skillAppContent)
            } catch (_: Exception) {}

            val skillPrevDir = File(cfg, "skills/web-preview").apply { mkdirs() }
            val skillPrevHome = File(home, "skills/web-preview").apply { mkdirs() }
            val skillPrevContent = """
                ---
                name: web-preview
                description: Preview HTML, CSS, JavaScript, and web projects in OpenCode Mobile's built-in web previewer.
                ---

                # Web Preview Skill

                Use this skill to view web projects and HTML files inside OpenCode Mobile.

                ## Execution
                Run the shell command:
                ```bash
                openpreview <path_to_html_or_dir>
                ```
                Examples: `openpreview index.html`, `openpreview site/index.html`

                Or output an interactive button:
                `<button data-action="preview" data-path="index.html">🌐 Предпросмотр</button>`
            """.trimIndent() + "\n"

            try {
                File(skillPrevDir, "SKILL.md").writeText(skillPrevContent)
                File(skillPrevHome, "SKILL.md").writeText(skillPrevContent)
            } catch (_: Exception) {}

            // Slash command definitions
            val cmdDir = File(cfg, "commands").apply { mkdirs() }
            try {
                File(cmdDir, "open.md").writeText("""
                    ---
                    description: Open an installed Android application
                    arguments:
                      - name: app
                        description: App name or package (e.g. telegram, youtube, settings)
                        required: true
                    ---
                    Execute: `openapp ${S}app`
                """.trimIndent() + "\n")

                File(cmdDir, "preview.md").writeText("""
                    ---
                    description: In-app web preview for HTML/CSS/JS project
                    arguments:
                      - name: path
                        description: Path to html file or project folder
                        required: false
                    ---
                    Execute: `openpreview ${S}path`
                """.trimIndent() + "\n")

            } catch (_: Exception) {}

            // Global System Prompt (AGENTS.md)
            val promptText = """
# OpenCode Mobile Environment & Instructions (v2.0.2)

You are running inside **OpenCode Mobile** directly on native Android (ARM64 / aarch64 architecture).
You have full access to a complete Linux userspace environment, terminal tools, and native Android integrations.

## 1. Environment & Architecture
- Platform: Native Android Linux Userspace (ARM64 / aarch64).
- Package manager: Always use `pkg` (`pkg install <package>`, do NOT pass `-y`) or `pip` / `npm`.
- Compilations: Target ARM64/aarch64 architecture.
- Storage: `/root` is internal storage (${'$'}HOME). `/sdcard` or `/storage/emulated/0` is shared Android storage with `noexec` restriction. Always run scripts with explicit interpreter: `python script.py`, `bash script.sh`.

## 2. Core Skill: Launching Android Applications
You have the built-in skill to open and switch to any installed Android application or system setting on the device!
Whenever the user asks you to open, launch, or switch to an app (using ANY phrasing or language, e.g. "открой телеграм", "открой тг", "можешь открыть телегу?", "запусти ютуб", "покажи на youtube", "открой хром", "запусти браузер", "открой настройки", "зайди в настройки", "открой вк", "открой камеру", "launch telegram", "open settings", etc.):
1. Execute the bash command:
   `openapp <app_name_or_package>`
   (Examples: `openapp telegram`, `openapp youtube`, `openapp chrome`, `openapp settings`, `openapp vk`, `openapp whatsapp`, `openapp camera`, `openapp calculator`, etc.)
2. Inform the user in your response that the application is opening, and include an action button for convenience:
   `<button data-action="open_app" data-target="<app_name>">Открыть <app_name></button>`

## 3. Core Skill: In-App Web Project Preview
You have the built-in skill to preview web projects (HTML, CSS, JavaScript, images) directly inside the OpenCode Mobile in-app previewer:
- To launch the in-app preview from shell, execute: `openpreview <path>` (e.g. `openpreview .`, `openpreview index.html` or `openpreview site/index.html`)
- Or include an interactive artifact button in your response:
  `<button data-action="preview" data-path="index.html">Открыть сайт</button>` (or `Открыть игру` for games)

## 4. Interactive Artifact Buttons
You can embed interactive buttons in your markdown responses (the app renders clean artifact SVG icons for them):
- `<button data-action="new_chat">Новый чат</button>`
- `<button data-action="open_app" data-target="telegram">Открыть Telegram</button>`
- `<button data-action="preview" data-path="index.html">Открыть сайт</button>`
- `<button data-action="files">Открыть Файлы</button>`
- `<button data-action="term">Терминал</button>`

## 5. Attaching & Generating Photos (T2I)
When creating, generating, plotting, or saving an image (`.png`, `.jpg`, `.jpeg`, `.webp`):
- If you are calling an image generation model via shell, use `t2i "<prompt>"` (or save any generated image inside the workspace / `/root/.cache/opencode-mob/media/`).
- Always embed the image in your response as standard Markdown `![description](/absolute/path/to/image.png)` (or `https://...` / `data:image/...`) so OpenCode Mobile displays it as a photo attachment card in chat.

## 6. Diff Statistics Reporting (MANDATORY)
At the very end of EVERY response, you MUST output a separate line with line additions and deletions:
+N -M
For example:
+120 -67
(If no files were edited, output: +0 -0)
            """.trimIndent()

            for (dir in listOf(cfg, home, dotOpencode)) {
                File(dir, "AGENTS.md").writeText("<!-- ocm:managed:start -->\n$promptText\n<!-- ocm:managed:end -->")
            }

            val readme = File(home, "README.md")
            if (readme.createNewFile()) {
                readme.writeText("""
# 🚀 OpenCode Mobile v2.0.1

Добро пожаловать в **OpenCode Mobile** — полноценную среду разработки и ИИ-ассистента на Android!

### 🌟 Возможности
- 🤖 **Топовые ИИ-модели**: Бесплатные и платные модели (Claude, GPT-4o, DeepSeek, Qwen).
- 🐧 **Настоящий Linux**: Терминал, компиляторы, Python, Node.js, Git.
- ⚡ **120Hz HUD**: Сверхплавный интерфейс с поддержкой высокой частоты обновления.
- 🌐 **Встроенный Веб-Предпросмотр**: Запуск сайтов и HTML/CSS/JS проектов прямо в приложении.
- 📱 **Интеграция с Android**: Открытие приложений агентом (`openapp telegram`).
- 📊 **Подсчёт диффов**: Автоматический вывод `+N -M` в конце сообщений.

Удачного кодинга! ✨
                """.trimIndent())
            }
        } catch (_: Exception) {}
    }

    fun updateDns(c: Context) {
        try {
            val servers = mutableListOf<String>()
            val cm = c.getSystemService(Context.CONNECTIVITY_SERVICE) as? android.net.ConnectivityManager
            val net = cm?.activeNetwork
            if (net != null) {
                val lp = cm.getLinkProperties(net)
                lp?.dnsServers?.forEach { addr ->
                    val ip = addr.hostAddress
                    if (!ip.isNullOrBlank() && !servers.contains(ip)) servers.add(ip)
                }
            }
            if (servers.isEmpty()) {
                servers.addAll(listOf("1.1.1.1", "8.8.8.8", "8.8.4.4", "9.9.9.9"))
            } else {
                servers.addAll(listOf("1.1.1.1", "8.8.8.8"))
            }
            val resolvContent = servers.distinct().joinToString("\n") { "nameserver $it" } + "\noptions timeout:2 attempts:3\n"
            val resolvFile = File(rootfs(c), "etc/resolv.conf")
            resolvFile.parentFile?.mkdirs()
            resolvFile.writeText(resolvContent)
        } catch (_: Exception) {}
    }

    @Volatile private var activeServerProc: Process? = null

    fun stopActiveServer() {
        val p = activeServerProc ?: return
        try {
            if (p.isAlive) {
                p.destroy()
                val deadline = System.currentTimeMillis() + 1500
                while (p.isAlive && System.currentTimeMillis() < deadline) {
                    Thread.sleep(50)
                }
                if (p.isAlive) {
                    p.destroyForcibly()
                    val fDeadline = System.currentTimeMillis() + 500
                    while (p.isAlive && System.currentTimeMillis() < fDeadline) {
                        Thread.sleep(50)
                    }
                }
            }
        } catch (_: Exception) {}
        if (activeServerProc === p) activeServerProc = null
    }

    fun startServer(c: Context, uid: String, port: Int, password: String, noSeccomp: Boolean): Process {
        val lib = c.applicationInfo.nativeLibraryDir
        val root = rootfs(c)
        val home = home(c, uid)
        val ptmp = File(c.filesDir, "proot-tmp").apply { mkdirs() }

        // WARP mode only: route the server through the local ProxyGate and track the instance so
        // restarts cannot leave a stale process holding the port. Default (direct) keeps the
        // original inline proot invocation and ProxyShim behaviour untouched.
        if (warpEnabled(c)) {
            stopActiveServer()
            ensureDefaults(c, uid)
            updateDns(c)
            WarpManager.init(c)
            val a = prootBase(c, uid)
            a += listOf("/usr/local/bin/opencode", "serve", "--hostname", "127.0.0.1", "--port", port.toString())
            val gateUrl = "http://127.0.0.1:${WarpManager.GATE_PORT}"
            val noProxy = "127.0.0.1,localhost,::1"
            val pb = ProcessBuilder(a).redirectErrorStream(true).directory(c.filesDir)
            pb.environment().apply {
                clear()
                put("LD_LIBRARY_PATH", lib)
                put("PROOT_LOADER", "$lib/libproot-loader.so")
                put("PROOT_TMP_DIR", ptmp.path)
                if (noSeccomp) put("PROOT_NO_SECCOMP", "1")
                put("HOME", "/root"); put("USER", "root"); put("SHELL", "/bin/bash")
                put("LANG", "C.UTF-8"); put("TERM", "xterm-256color"); put("TMPDIR", "/tmp")
                put("PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
                put("HTTP_PROXY", gateUrl); put("HTTPS_PROXY", gateUrl)
                put("http_proxy", gateUrl); put("https_proxy", gateUrl)
                put("NO_PROXY", noProxy); put("no_proxy", noProxy)
                put("OPENCODE_SERVER_USERNAME", "opencode")
                put("OPENCODE_SERVER_PASSWORD", password)
                put("OPENCODE_DISABLE_AUTOUPDATE", "1") // stay on 1.x: no `upgrade --major` behind our back
                put("OPENCODE_DISABLE_PRUNE", "1")
                put("DISABLE_TELEMETRY", "1")
                put("DO_NOT_TRACK", "1")
            }
            val proc = pb.start()
            activeServerProc = proc
            return proc
        }

        ensureDefaults(c, uid)
        val a = mutableListOf(
            "$lib/libproot.so", "--kill-on-exit", "--link2symlink", "--sysvipc", "-0",
            "-r", root.path, "-w", "/root",
            "-b", "/dev", "-b", "/proc", "-b", "/sys",
            "-b", "/dev/urandom:/dev/random",
            "-b", "/proc/self/fd:/dev/fd",
            "-b", "/proc/self/fd/0:/dev/stdin",
            "-b", "/proc/self/fd/1:/dev/stdout",
            "-b", "/proc/self/fd/2:/dev/stderr",
            "-b", "${home.path}:/root",
        )
        if (File("/storage/emulated/0").exists()) {
            a += listOf("-b", "/storage/emulated/0:/storage/emulated/0", "-b", "/storage/emulated/0:/sdcard")
        }
        a += listOf("/usr/local/bin/opencode", "serve", "--hostname", "127.0.0.1", "--port", port.toString())

        val pb = ProcessBuilder(a).redirectErrorStream(true).directory(c.filesDir)
        pb.environment().apply {
            clear()
            put("LD_LIBRARY_PATH", lib)
            put("PROOT_LOADER", "$lib/libproot-loader.so")
            put("PROOT_TMP_DIR", ptmp.path)
            if (noSeccomp) put("PROOT_NO_SECCOMP", "1")
            put("HOME", "/root"); put("USER", "root"); put("SHELL", "/bin/bash")
            put("LANG", "C.UTF-8"); put("TERM", "xterm-256color"); put("TMPDIR", "/tmp")
            put("PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
            put("OPENCODE_SERVER_USERNAME", "opencode")
            put("OPENCODE_SERVER_PASSWORD", password)
            put("OPENCODE_DISABLE_AUTOUPDATE", "1") // stay on 1.x: no `upgrade --major` behind our back
            put("OPENCODE_DISABLE_PRUNE", "1")
            put("DISABLE_TELEMETRY", "1")
            put("DO_NOT_TRACK", "1")
        }
        return pb.start()
    }

    fun waitReady(port: Int, password: String, timeoutMs: Long): Boolean = waitReady(null, port, password, timeoutMs)

    fun waitReady(proc: Process?, port: Int, password: String, timeoutMs: Long): Boolean {
        val end = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < end) {
            if (proc != null && !proc.isAlive) return false
            try {
                val con = URL("http://127.0.0.1:$port/global/health").openConnection() as HttpURLConnection
                con.connectTimeout = 800; con.readTimeout = 1500
                con.setRequestProperty("Authorization", basic(password))
                val code = con.responseCode
                con.disconnect()
                // Only 2xx proves readiness. Accepting 4xx let a foreign app that grabbed the
                // saved port masquerade as opencode: every later request failed with 404s.
                if (code in 200..299) return true
            } catch (_: Exception) {}
            Thread.sleep(500)
        }
        return false
    }

}
