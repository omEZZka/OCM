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
import android.widget.ProgressBar
import android.widget.TextView
import org.json.JSONObject

/**
 * Assistant mini window — stays open for a conversation, not a one-shot toast.
 *
 * Design: a compact rounded card with a clear visual hierarchy:
 *   header (title + close) · status line · big mic button (primary action) ·
 *   text field + send · quick chips · result area.
 * After a command finishes the window stays open so the next request is one tap away;
 * it closes only via ✕, the back gesture, or an explicit long idle timeout.
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
    private var answer: TextView? = null
    private var micBtn: ImageButton? = null
    private var micRing: View? = null
    private var progress: ProgressBar? = null
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
        return START_NOT_STICKY
    }

    private fun startForegroundCompat() {
        try {
            val nm = getSystemService(android.app.NotificationManager::class.java)
            if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(android.app.NotificationChannel("assistant", "Assistant", android.app.NotificationManager.IMPORTANCE_MIN))
            val open = android.app.PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT)
            val n = androidx.core.app.NotificationCompat.Builder(this, "assistant")
                .setSmallIcon(R.drawable.ic_tile_server).setContentTitle("OpenCode Assistant")
                .setContentText("Ассистент").setOngoing(true)
                .setPriority(androidx.core.app.NotificationCompat.PRIORITY_MIN).setContentIntent(open).build()
            if (Build.VERSION.SDK_INT >= 34) startForeground(7, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            else startForeground(7, n)
        } catch (_: Exception) {}
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
    private fun bg(color: Int, radius: Int, stroke: Int = 0, strokeColor: Int = 0): GradientDrawable =
        GradientDrawable().apply { cornerRadius = dp(radius).toFloat(); setColor(color); if (stroke > 0) setStroke(dp(stroke), strokeColor) }

    /** Long idle (90 s) auto-hide; any interaction resets it. Never closes right after a command. */
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
            background = bg(0xFA141419.toInt(), 28, 1, 0xFF33333C.toInt())
            setPadding(dp(20), dp(18), dp(20), dp(18))
            elevation = dp(24).toFloat()
        }

        // ---- header ----
        val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val logo = View(this).apply { background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            colors = intArrayOf(0xFFFAB283.toInt(), 0xFFF97316.toInt())
            gradientType = GradientDrawable.LINEAR_GRADIENT
            orientation = GradientDrawable.Orientation.TL_BR
        } }
        header.addView(logo, LinearLayout.LayoutParams(dp(12), dp(12)).apply { marginEnd = dp(10) })
        header.addView(TextView(this).apply {
            text = "Ассистент"; setTextColor(0xFFF5F5F7.toInt()); textSize = 15f
            setTypeface(typeface, Typeface.BOLD); letterSpacing = 0.01f
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        val close = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_menu_close_clear_cancel)
            background = bg(0xFF23232B.toInt(), 15)
            setColorFilter(0xFFA0A0AA.toInt())
            setOnClickListener { hideSelf() }
        }
        header.addView(close, LinearLayout.LayoutParams(dp(32), dp(32)))
        card!!.addView(header)

        // ---- status ----
        status = TextView(this).apply {
            text = "Чем помочь?"; setTextColor(0xFF9A9AA5.toInt()); textSize = 12.5f
            setPadding(0, dp(10), 0, dp(4))
        }
        card!!.addView(status)

        // ---- big mic: the primary action, centered ----
        val micArea = FrameLayout(this).apply { setPadding(0, dp(6), 0, dp(6)) }
        micRing = View(this).apply { background = bg(0x2EF97316.toInt(), 34); visibility = View.GONE }
        micArea.addView(micRing, FrameLayout.LayoutParams(dp(68), dp(68), Gravity.CENTER))
        micBtn = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_btn_speak_now)
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                colors = intArrayOf(0xFF2A2A33.toInt(), 0xFF1E1E26.toInt())
                gradientType = GradientDrawable.LINEAR_GRADIENT
                orientation = GradientDrawable.Orientation.TOP_BOTTOM
                setStroke(dp(1), 0xFF3A3A45.toInt())
            }
            setColorFilter(0xFFFAB283.toInt())
            scaleType = android.widget.ImageView.ScaleType.CENTER
            setOnClickListener { toggleMic() }
        }
        micArea.addView(micBtn, FrameLayout.LayoutParams(dp(60), dp(60), Gravity.CENTER))
        progress = ProgressBar(this).apply { visibility = View.GONE; isIndeterminate = true }
        micArea.addView(progress, FrameLayout.LayoutParams(dp(72), dp(72), Gravity.CENTER))
        card!!.addView(micArea, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        // ---- text row: field + send ----
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        input = EditText(this).apply {
            hint = "или напишите…"
            setHintTextColor(0xFF5A5A64.toInt()); setTextColor(0xFFF5F5F7.toInt()); textSize = 14.5f
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            maxLines = 3
            background = bg(0xFF1F1F27.toInt(), 16, 1, 0xFF2C2C36.toInt())
            setPadding(dp(14), dp(11), dp(14), dp(11))
            imeOptions = EditorInfo.IME_ACTION_SEND
            setOnEditorActionListener { _, actionId, event ->
                if (actionId == EditorInfo.IME_ACTION_SEND || (event != null && event.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)) { submit(); true } else false
            }
        }
        val send = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_menu_send)
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                colors = intArrayOf(0xFFFAB283.toInt(), 0xFFF97316.toInt())
                gradientType = GradientDrawable.LINEAR_GRADIENT
                orientation = GradientDrawable.Orientation.TL_BR
            }
            setColorFilter(0xFF141419.toInt())
            setOnClickListener { submit() }
        }
        row.addView(input, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(send, LinearLayout.LayoutParams(dp(46), dp(46)).apply { marginStart = dp(9) })
        card!!.addView(row)

        // ---- quick chips: two rows, even spacing ----
        val chipDefs = listOf(
            listOf("📸 Скрин" to "shot", "🔦 Фонарик" to "torch", "🔕 Тишина" to "dnd"),
            listOf("🏠 Домой" to "home", "← Назад" to "back", "🔔 Шторка" to "notifications")
        )
        chipDefs.forEach { rowDefs ->
            val chips = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(8), 0, 0) }
            rowDefs.forEach { (label, cmd) ->
                chips.addView(TextView(this).apply {
                    text = label; setTextColor(0xFFD0D0D8.toInt()); textSize = 12f
                    background = bg(0xFF22222A.toInt(), 13, 1, 0xFF2E2E38.toInt())
                    setPadding(dp(12), dp(8), dp(12), dp(8))
                    gravity = Gravity.CENTER
                    setOnClickListener { resetIdle(); runNative(cmd) }
                }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(6) })
            }
            card!!.addView(chips)
        }

        // ---- result ----
        answer = TextView(this).apply {
            visibility = View.GONE; setTextColor(0xFFDCDCE4.toInt()); textSize = 13f
            maxLines = 12; setPadding(dp(2), dp(12), dp(2), 0); setLineSpacing(dp(3).toFloat(), 1f)
        }
        card!!.addView(answer)

        val width = (sw * 0.92f).toInt().coerceAtMost(dp(420))
        val p = WindowManager.LayoutParams(
            width, WindowManager.LayoutParams.WRAP_CONTENT,
            if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            y = dp(26)
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
        }
        try {
            wm?.addView(card, p)
            card!!.startAnimation(AlphaAnimation(0f, 1f).apply { duration = 200 })
        } catch (_: Exception) { stopSelf() }
    }

    // ---------- quick actions ----------
    private fun runNative(cmd: String) {
        if (busy) return
        busy = true
        status?.text = "Выполняю…"
        progress?.visibility = View.VISIBLE
        val args = org.json.JSONArray().apply {
            if (cmd == "torch") put(if (PhoneControl.torchState()) "off" else "on")
            if (cmd == "dnd") put("silent")
        }
        val st = JSONObject().put("cmd", cmd).put("args", args)
        Thread {
            val r = AssistantCore.runStep(this, st)
            ui.post {
                busy = false
                progress?.visibility = View.GONE
                val ok = r.optBoolean("ok")
                status?.text = if (ok) "Готово ✓" else "Не получилось"
                if (!ok) { answer?.text = r.optString("err"); answer?.visibility = View.VISIBLE }
                resetIdle() // stays open for the next command
            }
        }.start()
    }

    // ---------- voice ----------
    private fun toggleMic() {
        resetIdle()
        if (listening) { stopVoice(); return }
        listening = true
        micBtn?.setColorFilter(0xFFF87171.toInt())
        micRing?.visibility = View.VISIBLE
        micRing?.startAnimation(AlphaAnimation(0.3f, 1f).apply { duration = 650; repeatMode = Animation.REVERSE; repeatCount = Animation.INFINITE })
        status?.text = "Слушаю…"
        answer?.visibility = View.GONE
        if (stt == null) stt = SpeechInput(this) { n, d ->
            if (n != "stt") return@SpeechInput
            ui.post {
                when (d.optString("t")) {
                    "partial" -> { val t = d.optString("text"); input?.setText(t); input?.setSelection(t.length) }
                    "final" -> { val t = d.optString("text"); stopVoice(); if (t.isNotBlank()) { input?.setText(t); submit() } }
                    "empty" -> { stopVoice(); status?.text = "Не расслышал — нажмите ещё раз" }
                    "error" -> { stopVoice(); status?.text = "Ошибка микрофона" }
                }
            }
        }
        stt?.start("system", if (Prefs.get(this, "lang") == "en") "en-US" else "ru-RU", emptyArray(), true)
    }

    private fun stopVoice() {
        listening = false
        micBtn?.setColorFilter(0xFFFAB283.toInt())
        micRing?.clearAnimation(); micRing?.visibility = View.GONE
        try { stt?.stop() } catch (_: Exception) {}
        if (status?.text == "Слушаю…") status?.text = "Чем помочь?"
    }

    // ---------- submit ----------
    private fun submit() {
        val t = input?.text?.toString()?.trim() ?: ""
        if (t.isEmpty() || busy) return
        resetIdle()
        stopVoice()
        input?.setText("")
        answer?.visibility = View.GONE
        busy = true
        status?.text = "Выполняю…"
        progress?.visibility = View.VISIBLE
        AssistantCore.runPhrase(this, t,
            onStatus = { s -> status?.text = s },
            onDone = { ok, summary ->
                busy = false
                progress?.visibility = View.GONE
                if (!ok && summary.startsWith("AGENT:")) {
                    val query = summary.removePrefix("AGENT:")
                    emit?.invoke("assistantQuery", JSONObject().put("text", query).put("source", "overlay"))
                    status?.text = "Отправлено агенту ↗"
                    try {
                        startActivity(Intent(this, MainActivity::class.java)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            .putExtra("widget_action", "assistant_agent").putExtra("widget_target", query))
                    } catch (_: Exception) {}
                    // keep the window: the user may want another command
                } else {
                    status?.text = if (ok) "Готово ✓" else "Не получилось"
                    answer?.text = summary
                    answer?.visibility = if (summary.isBlank()) View.GONE else View.VISIBLE
                }
                resetIdle() // stays open
            })
    }

    fun showResult(text: String, ok: Boolean) {
        ui.post {
            busy = false; progress?.visibility = View.GONE
            status?.text = if (ok) "Готово ✓" else "Ошибка"
            answer?.text = text; answer?.visibility = if (text.isBlank()) View.GONE else View.VISIBLE
            resetIdle()
        }
    }
    fun setStatus(text: String) { ui.post { status?.text = text; resetIdle() } }
    fun setPartial(text: String) { ui.post { input?.setText(text); input?.setSelection(text.length) } }

    private fun hideSelf() {
        stopVoice()
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
