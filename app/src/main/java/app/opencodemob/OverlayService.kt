package app.opencodemob

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat

/**
 * Floating agent bubble.
 *
 *  • A round 46dp bubble keeps the state (idle / working / needs attention / error) as a ring and a
 *    pulsing dot, and widens into a pill with the live label while the agent works.
 *  • Tapping opens a small action menu (open chat, stop, new chat) instead of aborting instantly.
 *  • Dragging is free, but the bubble snaps to the nearest screen edge and the position is stored.
 *  • In "only while working" mode it hides a few seconds after the agent goes idle.
 *  • During a multimodal run the label shows the current role and a dot strip shows job states.
 *
 * It is completely passive: it never starts the server and only reads the shared state that the UI
 * and OpenCodeService publish in Prefs / ServerState.
 */
class OverlayService : Service() {
    private var wm: WindowManager? = null
    private var bubble: OverlayBubble? = null
    private var menu: LinearLayout? = null
    private var menuParams: WindowManager.LayoutParams? = null
    private val ui = Handler(Looper.getMainLooper())
    private var params: WindowManager.LayoutParams? = null
    private var idleSince = 0L
    private var lastSig = ""
    private var ticker: Runnable? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "stop") {
            Prefs.putFlag(this, "overlay_enabled", false)
            stopSelf()
            return START_NOT_STICKY
        }
        if (!android.provider.Settings.canDrawOverlays(this)) { stopSelf(); return START_NOT_STICKY }
        startForegroundCompat()
        if (bubble == null) attach()
        startTicker()
        return START_STICKY
    }

    private fun startForegroundCompat() {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(NotificationChannel("overlay", getString(R.string.overlay_channel), NotificationManager.IMPORTANCE_MIN))
        }
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val n: Notification = NotificationCompat.Builder(this, "overlay")
            .setSmallIcon(R.drawable.ic_tile_server)
            .setContentTitle(getString(R.string.tile_server_label))
            .setContentText(getString(R.string.overlay_running))
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setContentIntent(open)
            .build()
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(3, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            } else startForeground(3, n)
        } catch (_: Exception) {}
    }

    // ---- view plumbing ----

    private fun attach() {
        val w = getSystemService(WINDOW_SERVICE) as WindowManager
        wm = w
        val b = OverlayBubble(this)
        val p = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = Prefs.get(this@OverlayService, "overlay_x", "-1").toIntOrNull() ?: -1
            y = Prefs.get(this@OverlayService, "overlay_y", "-1").toIntOrNull() ?: -1
        }
        if (p.x < 0) p.x = (resources.displayMetrics.widthPixels - dp(66))
        if (p.y < 0) p.y = dp(200) + topInset()

        var downX = 0f; var downY = 0f; var startX = 0; var startY = 0
        var moved = false; var downAt = 0L
        b.setOnTouchListener { _, e ->
            when (e.action) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX; downY = e.rawY; startX = p.x; startY = p.y; moved = false
                    downAt = System.currentTimeMillis(); dismissMenu(); b.alpha = 1f; true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (e.rawX - downX).toInt(); val dy = (e.rawY - downY).toInt()
                    if (Math.abs(dx) > dp(6) || Math.abs(dy) > dp(6)) moved = true
                    if (moved) {
                        p.x = startX + dx; p.y = startY + dy
                        clamp(p)
                        try { wm?.updateViewLayout(b, p) } catch (_: Exception) {}
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!moved && System.currentTimeMillis() - downAt < 600) onBubbleTap()
                    else if (moved) snapToEdge(b, p)
                    true
                }
                else -> false
            }
        }
        bubble = b
        params = p
        try { wm?.addView(b, p) } catch (_: Exception) { stopSelf() }
    }

    private fun topInset(): Int {
        val id = resources.getIdentifier("status_bar_height", "dimen", "android")
        return if (id > 0) resources.getDimensionPixelSize(id) else dp(28)
    }

    private fun clamp(p: WindowManager.LayoutParams) {
        val sw = resources.displayMetrics.widthPixels
        val sh = resources.displayMetrics.heightPixels
        val w = bubble?.measuredWidth ?: dp(46)
        val h = bubble?.measuredHeight ?: dp(46)
        p.x = p.x.coerceIn(0, (sw - w).coerceAtLeast(0))
        p.y = p.y.coerceIn(topInset(), (sh - h - dp(48)).coerceAtLeast(topInset()))
    }

    /** Snaps horizontally to the nearer edge and remembers the result. */
    private fun snapToEdge(v: View, p: WindowManager.LayoutParams) {
        val sw = resources.displayMetrics.widthPixels
        val half = (v.width / 2f)
        val target = if (p.x + half < sw / 2f) 0 else (sw - v.width).coerceAtLeast(0)
        val from = p.x
        val steps = 8
        // small animation: 8 frames is enough to feel intentional without a ValueAnimator churn
        for (i in 1..steps) {
            ui.postDelayed({
                p.x = from + (target - from) * i / steps
                try { wm?.updateViewLayout(v, p) } catch (_: Exception) {}
            }, 12L * i)
        }
        Prefs.put(this, "overlay_x", target.toString())
        Prefs.put(this, "overlay_y", p.y.toString())
    }

    // ---- action menu (tap) ----

    private fun onBubbleTap() {
        if (menu != null) { dismissMenu(); return }
        if (bubble?.working == true) showMenu() else openChat(null)
    }

    private fun menuButton(iconRes: Int, tint: Int, label: String, onClick: () -> Unit): View {
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(8), dp(6), dp(8), dp(6))
        }
        val b = ImageButton(this).apply {
            setImageResource(iconRes)
            setBackgroundColor(android.graphics.Color.TRANSPARENT)
            setColorFilter(tint)
            contentDescription = label
            setOnClickListener { dismissMenu(); onClick() }
        }
        wrap.addView(b, LinearLayout.LayoutParams(dp(34), dp(34)))
        wrap.addView(TextView(this).apply {
            text = label
            setTextColor(0xFFE4E4E7.toInt())
            textSize = 10f
            gravity = Gravity.CENTER
        })
        return wrap
    }

    private fun showMenu() {
        val b = bubble ?: return
        val p = params ?: return
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(6), dp(6), dp(6), dp(6))
            background = GradientDrawable().apply {
                cornerRadius = dp(16).toFloat()
                setColor(0xF21A1A1E.toInt())
                setStroke(dp(1), 0xFF2A2A2F.toInt())
            }
        }
        row.addView(menuButton(R.drawable.ic_widget_chat, 0xFFFFFFFF.toInt(), getString(R.string.overlay_open)) { openChat(null) })
        row.addView(menuButton(R.drawable.ic_widget_arrow, 0xFFF87171.toInt(), getString(R.string.overlay_stop)) { stopAgent() })
        row.addView(menuButton(R.drawable.ic_widget_sparkle, OverlayBubble.ACCENT, getString(R.string.overlay_new)) { openChat("new_chat") })
        val mp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            p.type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            val sw = resources.displayMetrics.widthPixels
            x = if (p.x + dp(40) > sw / 2f) (p.x - dp(150)).coerceAtLeast(0) else (p.x + dp(56)).coerceAtMost(sw - dp(150))
            y = p.y
        }
        menuParams = mp
        menu = row
        try { wm?.addView(row, mp) } catch (_: Exception) { menu = null; return }
        bubble?.alpha = 0.35f
        // auto-hide so a stray tap never leaves a menu floating forever
        ui.postDelayed({ if (menu === row) dismissMenu() }, 5000)
    }

    private fun dismissMenu() {
        val m = menu ?: return
        menu = null
        try { wm?.removeView(m) } catch (_: Exception) {}
        bubble?.alpha = 1f
    }

    private fun stopAgent() {
        // The UI knows which sessions are running: ask it to abort them all.
        try {
            startActivity(
                Intent(this, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    .putExtra("widget_action", "abort_all")
            )
        } catch (_: Exception) {}
        Notifier.updateRuntime(this, getString(R.string.overlay_stopping))
    }

    private fun openChat(action: String?) {
        val i = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("widget_action", action ?: "open_chat")
        try { startActivity(i) } catch (_: Exception) {}
    }

    // ---- live state ----

    private fun startTicker() {
        stopTicker()
        ticker = object : Runnable {
            override fun run() {
                refresh()
                ui.postDelayed(this, 1000)
            }
        }.also { ui.post(it) }
    }

    private fun stopTicker() { ticker?.let { ui.removeCallbacks(it) }; ticker = null }

    private fun refresh() {
        val b = bubble ?: return
        val p = params ?: return
        val busy = Prefs.flag(this, "widget_running", false)
        val jobsRaw = Prefs.get(this, "overlay_jobs", "")
        val perm = Prefs.flag(this, "overlay_attention", false)
        val err = Prefs.flag(this, "overlay_error", false)

        b.working = busy
        b.stateColor = when {
            err -> OverlayBubble.ERROR
            perm -> OverlayBubble.ATTENTION
            busy -> OverlayBubble.ACCENT
            else -> OverlayBubble.IDLE
        }
        // No text on the bubble: only the ring colour, the pulse and the job markers carry state.
        b.jobs = jobsRaw.split(',').filter { it.isNotBlank() }.take(4)
        val sig = b.jobs.joinToString(",")
        if (sig != lastSig) {
            lastSig = sig
            try { wm?.updateViewLayout(b, p) } catch (_: Exception) {}
        }

        if (busy) { idleSince = 0 } else if (idleSince == 0L) idleSince = System.currentTimeMillis()

        // "Only while working" mode: hide the bubble when nothing is running for a while.
        val onlyBusy = Prefs.flag(this, "overlay_only_busy", false)
        val hiddenFor = if (onlyBusy && !busy && idleSince > 0L) System.currentTimeMillis() - idleSince else 0L
        val shouldHide = onlyBusy && !busy && hiddenFor > 2500L
        if (shouldHide && b.visibility == View.VISIBLE) {
            b.visibility = View.GONE
        } else if (!shouldHide && b.visibility != View.VISIBLE) {
            b.visibility = View.VISIBLE
            try { wm?.updateViewLayout(b, p) } catch (_: Exception) {}
        }
        // subtle fade while idle so it never blocks reading underneath
        if (!shouldHide) b.alpha = if (busy || menu != null) 1f else 0.55f
    }

    override fun onDestroy() {
        stopTicker()
        dismissMenu()
        try { bubble?.let { wm?.removeView(it) } } catch (_: Exception) {}
        bubble = null
        super.onDestroy()
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    companion object {
        fun start(ctx: Context) {
            try {
                val i = Intent(ctx, OverlayService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
            } catch (_: Exception) {}
        }
        fun stop(ctx: Context) {
            Prefs.putFlag(ctx, "overlay_enabled", false)
            try { ctx.stopService(Intent(ctx, OverlayService::class.java)) } catch (_: Exception) {}
        }
    }
}