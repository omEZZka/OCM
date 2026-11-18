package app.opencodemob

import android.app.Service
import android.content.Intent
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.view.animation.AlphaAnimation
import android.view.animation.Animation
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject

/**
 * Minimal assistant pill.
 *
 * One row: [mic] [text field] [send] [✕]. A single status line appears only while working or
 * showing a result. No chips, no big buttons, no header — the smallest useful surface.
 * Stays open after each command; closes via ✕ or 90 s idle.
 */
class AssistantOverlayService : Service() {

    companion object {
        @Volatile var instance: AssistantOverlayService? = null
        fun show(c: android.content.Context) {
            try {
                val i = Intent(c, AssistantOverlayService::class.java)
                if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i) else c.startService(i)
            } catch (_: Exception) {}
        }
        fun hide(c: android.content.Context) { try { c.stopService(Intent(c, AssistantOverlayService::class.java)) } catch (_: Exception) {} }
    }

    private var wm: WindowManager? = null
    private var card: LinearLayout? = null
    private var input: EditText? = null
    private var status: TextView? = null
    private var micBtn: ImageButton? = null
    private val ui = Handler(Looper.getMainLooper())
    var emit: ((String, JSONObject) -> Unit)? = null
    private var stt: SpeechInput? = null
    private var listening = false
    private var busy = false
    private var idleTimer: Runnable? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        instance = this
        if (!android.provider.Settings.canDrawOverlays(this)) { stopSelf(); return START_NOT_STICKY }
        startForegroundCompat()
        if (card == null) attach()
        card?.visibility = View.VISIBLE
        resetIdle()
        if (Prefs.get(this, "assistant.wakeEnabled", "0") == "1") startWakeLoop()
        return START_NOT_STICKY
    }

    private fun startForegroundCompat() {
        try {
            val nm = getSystemService(android.app.NotificationManager::class.java)
            if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(android.app.NotificationChannel("assistant", "Assistant", android.app.NotificationManager.IMPORTANCE_MIN))
            val open = android.app.PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT)
            val n = androidx.core.app.NotificationCompat.Builder(this, "assistant")
                .setSmallIcon(R.drawable.ic_tile_server).setContentTitle("Assistant")
                .setOngoing(true).setPriority(androidx.core.app.NotificationCompat.PRIORITY_MIN).setContentIntent(open).build()
            if (Build.VERSION.SDK_INT >= 34) startForeground(7, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            else startForeground(7, n)
        } catch (_: Exception) {}
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
    private fun bg(color: Int, radius: Int): GradientDrawable =
        GradientDrawable().apply { cornerRadius = dp(radius).toFloat(); setColor(color) }

    private fun resetIdle() {
        idleTimer?.let { ui.removeCallbacks(it) }
        idleTimer = Runnable { if (!busy && !listening) hideSelf() }
        ui.postDelayed(idleTimer!!, 90_000)
    }

    private fun attach() {
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        val sw = resources.displayMetrics.widthPixels

        card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = bg(0xF2141419.toInt(), 26)
            setPadding(dp(10), dp(8), dp(8), dp(8))
            elevation = dp(16).toFloat()
        }

        // single row: mic · input · send · close
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }

        micBtn = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_btn_speak_now)
            background = bg(0xFF26262E.toInt(), 20)
            setColorFilter(0xFFFAB283.toInt())
            setOnClickListener { toggleMic() }
        }
        row.addView(micBtn, LinearLayout.LayoutParams(dp(40), dp(40)))

        input = EditText(this).apply {
            hint = "Команда…"
            setHintTextColor(0xFF5C5C66.toInt()); setTextColor(0xFFF5F5F7.toInt()); textSize = 14f
            inputType = InputType.TYPE_CLASS_TEXT
            maxLines = 1
            background = null
            setPadding(dp(12), dp(8), dp(8), dp(8))
            imeOptions = EditorInfo.IME_ACTION_SEND
            setOnEditorActionListener { _, actionId, event ->
                if (actionId == EditorInfo.IME_ACTION_SEND || (event != null && event.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)) { submit(); true } else false
            }
        }
        row.addView(input, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

        val send = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_menu_send)
            background = bg(0xFFFAB283.toInt(), 20)
            setColorFilter(0xFF141419.toInt())
            setOnClickListener { submit() }
        }
        row.addView(send, LinearLayout.LayoutParams(dp(40), dp(40)).apply { marginEnd = dp(6) })

        val close = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_menu_close_clear_cancel)
            background = null
            setColorFilter(0xFF77777F.toInt())
            setOnClickListener { hideSelf() }
        }
        row.addView(close, LinearLayout.LayoutParams(dp(30), dp(30)))

        card!!.addView(row)

        // status line: hidden until needed
        status = TextView(this).apply {
            visibility = View.GONE
            setTextColor(0xFF9A9AA5.toInt()); textSize = 11.5f
            setPadding(dp(12), dp(4), dp(10), dp(2))
            maxLines = 4
        }
        card!!.addView(status)
        applyMode()

        val width = (sw * 0.94f).toInt().coerceAtMost(dp(440))
        val p = WindowManager.LayoutParams(
            width, WindowManager.LayoutParams.WRAP_CONTENT,
            if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            y = dp(22)
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
        }
        try {
            wm?.addView(card, p)
            card!!.startAnimation(AlphaAnimation(0f, 1f).apply { duration = 160 })
        } catch (_: Exception) { stopSelf() }
    }

    // (73) mini-mode: hide result area, keep only the pill row
    private var miniMode = Prefs.get(this, "assistant.miniMode", "1") == "1"
    private fun applyMode() {
        if (miniMode) { status?.visibility = View.GONE } else status?.visibility = if (status?.text?.isNotEmpty() == true) View.VISIBLE else View.GONE
    }

    private fun setStatus(text: String, visible: Boolean = true) {
        status?.text = text
        status?.visibility = if (visible && text.isNotEmpty()) View.VISIBLE else View.GONE
    }

    // ---- (21) wake-without-button: continuous low-cost listening for the wake phrase ----
    private var wakeLoop = false
    private var wakeRecognizer: SpeechInput? = null
    private fun startWakeLoop() {
        if (wakeLoop) return
        wakeLoop = true
        if (wakeRecognizer == null) wakeRecognizer = SpeechInput(this) { n, d ->
            if (n != "stt") return@SpeechInput
            ui.post {
                if (d.optString("t") == "final" && d.optString("text").isNotBlank()) {
                    val phrase = d.optString("text").lowercase()
                    val wake = Prefs.get(this, "assistant.wakePhrase", "окей код").lowercase()
                    if (wake.isNotEmpty() && phrase.contains(wake)) {
                        // wake phrase heard: open assistant and hand the rest to it
                        wakeRecognizer?.stop()
                        wakeLoop = false
                        if (card?.visibility != View.VISIBLE) show(this)
                        val rest = d.optString("text").substringAfter(wake, "").trimStart(' ', ',', '.')
                        if (rest.isNotBlank()) {
                            input?.setText(rest)
                            ui.postDelayed({ submit() }, 250)
                        } else {
                            ui.postDelayed({ toggleMic() }, 250)
                        }
                    } else {
                        // not the wake phrase: keep listening without opening anything
                        if (wakeLoop) ui.postDelayed({ startWakeLoop() }, 500)
                    }
                } else if (wakeLoop && d.optString("t") != "partial") {
                    ui.postDelayed({ startWakeLoop() }, 1200)
                }
            }
        }
        wakeRecognizer?.start("system", if (Prefs.get(this, "lang") == "en") "en-US" else "ru-RU", arrayOf(Prefs.get(this, "assistant.wakePhrase", "окей код")), false)
    }
    private fun stopWakeLoop() {
        wakeLoop = false
        try { wakeRecognizer?.stop() } catch (_: Exception) {}
    }

    // ---------- voice ----------
    private fun toggleMic() {
        resetIdle()
        if (listening) { stopVoice(); return }
        listening = true
        micBtn?.setColorFilter(0xFFF87171.toInt())
        micBtn?.startAnimation(AlphaAnimation(0.5f, 1f).apply { duration = 600; repeatMode = Animation.REVERSE; repeatCount = Animation.INFINITE })
        setStatus("Слушаю…")
        if (stt == null) stt = SpeechInput(this) { n, d ->
            if (n != "stt") return@SpeechInput
            ui.post {
                when (d.optString("t")) {
                    "partial" -> { val t = d.optString("text"); input?.setText(t); input?.setSelection(t.length) }
                    "final" -> { val t = d.optString("text"); stopVoice(); if (t.isNotBlank()) { input?.setText(t); submit() } }
                    "empty" -> { stopVoice(); setStatus("Не расслышал") }
                    "error" -> { stopVoice(); setStatus("Ошибка микрофона") }
                }
            }
        }
        stt?.start("system", if (Prefs.get(this, "lang") == "en") "en-US" else "ru-RU", emptyArray(), true)
    }

    private fun stopVoice() {
        listening = false
        micBtn?.clearAnimation()
        micBtn?.setColorFilter(0xFFFAB283.toInt())
        try { stt?.stop() } catch (_: Exception) {}
    }

    // ---------- submit ----------
    private fun submit() {
        val t = input?.text?.toString()?.trim() ?: ""
        if (t.isEmpty() || busy) return
        resetIdle()
        stopVoice()
        input?.setText("")
        busy = true
        setStatus("…")
        AssistantCore.runPhrase(this, t,
            onStatus = { s -> setStatus(s + "…") },
            onDone = { ok, summary ->
                busy = false
                if (!ok && summary.startsWith("AGENT:")) {
                    val query = summary.removePrefix("AGENT:")
                    emit?.invoke("assistantQuery", JSONObject().put("text", query).put("source", "overlay"))
                    setStatus("→ агент")
                    try {
                        startActivity(Intent(this, MainActivity::class.java)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            .putExtra("widget_action", "assistant_agent").putExtra("widget_target", query))
                    } catch (_: Exception) {}
                    ui.postDelayed({ setStatus("", false) }, 2500)
                } else {
                    // (27) speak result when TTS is enabled
                    if (Prefs.get(this, "assistant.tts", "0") == "1" && summary.isNotBlank())
                        AssistantIntegrations.speak(this, summary, Prefs.get(this, "assistant.rate", "1.0").toFloatOrNull() ?: 1.0f)
                    if (miniMode) setStatus(if (ok) "✓" else summary, ok || summary.isNotEmpty())
                    else setStatus(if (ok) "✓ " + summary.replace("\n", " · ") else summary.replace("\n", " · "))
                    // result stays visible; window stays open for the next command
                }
                resetIdle()
            })
    }

    fun showResult(text: String, ok: Boolean) {
        ui.post { busy = false; setStatus((if (ok) "✓ " else "") + text); resetIdle() }
    }
    fun setStatusText(text: String) { ui.post { setStatus(text); resetIdle() } }
    fun setPartial(text: String) { ui.post { input?.setText(text); input?.setSelection(text.length) } }

    private fun hideSelf() {
        stopVoice()
        stopWakeLoop()
        idleTimer?.let { ui.removeCallbacks(it) }
        stopSelf()
    }

    override fun onDestroy() {
        instance = null
        try { stt?.stop() } catch (_: Exception) {}
        idleTimer?.let { ui.removeCallbacks(it) }
        try { card?.let { wm?.removeView(it) } } catch (_: Exception) {}
        card = null
        super.onDestroy()
    }
}
