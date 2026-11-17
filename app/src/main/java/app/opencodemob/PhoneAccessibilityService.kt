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

    // ---------- node search & tap by text ----------

    private fun collectTexts(node: AccessibilityNodeInfo?, out: JSONArray, depth: Int = 0) {
        if (node == null || depth > 24 || out.length() > 400) return
        val text = node.text?.toString() ?: node.contentDescription?.toString() ?: ""
        if (text.isNotBlank()) {
            val b = Rect().also { node.getBoundsInScreen(it) }
            out.put(JSONObject()
                .put("text", text.take(120))
                .put("id", node.viewIdResourceName ?: "")
                .put("cls", (node.className ?: "").toString().substringAfterLast('.'))
                .put("clickable", node.isClickable)
                .put("x", b.centerX()).put("y", b.centerY())
                .put("w", b.width()).put("h", b.height()))
        }
        for (i in 0 until node.childCount) collectTexts(node.getChild(i), out, depth + 1)
    }

    fun screenText(): JSONObject {
        val o = JSONObject().put("package", lastPackage).put("window", lastWindow)
        val arr = JSONArray()
        try { collectTexts(rootInActiveWindow, arr) } catch (_: Exception) {}
        o.put("items", arr)
        return o
    }

    /** Finds a node whose text/description contains [query] (case-insensitive) and taps it. */
    fun tapText(query: String, exact: Boolean = false, index: Int = 0): Boolean {
        val q = query.trim().lowercase()
        if (q.isEmpty()) return false
        val matches = ArrayList<AccessibilityNodeInfo>()
        fun walk(n: AccessibilityNodeInfo?, depth: Int) {
            if (n == null || depth > 24 || matches.size > 40) return
            val t = (n.text?.toString() ?: "").lowercase()
            val d = (n.contentDescription?.toString() ?: "").lowercase()
            val hit = if (exact) t == q || d == q else t.contains(q) || d.contains(q)
            if (hit) matches.add(n)
            for (i in 0 until n.childCount) walk(n.getChild(i), depth + 1)
        }
        try { walk(rootInActiveWindow, 0) } catch (_: Exception) { return false }
        if (matches.isEmpty()) return false
        val target = matches.getOrElse(index) { matches[0] }
        // prefer a clickable ancestor
        var n: AccessibilityNodeInfo? = target
        var hops = 0
        while (n != null && !n.isClickable && hops < 6) { n = n.parent; hops++ }
        if (n != null && n.isClickable && n.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true
        val b = Rect().also { target.getBoundsInScreen(it) }
        return tap(b.centerX().toFloat(), b.centerY().toFloat())
    }

    /** Types text into the currently focused editable field. */
    fun typeText(text: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val focus = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return false
        val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
        return focus.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
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
