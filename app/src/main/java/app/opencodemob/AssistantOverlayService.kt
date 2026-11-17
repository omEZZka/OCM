package app.opencodemob

import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
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
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject

/**
 * Google-Assistant-style mini window over any app.
 *
 * Triggered by the wake phrase (voice), the quick-settings tile, or `phone assistant` from the
 * agent. The user speaks or types; the request goes to the UI/agent; status and the final answer
 * are shown right here without leaving the current app.
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
        fun hide(c: Context) {
            try { c.stopService(Intent(c, AssistantOverlayService::class.java)) } catch (_: Exception) {}
        }
    }

    private var wm: WindowManager? = null
    private var root: LinearLayout? = null
    private var input: EditText? = null
    private var status: TextView? = null
    private var answer: TextView? = null
    private var micBtn: ImageButton? = null
    private val ui = Handler(Looper.getMainLooper())
    var emit: ((String, JSONObject) -> Unit)? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        instance = this
        if (!android.provider.Settings.canDrawOverlays(this)) { stopSelf(); return START_NOT_STICKY }
        startForegroundCompat()
        if (root == null) attach()
        root?.visibility = View.VISIBLE
        input?.requestFocus()
        return START_NOT_STICKY
    }

    private fun startForegroundCompat() {
        try {
            val nm = getSystemService(android.app.NotificationManager::class.java)
            if (Build.VERSION.SDK_INT >= 26) {
                nm.createNotificationChannel(android.app.NotificationChannel("assistant", getString(R.string.app_name), android.app.NotificationManager.IMPORTANCE_MIN))
            }
            val open = android.app.PendingIntent.getActivity(this, 0,
                Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT)
            val n = androidx.core.app.NotificationCompat.Builder(this, "assistant")
                .setSmallIcon(R.drawable.ic_tile_server)
                .setContentTitle("OpenCode Assistant")
                .setContentText("Мини-окно ассистента")
                .setOngoing(true)
                .setPriority(androidx.core.app.NotificationCompat.PRIORITY_MIN)
                .setContentIntent(open)
                .build()
            if (Build.VERSION.SDK_INT >= 34) startForeground(7, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            else startForeground(7, n)
        } catch (_: Exception) {}
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun attach() {
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        val bg = GradientDrawable().apply {
            cornerRadius = dp(22).toFloat()
            setColor(0xF2141417.toInt())
            setStroke(dp(1), 0xFF2A2A2F.toInt())
        }
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = bg
            setPadding(dp(16), dp(14), dp(16), dp(14))
            elevation = dp(12).toFloat()
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val title = TextView(this).apply {
            text = "OpenCode Assistant"
            setTextColor(0xFFE4E4E7.toInt())
            textSize = 13f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }
        val close = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_menu_close_clear_cancel)
            setBackgroundColor(0)
            setColorFilter(0xFF8E8E93.toInt())
            setOnClickListener { hideSelf() }
        }
        header.addView(title, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        header.addView(close, LinearLayout.LayoutParams(dp(30), dp(30)))
        root!!.addView(header)

        status = TextView(this).apply {
            text = "Слушаю или напишите запрос…"
            setTextColor(0xFF8E8E93.toInt())
            textSize = 12f
            setPadding(0, dp(6), 0, dp(6))
        }
        root!!.addView(status)

        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        input = EditText(this).apply {
            hint = "Запрос агенту…"
            setHintTextColor(0xFF5A5A60.toInt())
            setTextColor(0xFFF4F4F5.toInt())
            textSize = 14f
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            maxLines = 3
            setBackground(GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setColor(0xFF1E1E23.toInt()) })
            setPadding(dp(12), dp(10), dp(12), dp(10))
            imeOptions = EditorInfo.IME_ACTION_SEND
            setOnEditorActionListener { _, actionId, event ->
                if (actionId == EditorInfo.IME_ACTION_SEND || (event != null && event.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)) {
                    submit(); true
                } else false
            }
        }
        micBtn = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_btn_speak_now)
            setBackground(GradientDrawable().apply { cornerRadius = dp(20).toFloat(); setColor(0xFF26262B.toInt()) })
            setColorFilter(0xFF38BDF8.toInt())
            setOnClickListener { toggleMic() }
        }
        val send = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_menu_send)
            setBackground(GradientDrawable().apply { cornerRadius = dp(20).toFloat(); setColor(0xFFFAB283.toInt()) })
            setColorFilter(0xFF0D0D0F.toInt())
            setOnClickListener { submit() }
        }
        row.addView(input, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(micBtn, LinearLayout.LayoutParams(dp(40), dp(40)).apply { marginStart = dp(8) })
        row.addView(send, LinearLayout.LayoutParams(dp(40), dp(40)).apply { marginStart = dp(6) })
        root!!.addView(row)

        answer = TextView(this).apply {
            visibility = View.GONE
            setTextColor(0xFFD1D1D6.toInt())
            textSize = 13f
            maxLines = 8
            setPadding(0, dp(10), 0, 0)
        }
        root!!.addView(answer)

        val p = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.BOTTOM
            y = dp(24)
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
        }
        // horizontal margins via a wrapper width trick: use MATCH_PARENT minus padding on root
        root!!.layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        try { wm?.addView(root, p) } catch (_: Exception) { stopSelf() }
    }

    private var listening = false
    private fun toggleMic() {
        listening = !listening
        micBtn?.setColorFilter(if (listening) 0xFFF87171.toInt() else 0xFF38BDF8.toInt())
        status?.text = if (listening) "Слушаю…" else "Слушаю или напишите запрос…"
        emit?.invoke("assistantMic", JSONObject().put("on", listening))
    }

    private fun submit() {
        val t = input?.text?.toString()?.trim() ?: ""
        if (t.isEmpty()) return
        input?.setText("")
        answer?.visibility = View.GONE
        status?.text = "Выполняю…"
        emit?.invoke("assistantQuery", JSONObject().put("text", t).put("source", "overlay"))
    }

    /** Called from the bridge when the agent answers. */
    fun showResult(text: String, ok: Boolean) {
        ui.post {
            status?.text = if (ok) "Готово" else "Ошибка"
            answer?.text = text
            answer?.visibility = if (text.isBlank()) View.GONE else View.VISIBLE
            // auto-hide after a while so the overlay never lingers over the user's app
            ui.postDelayed({ if (answer?.text == text) hideSelf() }, 12000)
        }
    }

    fun setPartial(text: String) {
        ui.post { input?.setText(text); input?.setSelection(text.length) }
    }

    fun setStatus(text: String) { ui.post { status?.text = text } }

    private fun hideSelf() {
        listening = false
        emit?.invoke("assistantMic", JSONObject().put("on", false))
        stopSelf()
    }

    override fun onDestroy() {
        instance = null
        try { root?.let { wm?.removeView(it) } } catch (_: Exception) {}
        root = null
        super.onDestroy()
    }
}
