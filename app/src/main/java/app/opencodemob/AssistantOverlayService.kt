package app.opencodemob

import android.app.Service
import android.content.Context
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
 * Google-Assistant-style mini window over any app — fully autonomous.
 *
 * The executor (AssistantCore) runs natively here, so the overlay works even when MainActivity
 * has been killed by Android. Voice input uses a short silence window and stops right after the
 * phrase. Apps launch through the accessibility context (background-start exempt).
 */
class AssistantOverlayService : Service() {

    companion object {
        @Volatile var instance: AssistantOverlayService? = null
        fun show(c: Context) {
            try {
                val i = Intent(c, AssistantOverlayService::class.java)
                if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i) else c.startService(i)
            } catch (_: Exception) {}
        }
        fun hide(c: Context) { try { c.stopService(Intent(c, AssistantOverlayService::class.java)) } catch (_: Exception) {} }
    }

    private var wm: WindowManager? = null
    private var card: LinearLayout? = null
    private var input: EditText? = null
    private var status: TextView? = null
    private var answer: TextView? = null
    private var micBtn: ImageButton? = null
    private var micRing: View? = null
    private val ui = Handler(Looper.getMainLooper())
    var emit: ((String, JSONObject) -> Unit)? = null
    private var stt: SpeechInput? = null
    private var listening = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        instance = this
        if (!android.provider.Settings.canDrawOverlays(this)) { stopSelf(); return START_NOT_STICKY }
        startForegroundCompat()
        if (card == null) attach()
        card?.visibility = View.VISIBLE
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
                .setContentText("Мини-окно ассистента").setOngoing(true)
                .setPriority(androidx.core.app.NotificationCompat.PRIORITY_MIN).setContentIntent(open).build()
            if (Build.VERSION.SDK_INT >= 34) startForeground(7, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            else startForeground(7, n)
        } catch (_: Exception) {}
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
    private fun bg(color: Int, radius: Int, stroke: Int = 0, strokeColor: Int = 0): GradientDrawable =
        GradientDrawable().apply { cornerRadius = dp(radius).toFloat(); setColor(color); if (stroke > 0) setStroke(dp(stroke), strokeColor) }

    private fun attach() {
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        val sw = resources.displayMetrics.widthPixels

        // floating rounded card, centered horizontally, near the bottom — not a full-width bar
        card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = bg(0xF717171B.toInt(), 26, 1, 0xFF2E2E35.toInt())
            setPadding(dp(18), dp(16), dp(18), dp(16))
            elevation = dp(18).toFloat()
        }

        // header: logo dot + title + close
        val header = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val dot = View(this).apply { background = bg(0xFFFAB283.toInt(), 6) }
        header.addView(dot, LinearLayout.LayoutParams(dp(10), dp(10)).apply { marginEnd = dp(9) })
        header.addView(TextView(this).apply {
            text = "Ассистент"; setTextColor(0xFFF4F4F5.toInt()); textSize = 14f
            setTypeface(typeface, Typeface.BOLD)
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        val close = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_menu_close_clear_cancel)
            background = bg(0xFF232329.toInt(), 14)
            setColorFilter(0xFF9A9AA2.toInt())
            setOnClickListener { hideSelf() }
        }
        header.addView(close, LinearLayout.LayoutParams(dp(30), dp(30)))
        card!!.addView(header)

        status = TextView(this).apply {
            text = "Скажите или напишите команду"; setTextColor(0xFF8E8E96.toInt()); textSize = 12f
            setPadding(0, dp(8), 0, dp(8))
        }
        card!!.addView(status)

        // input row: rounded field + pulsing mic + send
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        input = EditText(this).apply {
            hint = "открой телеграм…"
            setHintTextColor(0xFF55555C.toInt()); setTextColor(0xFFF4F4F5.toInt()); textSize = 14.5f
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            maxLines = 3
            background = bg(0xFF212127.toInt(), 16)
            setPadding(dp(14), dp(11), dp(14), dp(11))
            imeOptions = EditorInfo.IME_ACTION_SEND
            setOnEditorActionListener { _, actionId, event ->
                if (actionId == EditorInfo.IME_ACTION_SEND || (event != null && event.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)) { submit(); true } else false
            }
        }
        val micWrap = FrameLayout(this)
        micRing = View(this).apply { background = bg(0x33F87171.toInt(), 22); visibility = View.GONE }
        micWrap.addView(micRing, FrameLayout.LayoutParams(dp(44), dp(44), Gravity.CENTER))
        micBtn = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_btn_speak_now)
            background = bg(0xFF26262C.toInt(), 22)
            setColorFilter(0xFF38BDF8.toInt())
            setOnClickListener { toggleMic() }
        }
        micWrap.addView(micBtn, FrameLayout.LayoutParams(dp(44), dp(44), Gravity.CENTER))
        val send = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_menu_send)
            background = bg(0xFFFAB283.toInt(), 22)
            setColorFilter(0xFF0D0D0F.toInt())
            setOnClickListener { submit() }
        }
        row.addView(input, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(micWrap, LinearLayout.LayoutParams(dp(46), dp(46)).apply { marginStart = dp(8) })
        row.addView(send, LinearLayout.LayoutParams(dp(46), dp(46)).apply { marginStart = dp(7) })
        card!!.addView(row)

        // quick chips
        val chips = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(10), 0, 0) }
        listOf("Скриншот" to "shot", "Фонарик" to "torch", "Домой" to "home", "Назад" to "back").forEach { (label, cmd) ->
            chips.addView(TextView(this).apply {
                text = label; setTextColor(0xFFC9C9D1.toInt()); textSize = 11.5f
                background = bg(0xFF232329.toInt(), 12); setPadding(dp(11), dp(6), dp(11), dp(6))
                setOnClickListener { runNative(cmd) }
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(6) })
        }
        card!!.addView(chips)

        answer = TextView(this).apply {
            visibility = View.GONE; setTextColor(0xFFD6D6DE.toInt()); textSize = 13f
            maxLines = 10; setPadding(0, dp(11), 0, 0); setLineSpacing(dp(2).toFloat(), 1f)
        }
        card!!.addView(answer)

        val width = (sw * 0.92f).toInt().coerceAtMost(dp(430))
        val p = WindowManager.LayoutParams(
            width, WindowManager.LayoutParams.WRAP_CONTENT,
            if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            y = dp(28)
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
        }
        try {
            wm?.addView(card, p)
            card!!.startAnimation(AlphaAnimation(0f, 1f).apply { duration = 180 })
        } catch (_: Exception) { stopSelf() }
    }

    // ---------- native quick actions ----------
    private fun runNative(cmd: String) {
        status?.text = "…"
        val st = JSONObject().put("cmd", cmd).put("args", org.json.JSONArray().apply { if (cmd == "torch") put("on") })
        Thread {
            val r = AssistantCore.runStep(this, st)
            ui.post {
                status?.text = if (r.optBoolean("ok")) "Готово" else (r.optString("err").ifEmpty { "Ошибка" })
                ui.postDelayed({ hideSelf() }, 1400)
            }
        }.start()
    }

    // ---------- voice: short silence, stop right after the phrase ----------
    private fun toggleMic() {
        if (listening) { stopVoice(); return }
        listening = true
        micBtn?.setColorFilter(0xFFF87171.toInt())
        micRing?.visibility = View.VISIBLE
        micRing?.startAnimation(AlphaAnimation(0.35f, 1f).apply { duration = 600; repeatMode = Animation.REVERSE; repeatCount = Animation.INFINITE })
        status?.text = "Слушаю…"
        if (stt == null) stt = SpeechInput(this) { n, d ->
            if (n != "stt") return@SpeechInput
            ui.post {
                when (d.optString("t")) {
                    "partial" -> { val t = d.optString("text"); input?.setText(t); input?.setSelection(t.length) }
                    "final" -> {
                        val t = d.optString("text")
                        stopVoice()
                        if (t.isNotBlank()) { input?.setText(t); submit() }
                    }
                    "empty" -> { stopVoice(); status?.text = "Не расслышал — попробуйте ещё" }
                    "error" -> { stopVoice(); status?.text = "Ошибка микрофона" }
                }
            }
        }
        // single=true → one phrase then auto-stop; short silence is set inside SpeechInput for oneShot
        stt?.start("system", if (Prefs.get(this, "lang") == "en") "en-US" else "ru-RU", emptyArray(), true)
    }

    private fun stopVoice() {
        listening = false
        micBtn?.setColorFilter(0xFF38BDF8.toInt())
        micRing?.clearAnimation(); micRing?.visibility = View.GONE
        try { stt?.stop() } catch (_: Exception) {}
        if (status?.text == "Слушаю…") status?.text = "Скажите или напишите команду"
    }

    // ---------- submit: native executor first, agent fallback ----------
    private fun submit() {
        val t = input?.text?.toString()?.trim() ?: ""
        if (t.isEmpty()) return
        stopVoice()
        input?.setText("")
        answer?.visibility = View.GONE
        status?.text = "Выполняю…"
        AssistantCore.runPhrase(this, t,
            onStatus = { s -> status?.text = s },
            onDone = { ok, summary ->
                if (!ok && summary.startsWith("AGENT:")) {
                    // not a phone command → forward to the agent (opens the app chat)
                    val query = summary.removePrefix("AGENT:")
                    emit?.invoke("assistantQuery", JSONObject().put("text", query).put("source", "overlay"))
                    status?.text = "Отправлено агенту"
                    try {
                        startActivity(Intent(this, MainActivity::class.java)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            .putExtra("widget_action", "assistant_agent").putExtra("widget_target", query))
                    } catch (_: Exception) {}
                    ui.postDelayed({ hideSelf() }, 1200)
                } else {
                    status?.text = if (ok) "Готово" else "Не получилось"
                    answer?.text = summary
                    answer?.visibility = if (summary.isBlank()) View.GONE else View.VISIBLE
                    ui.postDelayed({ hideSelf() }, if (ok) 3500 else 8000)
                }
            })
    }

    fun showResult(text: String, ok: Boolean) {
        ui.post {
            status?.text = if (ok) "Готово" else "Ошибка"
            answer?.text = text; answer?.visibility = if (text.isBlank()) View.GONE else View.VISIBLE
            ui.postDelayed({ hideSelf() }, 8000)
        }
    }
    fun setStatus(text: String) { ui.post { status?.text = text } }
    fun setPartial(text: String) { ui.post { input?.setText(text); input?.setSelection(text.length) } }

    private fun hideSelf() {
        stopVoice()
        stopSelf()
    }

    override fun onDestroy() {
        instance = null
        try { stt?.stop() } catch (_: Exception) {}
        try { card?.let { wm?.removeView(it) } } catch (_: Exception) {}
        card = null
        super.onDestroy()
    }
}
