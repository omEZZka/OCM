package app.opencodemob

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat

/**
 * Small draggable bubble above other apps: shows whether the agent is working and gives one-tap
 * stop / open. Requires the "display over other apps" permission (SYSTEM_ALERT_WINDOW), requested
 * from Settings → Appearance, so it is completely opt-in.
 */
class OverlayService : Service() {
    private var wm: WindowManager? = null
    private var root: View? = null
    private var label: TextView? = null
    private val ui = Handler(Looper.getMainLooper())
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
        if (root == null) attach()
        startTicker()
        return START_STICKY
    }

    private fun startForegroundCompat() {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(NotificationChannel("overlay", "Плавающий индикатор", NotificationManager.IMPORTANCE_MIN))
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

    private fun attach() {
        val ctx = this
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        val row = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), dp(6), dp(10), dp(6))
            background = GradientDrawable().apply {
                cornerRadius = dp(20).toFloat()
                setColor(0xE6121214.toInt())
                setStroke(dp(1), 0xFF2A2A2F.toInt())
            }
        }
        label = TextView(ctx).apply {
            text = getString(R.string.overlay_idle)
            setTextColor(Color.WHITE)
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            maxLines = 1
        }
        row.addView(label)
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = dp(12); y = dp(180)
        }
        var downX = 0f; var downY = 0f; var startX = 0; var startY = 0; var moved = false
        row.setOnTouchListener { _, e ->
            when (e.action) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX; downY = e.rawY; startX = params.x; startY = params.y; moved = false; true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (e.rawX - downX).toInt(); val dy = (e.rawY - downY).toInt()
                    if (Math.abs(dx) > dp(6) || Math.abs(dy) > dp(6)) moved = true
                    params.x = startX + dx; params.y = startY + dy
                    try { wm?.updateViewLayout(row, params) } catch (_: Exception) {}
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!moved) onBubbleTap()
                    true
                }
                else -> false
            }
        }
        root = row
        try { wm?.addView(row, params) } catch (_: Exception) { stopSelf() }
    }

    private fun onBubbleTap() {
        val busy = Prefs.flag(this, "widget_running", false)
        if (busy) {
            // The UI owns the knowledge of which sessions are running: ask it to abort them all
            // instead of guessing session ids from the service.
            try {
                startActivity(
                    Intent(this, MainActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                        .putExtra("widget_action", "abort_all")
                )
            } catch (_: Exception) {}
            Notifier.updateRuntime(this, getString(R.string.overlay_stopping))
        } else {
            val i = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra("widget_action", "open_chat")
            startActivity(i)
        }
    }

    private fun startTicker() {
        stopTicker()
        ticker = object : Runnable {
            override fun run() {
                val busy = Prefs.flag(this@OverlayService, "widget_running", false)
                val title = Prefs.get(this@OverlayService, "widget_title", "")
                label?.text = if (busy) {
                    val t = title.take(24)
                    getString(R.string.overlay_working) + (if (t.isNotEmpty()) " · $t" else "")
                } else getString(R.string.overlay_idle)
                ui.postDelayed(this, 2000)
            }
        }.also { ui.post(it) }
    }

    private fun stopTicker() { ticker?.let { ui.removeCallbacks(it) }; ticker = null }

    override fun onDestroy() {
        stopTicker()
        // If the system killed the service (e.g. after a reboot) keep the user's preference so it can
        // be restored; only an explicit stop clears `overlay_enabled`.
        try { root?.let { wm?.removeView(it) } } catch (_: Exception) {}
        root = null
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