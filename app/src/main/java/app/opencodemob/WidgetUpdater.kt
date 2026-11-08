package app.opencodemob

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import app.opencodemob.widget.CoreStatusWidget

/** Publishes live task state to the home-screen status widget. */
object WidgetUpdater {
    fun set(context: Context, title: String, subtitle: String, running: Boolean, progress: Int = -1) {
        Prefs.put(context, "widget_title", title)
        Prefs.put(context, "widget_sub", subtitle)
        Prefs.putFlag(context, "widget_running", running)
        Prefs.put(context, "widget_progress", progress.toString())
        refresh(context)
    }

    fun idle(context: Context) {
        val port = ServerState.port
        set(context, "Ядро активно", if (port > 0) "Linux ARM64 • :$port" else "Ожидание запуска", false)
    }

    fun refresh(context: Context) {
        try {
            val mgr = AppWidgetManager.getInstance(context)
            val ids = mgr.getAppWidgetIds(ComponentName(context, CoreStatusWidget::class.java))
            if (ids.isNotEmpty()) {
                val i = Intent(context, CoreStatusWidget::class.java).apply {
                    action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                    putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
                }
                context.sendBroadcast(i)
            }
        } catch (_: Exception) {}
    }
}
