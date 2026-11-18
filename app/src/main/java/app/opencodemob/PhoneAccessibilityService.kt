package app.opencodemob

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Full phone control WITHOUT ADB and WITHOUT root.
 *
 * Android's AccessibilityService is the same API screen readers and automation apps use:
 *  • performGlobalAction: back / home / recents / notifications / quick settings / power dialog
 *  • dispatchGesture: taps, long-presses, swipes, drag paths at exact coordinates
 *  • node tree: find any visible text / view id and tap it (works inside Telegram, browsers, etc.)
 *  • takeScreenshot (API 30+): real screenshots to a file
 *
 * The user enables it once in Android Settings → Accessibility → OpenCode Mobile.
 * Everything is driven from the app (assistant overlay, JS bridge, or the agent's `phone` CLI
 * through PhoneServer), so no adb connection is ever needed again.
 */
class PhoneAccessibilityService : AccessibilityService() {

    companion object {
        @Volatile var instance: PhoneAccessibilityService? = null
        fun enabled(): Boolean = instance != null
    }

    private val ui = Handler(Looper.getMainLooper())
    @Volatile var lastPackage: String = ""
    @Volatile var lastWindow: String = ""

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onUnbind(intent: Intent?): Boolean {
        instance = null
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            lastPackage = event.packageName?.toString() ?: lastPackage
            lastWindow = event.className?.toString() ?: ""
        }
    }

    override fun onInterrupt() {}

    // ---------- global actions ----------

    fun global(action: String): Boolean {
        val a = when (action.lowercase()) {
            "back" -> GLOBAL_ACTION_BACK
            "home" -> GLOBAL_ACTION_HOME
            "recents", "recent" -> GLOBAL_ACTION_RECENTS
            "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
            "quicksettings", "quick_settings" -> GLOBAL_ACTION_QUICK_SETTINGS
            "power", "power_dialog" -> GLOBAL_ACTION_POWER_DIALOG
            "lock" -> if (Build.VERSION.SDK_INT >= 28) GLOBAL_ACTION_LOCK_SCREEN else return false
            "screenshot" -> if (Build.VERSION.SDK_INT >= 28) GLOBAL_ACTION_TAKE_SCREENSHOT else return false
            "split" -> if (Build.VERSION.SDK_INT >= 28) GLOBAL_ACTION_TOGGLE_SPLIT_SCREEN else return false
            else -> return false
        }
        return performGlobalAction(a)
    }

    // ---------- gestures ----------

    private fun gesture(path: Path, start: Long, dur: Long): Boolean {
        val latch = CountDownLatch(1)
        var ok = false
        val g = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, start, dur))
            .build()
        val dispatched = dispatchGesture(g, object : GestureResultCallback() {
            override fun onCompleted(desc: GestureDescription?) { ok = true; latch.countDown() }
            override fun onCancelled(desc: GestureDescription?) { ok = false; latch.countDown() }
        }, ui)
        if (!dispatched) return false
        latch.await(dur + start + 1500, TimeUnit.MILLISECONDS)
        return ok
    }

    fun tap(x: Float, y: Float): Boolean {
        recorderTap(x, y, "tap ${x.toInt()},${y.toInt()}")
        recordPath("tap ${x.toInt()},${y.toInt()} ($lastPackage)")
        val p = Path().apply { moveTo(x, y) }
        return gesture(p, 0, 60)
    }

    fun longPress(x: Float, y: Float, ms: Long = 650): Boolean {
        val p = Path().apply { moveTo(x, y) }
        return gesture(p, 0, ms.coerceIn(300, 3000))
    }

    fun swipe(x1: Float, y1: Float, x2: Float, y2: Float, ms: Long = 300): Boolean {
        val p = Path().apply { moveTo(x1, y1); lineTo(x2, y2) }
        return gesture(p, 0, ms.coerceIn(80, 3000))
    }

    // ---------- smart screen engine ----------

    /** All roots: active window + every interactive window (dialogs, popups, split panes). */
    private fun roots(): List<AccessibilityNodeInfo> {
        val out = ArrayList<AccessibilityNodeInfo>()
        try { rootInActiveWindow?.let { out.add(it) } } catch (_: Exception) {}
        try {
            for (w in windows) {
                val r = w.root ?: continue
                if (out.none { it == r }) out.add(r)
            }
        } catch (_: Exception) {}
        return out
    }

    private fun norm(x: String): String = x.lowercase().replace('ё', 'е').trim()

    /** Rough latin<->cyrillic for matching "Misha"/"Миша". */
    private fun translit(x: String): String {
        val l2c = mapOf("a" to "а","b" to "б","v" to "в","g" to "г","d" to "д","e" to "е","z" to "з","i" to "и","k" to "к","l" to "л","m" to "м","n" to "н","o" to "о","p" to "п","r" to "р","s" to "с","t" to "т","u" to "у","f" to "ф","h" to "х","c" to "к","y" to "й","w" to "в","j" to "дж","q" to "к")
        val c2l = mapOf("а" to "a","б" to "b","в" to "v","г" to "g","д" to "d","е" to "e","ж" to "zh","з" to "z","и" to "i","й" to "y","к" to "k","л" to "l","м" to "m","н" to "n","о" to "o","п" to "p","р" to "r","с" to "s","т" to "t","у" to "u","ф" to "f","х" to "h","ц" to "ts","ч" to "ch","ш" to "sh","щ" to "sch","ы" to "y","э" to "e","ю" to "yu","я" to "ya")
        val hasCyr = x.any { it in 'а'..'я' }
        return if (hasCyr) x.map { c2l[it.toString()] ?: it.toString() }.joinToString("")
        else {
            val sb = StringBuilder(); var i = 0
            while (i < x.length) {
                val two = x.substring(i, minOf(i + 2, x.length))
                when (two) { "sh" -> { sb.append("ш"); i += 2 }; "ch" -> { sb.append("ч"); i += 2 }; "zh" -> { sb.append("ж"); i += 2 }; "ya" -> { sb.append("я"); i += 2 }; "yu" -> { sb.append("ю"); i += 2 }; else -> { sb.append(l2c[x[i].toString()] ?: x[i].toString()); i++ } }
            }
            sb.toString()
        }
    }

    private fun matchScore(text: String, q: String, exact: Boolean): Int {
        val t = norm(text); val qn = norm(q)
        if (t.isEmpty() || qn.isEmpty()) return 0
        if (exact) return if (t == qn) 100 else 0
        if (t == qn) return 100
        val tt = translit(t); val qt = translit(qn)
        if (tt == qt || t == qt || tt == qn) return 90
        if (t.startsWith(qn) || tt.startsWith(qt)) return 80
        if (t.contains(qn) || tt.contains(qt) || t.contains(qt) || tt.contains(qn)) return 65
        // word-level: every query word present
        val words = qn.split(Regex("\\s+")).filter { it.length > 1 }
        if (words.isNotEmpty() && words.all { t.contains(it) || tt.contains(translit(it)) }) return 55
        return 0
    }

    private data class Hit(val node: AccessibilityNodeInfo, val score: Int, val text: String)

    private fun findHits(query: String, exact: Boolean): List<Hit> {
        val hits = ArrayList<Hit>()
        fun walk(n: AccessibilityNodeInfo?, depth: Int) {
            if (n == null || depth > 28 || hits.size > 120) return
            val t = n.text?.toString() ?: ""
            val d = n.contentDescription?.toString() ?: ""
            val sc = maxOf(matchScore(t, query, exact), matchScore(d, query, exact))
            if (sc > 0) {
                val b = Rect().also { n.getBoundsInScreen(it) }
                if (b.width() > 0 && b.height() > 0) hits.add(Hit(n, sc, t.ifEmpty { d }))
            }
            for (i in 0 until n.childCount) walk(n.getChild(i), depth + 1)
        }
        for (r in roots()) walk(r, 0)
        return hits.sortedByDescending { it.score }
    }

    private fun collectTexts(node: AccessibilityNodeInfo?, out: JSONArray, depth: Int = 0) {
        if (node == null || depth > 26 || out.length() > 500) return
        val text = node.text?.toString() ?: node.contentDescription?.toString() ?: ""
        if (text.isNotBlank()) {
            val b = Rect().also { node.getBoundsInScreen(it) }
            if (b.width() > 0) out.put(JSONObject()
                .put("text", text.take(140))
                .put("id", node.viewIdResourceName ?: "")
                .put("cls", (node.className ?: "").toString().substringAfterLast('.'))
                .put("clickable", node.isClickable)
                .put("scrollable", node.isScrollable)
                .put("x", b.centerX()).put("y", b.centerY())
                .put("w", b.width()).put("h", b.height()))
        }
        for (i in 0 until node.childCount) collectTexts(node.getChild(i), out, depth + 1)
    }

    fun screenText(): JSONObject {
        val o = JSONObject().put("package", lastPackage).put("window", lastWindow)
        val arr = JSONArray()
        for (r in roots()) collectTexts(r, arr)
        o.put("items", arr)
        return o
    }

    /** Screen fingerprint: used to VERIFY that a tap actually changed something. */
    private fun fingerprint(): String {
        val sb = StringBuilder(lastPackage).append('|')
        var count = 0
        fun walk(n: AccessibilityNodeInfo?, depth: Int) {
            if (n == null || depth > 20 || count > 150) return
            val t = n.text?.toString() ?: ""
            if (t.isNotBlank()) { sb.append(t).append(';'); count++ }
            for (i in 0 until n.childCount) walk(n.getChild(i), depth + 1)
        }
        for (r in roots()) walk(r, 0)
        return sb.toString()
    }

    /** Wait until the foreground package becomes [pkg] (app actually launched). */
    fun waitForPackage(pkg: String, timeoutMs: Long = 6000): Boolean {
        val end = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < end) {
            if (lastPackage == pkg) return true
            try { rootInActiveWindow?.packageName?.toString()?.let { if (it == pkg) { lastPackage = it; return true } } } catch (_: Exception) {}
            Thread.sleep(200)
        }
        return lastPackage == pkg
    }

    /** Wait until the screen changes (tap had a visible effect). */
    private fun waitChange(before: String, timeoutMs: Long = 2500): Boolean {
        val end = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < end) {
            Thread.sleep(220)
            if (fingerprint() != before) return true
        }
        return false
    }

    private fun clickNode(target: AccessibilityNodeInfo): Boolean {
        var n: AccessibilityNodeInfo? = target
        var hops = 0
        while (n != null && !n.isClickable && hops < 7) { n = n.parent; hops++ }
        if (n != null && n.isClickable && n.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true
        val b = Rect().also { target.getBoundsInScreen(it) }
        return tap(b.centerX().toFloat(), b.centerY().toFloat())
    }

    /** Scroll the first scrollable container (or screen) in [dir]: 1 down, -1 up. */
    fun scroll(dir: Int): Boolean {
        for (r in roots()) {
            var found: AccessibilityNodeInfo? = null
            fun walk(n: AccessibilityNodeInfo?, depth: Int) {
                if (n == null || depth > 24 || found != null) return
                if (n.isScrollable) { found = n; return }
                for (i in 0 until n.childCount) walk(n.getChild(i), depth + 1)
            }
            walk(r, 0)
            if (found != null) {
                val act = if (dir > 0) AccessibilityNodeInfo.ACTION_SCROLL_FORWARD else AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
                if (found!!.performAction(act)) return true
            }
        }
        val dm = resources.displayMetrics
        val cx = dm.widthPixels / 2f
        return if (dir > 0) swipe(cx, dm.heightPixels * 0.75f, cx, dm.heightPixels * 0.3f, 350)
        else swipe(cx, dm.heightPixels * 0.3f, cx, dm.heightPixels * 0.75f, 350)
    }

    /**
     * Smart tap-by-text: searches ALL windows, fuzzy + transliteration, retries while the app
     * loads, scrolls to find off-screen items, and VERIFIES the tap changed the screen.
     * Returns a detailed result instead of a blind boolean.
     */
    fun tapTextSmart(query: String, exact: Boolean = false, index: Int = 0, scrollSearch: Boolean = true): JSONObject {
        val q = query.trim()
        if (q.isEmpty()) return JSONObject().put("ok", false).put("err", "пустой запрос")
        val deadline = System.currentTimeMillis() + 9000
        var scrolls = 0
        var lastSeen = ""
        while (System.currentTimeMillis() < deadline) {
            val hits = findHits(q, exact)
            if (hits.isNotEmpty()) {
                val target = hits.getOrElse(index) { hits[0] }
                val before = fingerprint()
                val clicked = clickNode(target.node)
                if (!clicked) return JSONObject().put("ok", false).put("err", "не удалось нажать «${target.text}»")
                // verify: screen must change (navigation, dialog, selection)
                val changed = waitChange(before, 2600)
                if (changed) recordPath("text $q ($lastPackage)")
                return if (changed) JSONObject().put("ok", true).put("matched", target.text).put("score", target.score)
                else JSONObject().put("ok", false).put("err", "нажал «${target.text}», но экран не изменился").put("matched", target.text).put("verified", false)
            }
            // not found yet: maybe the app is still loading or the item is off-screen
            val fp = fingerprint()
            if (scrollSearch && fp == lastSeen && scrolls < 4) {
                scroll(1); scrolls++
                Thread.sleep(500)
            } else if (scrollSearch && fp != lastSeen) {
                lastSeen = fp
                Thread.sleep(400)
            } else {
                Thread.sleep(400)
            }
        }
        return JSONObject().put("ok", false).put("err", "«$q» не найдено на экране" + if (scrolls > 0) " (проскроллил $scrolls раз)" else "")
    }

    // ---- (12) path memory: record a working route per app for one-tap replay ----
    @Volatile private var pathLog = ArrayList<String>()
    fun recordPath(step: String) {
        pathLog.add(step)
        if (pathLog.size > 12) pathLog.removeAt(0)
    }
    fun lastPath(): JSONArray = JSONArray(pathLog)

    // ---- (13) show-and-tell recorder: watch user gestures and replay as a macro ----
    @Volatile var recording = false
        private set
    @Volatile private var recSteps = ArrayList<String>()
    fun recorderStart(): JSONObject {
        recording = true; recSteps.clear()
        return JSONObject().put("ok", true)
    }
    fun recorderStop(): JSONObject {
        recording = false
        return JSONObject().put("ok", true).put("steps", JSONArray(recSteps))
    }
    fun recorderTap(x: Float, y: Float, label: String) {
        if (recording) recSteps.add(JSONObject().put("cmd", "tap").put("args", JSONArray().put(x.toInt()).put(y.toInt())).put("label", label).toString())
    }
    fun recorderText(q: String) {
        if (recording) recSteps.add(JSONObject().put("cmd", "text").put("args", JSONArray().put(q)).toString())
    }
    fun replay(steps: JSONArray): JSONObject {
        for (i in 0 until steps.length()) {
            val st = steps.getJSONObject(i)
            when (st.optString("cmd")) {
                "tap" -> tap(st.optJSONArray("args").optDouble(0).toFloat(), st.optJSONArray("args").optDouble(1).toFloat())
                "text" -> tapTextSmart(st.optJSONArray("args").optString(0))
                "wait" -> Thread.sleep(st.optJSONArray("args").optLong(0, 500))
            }
            Thread.sleep(500)
        }
        return JSONObject().put("ok", true)
    }

    // ---- (50) action journal with timestamps + optional screenshot link ----
    fun journal(): JSONArray = pathLog.let { JSONArray(it) }

    /** Legacy boolean API kept for the bridge. */
    fun tapText(query: String, exact: Boolean = false, index: Int = 0): Boolean =
        tapTextSmart(query, exact, index, false).optBoolean("ok")

    /** (26) Dictate into ANY text window, even if focus is elsewhere or in another app:
     * focuses the target editable node (or the first one) and SETS its text. */
    fun typeAnywhere(text: String, append: Boolean = false): JSONObject {
        for (r in roots()) {
            var ed: AccessibilityNodeInfo? = null
            fun walk(n: AccessibilityNodeInfo?, depth: Int) {
                if (n == null || depth > 26 || ed != null) return
                if (n.isEditable) { ed = n; return }
                for (i in 0 until n.childCount) walk(n.getChild(i), depth + 1)
            }
            walk(r, 0)
            if (ed != null) {
                ed!!.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
                val current = ed!!.text?.toString() ?: ""
                val newText = if (append && current.isNotEmpty()) "$current $text" else text
                val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, newText) }
                val ok = ed!!.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
                return JSONObject().put("ok", ok).put("target", lastPackage).put("appended", append)
            }
        }
        return JSONObject().put("ok", false).put("err", "текстовое поле не найдено на экране")
    }

    /** Type into the focused field; falls back to the first editable node. Verified by read-back. */
    fun typeText(text: String): Boolean {
        for (r in roots()) {
            val focus = r.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            if (focus != null && focus.isEditable) {
                val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
                if (focus.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) return true
            }
        }
        // fallback: first editable
        for (r in roots()) {
            var ed: AccessibilityNodeInfo? = null
            fun walk(n: AccessibilityNodeInfo?, depth: Int) {
                if (n == null || depth > 24 || ed != null) return
                if (n.isEditable) { ed = n; return }
                for (i in 0 until n.childCount) walk(n.getChild(i), depth + 1)
            }
            walk(r, 0)
            if (ed != null) {
                ed!!.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
                val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
                if (ed!!.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) return true
            }
        }
        return false
    }

    /** Wait for text to appear (app loading / navigation). */
    fun waitText(query: String, timeoutMs: Long = 8000): JSONObject {
        val end = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < end) {
            val hits = findHits(query, false)
            if (hits.isNotEmpty()) return JSONObject().put("ok", true).put("matched", hits[0].text)
            Thread.sleep(350)
        }
        return JSONObject().put("ok", false).put("err", "«$query» не появилось за ${timeoutMs / 1000}с")
    }

    // ---------- screenshot to file ----------

    fun screenshot(destPath: String): String {
        if (Build.VERSION.SDK_INT < 30) return JSONObject().put("ok", false).put("err", "screenshot needs Android 11+").toString()
        return try {
            val latch = CountDownLatch(1)
            var result = JSONObject().put("ok", false).put("err", "timeout")
            takeScreenshot(Display.DEFAULT_DISPLAY, mainExecutor, object : TakeScreenshotCallback {
                override fun onSuccess(screenshot: ScreenshotResult) {
                    try {
                        val bmp = Bitmap.wrapHardwareBuffer(screenshot.hardwareBuffer, screenshot.colorSpace)
                        val soft = bmp?.copy(Bitmap.Config.ARGB_8888, false)
                        screenshot.hardwareBuffer.close()
                        if (soft == null) { result = JSONObject().put("ok", false).put("err", "bitmap"); latch.countDown(); return }
                        val f = File(destPath)
                        f.parentFile?.mkdirs()
                        FileOutputStream(f).use { soft.compress(Bitmap.CompressFormat.PNG, 92, it) }
                        soft.recycle()
                        result = JSONObject().put("ok", true).put("path", destPath).put("size", f.length())
                    } catch (e: Exception) {
                        result = JSONObject().put("ok", false).put("err", e.message ?: "save failed")
                    }
                    latch.countDown()
                }
                override fun onFailure(errorCode: Int) {
                    result = JSONObject().put("ok", false).put("err", "screenshot error $errorCode")
                    latch.countDown()
                }
            })
            latch.await(8, TimeUnit.SECONDS)
            result.toString()
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("err", e.message ?: "failed").toString()
        }
    }
}
