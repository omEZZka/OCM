package app.opencodemob.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import app.opencodemob.MainActivity
import app.opencodemob.Prefs
import app.opencodemob.R

class CoreStatusWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (widgetId in appWidgetIds) {
            updateWidget(context, appWidgetManager, widgetId)
        }
    }

    private fun updateWidget(context: Context, appWidgetManager: AppWidgetManager, widgetId: Int) {
        val views = RemoteViews(context.packageName, R.layout.widget_core_status)

        val running = Prefs.flag(context, "widget_running", false)
        val title = Prefs.get(context, "widget_title", "Ядро активно")
        val sub = Prefs.get(context, "widget_sub", "Linux ARM64 • :${Prefs.get(context, "stablePort")}")
        val progress = Prefs.get(context, "widget_progress", "-1").toIntOrNull() ?: -1

        views.setTextViewText(R.id.widget_status_title, title)
        views.setTextViewText(R.id.widget_status_sub, sub)
        views.setTextColor(R.id.widget_status_title, if (running) 0xFFF59E0B.toInt() else 0xFF22C55E.toInt())
        views.setViewVisibility(R.id.widget_status_progress, if (running) View.VISIBLE else View.GONE)
        if (progress in 0..100) {
            views.setProgressBar(R.id.widget_status_progress, 100, progress, false)
        } else {
            views.setProgressBar(R.id.widget_status_progress, 0, 0, true)
        }
        views.setTextViewText(R.id.widget_status_btn_text, if (running) "Открыть задачу" else "Открыть OpenCode")

        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("widget_action", if (running) "open_chat" else "status")
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            201,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        views.setOnClickPendingIntent(R.id.widget_status_root, pendingIntent)
        views.setOnClickPendingIntent(R.id.widget_status_btn, pendingIntent)

        appWidgetManager.updateAppWidget(widgetId, views)
    }
}
