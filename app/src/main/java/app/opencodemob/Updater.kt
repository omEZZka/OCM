package app.opencodemob

import android.content.Context
import android.content.Intent
import android.system.Os
import androidx.core.content.FileProvider
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Two OTA layers, like `pkg upgrade` in Termux:
 *  1. the app itself  - newest APK from our GitHub Releases
 *  2. the opencode core - newest stable v1.* release, swapped inside the rootfs without reinstalling the APK
 */
object Updater {
    data class AppUpdate(val name: String, val code: Int, val url: String)

    private fun open(url: String): HttpURLConnection {
        val c = URL(url).openConnection() as HttpURLConnection
        c.setRequestProperty("User-Agent", "OpenCode-Mobile")
        c.setRequestProperty("Accept", "application/vnd.github+json")
        c.instanceFollowRedirects = true
        c.connectTimeout = 10_000; c.readTimeout = 30_000
        return c
    }

    private fun getText(url: String): String = open(url).inputStream.bufferedReader().use { it.readText() }

    fun latestApp(): AppUpdate? {
        val j = JSONObject(getText("https://api.github.com/repos/${BuildConfig.GITHUB_REPO}/releases/latest"))
        val assets = j.getJSONArray("assets")
        val re = Regex("""OpenCode-([\d.]+)-(\d+)\.apk""")
        for (i in 0 until assets.length()) {
            val a = assets.getJSONObject(i)
            val m = re.matchEntire(a.getString("name")) ?: continue
            return AppUpdate(m.groupValues[1], m.groupValues[2].toInt(), a.getString("browser_download_url"))
        }
        return null
    }

    /** Newest stable release of the 1.x line only. v2 never gets picked up. */
    fun latestCore(): String? {
        val arr = JSONArray(getText("https://api.github.com/repos/anomalyco/opencode/releases?per_page=100"))
        for (i in 0 until arr.length()) {
            val r = arr.getJSONObject(i)
            val tag = r.getString("tag_name")
            if (!r.getBoolean("prerelease") && !r.getBoolean("draft") && tag.startsWith("v1.")) return tag
        }
        return null
    }

    fun installedCore(c: Context): String =
        File(Runtime.rootfs(c), "etc/opencode-version").takeIf { it.exists() }?.readText()?.trim() ?: ""

    private fun fetchTo(url: String, dst: File, progress: (Int) -> Unit) {
        val con = open(url)
        val total = con.contentLengthLong.coerceAtLeast(1)
        var done = 0L; var last = -1
        con.inputStream.use { inp ->
            dst.outputStream().use { out ->
                val buf = ByteArray(1 shl 16)
                while (true) {
                    val n = inp.read(buf)
                    if (n <= 0) break
                    out.write(buf, 0, n); done += n
                    val p = (done * 100 / total).toInt().coerceIn(0, 100)
                    if (p != last) { last = p; progress(p) }
                }
            }
        }
    }

    fun downloadApp(c: Context, u: AppUpdate, progress: (Int) -> Unit): File {
        val f = File(File(c.cacheDir, "updates").apply { mkdirs() }, "update.apk")
        fetchTo(u.url, f, progress)
        return f
    }

    fun installApk(c: Context, f: File) {
        val uri = FileProvider.getUriForFile(c, "${c.packageName}.files", f)
        c.startActivity(
            Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    fun updateCore(c: Context, tag: String, progress: (Int) -> Unit) {
        val tgz = File(c.cacheDir, "core.tgz")
        fetchTo("https://github.com/anomalyco/opencode/releases/download/$tag/opencode-linux-arm64.tar.gz", tgz, progress)
        val bin = File(Runtime.rootfs(c), "usr/local/bin/opencode")
        val next = File(bin.path + ".new")
        var found = false
        TarArchiveInputStream(GzipCompressorInputStream(FileInputStream(tgz))).use { t ->
            var e = t.nextEntry
            while (e != null) {
                if (!e.isDirectory && e.name.substringAfterLast('/') == "opencode") {
                    next.outputStream().use { t.copyTo(it) }
                    found = true; break
                }
                e = t.nextEntry
            }
        }
        tgz.delete()
        check(found) { "opencode binary not found in archive" }
        Os.chmod(next.path, 0x1ED) // 0755
        check(next.renameTo(bin)) { "cannot replace opencode binary" }
        File(Runtime.rootfs(c), "etc/opencode-version").writeText(tag)
    }
}
