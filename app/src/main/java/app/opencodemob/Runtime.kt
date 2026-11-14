package app.opencodemob

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

    fun sanitizeConfig(c: Context, uid: String, forceReset: Boolean = false) {
        try {
            val home = home(c, uid)
            val cfgDir = File(home, ".config/opencode").apply { mkdirs() }
            val configFile = File(cfgDir, "opencode.json")
            val files = listOf(configFile, File(cfgDir, "opencode.jsonc"))
            for (f in files) {
                if (!f.exists()) continue
                if (forceReset) {
                    val bak = File(cfgDir, f.name + ".bak-" + System.currentTimeMillis())
                    try { f.renameTo(bak) } catch (_: Exception) {}
                    f.writeText("{}\n")
                    continue
                }
                val txt = f.readText().trim()
                if (txt.isEmpty()) {
                    f.writeText("{}\n")
                    continue
                }
                try {
                    val obj = org.json.JSONObject(ProxyShim.stripJsoncPublic(txt))
                    val prov = obj.optJSONObject("provider")
                    if (prov != null) {
                        prov.remove("local")
                        prov.remove("ollama")
                        if (prov.length() == 0) obj.remove("provider")
                    }
                    f.writeText(obj.toString(2))
                } catch (_: Exception) {
                    val bak = File(cfgDir, f.name + ".corrupt-" + System.currentTimeMillis())
                    try { f.renameTo(bak) } catch (_: Exception) {}
                    f.writeText("{}\n")
                }
            }
            if (!configFile.exists()) {
                configFile.writeText("{}\n")
            }
        } catch (_: Exception) {}
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
# OpenCode Mobile Environment & Instructions (v2.0.1)

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

## 5. Diff Statistics Reporting (MANDATORY)
At the very end of EVERY response, you MUST output a separate line with line additions and deletions:
+N -M
For example:
+120 -67
(If no files were edited, output: +0 -0)
            """.trimIndent()

            File(cfg, "AGENTS.md").writeText(promptText)
            File(home, "AGENTS.md").writeText(promptText)
            File(dotOpencode, "AGENTS.md").writeText(promptText)

            val readme = File(home, "README.md")
            if (!readme.exists() || !readme.readText().contains("v2.0.1")) {
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

    fun startServer(c: Context, uid: String, port: Int, password: String, noSeccomp: Boolean): Process {
        ensureDefaults(c, uid)
        val lib = c.applicationInfo.nativeLibraryDir
        val root = rootfs(c)
        val home = home(c, uid)
        val ptmp = File(c.filesDir, "proot-tmp").apply { mkdirs() }

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
                if (code in 200..499) return true
            } catch (_: Exception) {}
            Thread.sleep(500)
        }
        return false
    }

}
