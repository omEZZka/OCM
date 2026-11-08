package app.opencodemob

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/** Handles notification action buttons without opening the app. */
class ActionReceiver : BroadcastReceiver() {
    private val http = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build()

    override fun onReceive(context: Context, intent: Intent) {
        val op = intent.getStringExtra("op_action") ?: return
        val sid = intent.getStringExtra("session_id") ?: ""
        val pid = intent.getStringExtra("permission_id") ?: ""
        val notifId = intent.getIntExtra("notif_id", 0)
        val pending = goAsync()
        Thread {
            try {
                val port = ServerState.port
                if (port > 0) {
                    when (op) {
                        "permission_once" -> post(port, "/permission/$pid/reply", """{"reply":"once"}""")
                        "permission_reject" -> post(port, "/permission/$pid/reply", """{"reply":"reject"}""")
                        "abort" -> post(port, "/session/$sid/abort", "{}")
                    }
                }
                if (notifId != 0) NotificationManagerCompat.from(context).cancel(notifId)
            } catch (_: Exception) {
            } finally {
                pending.finish()
            }
        }.start()
    }

    private fun post(port: Int, path: String, body: String) {
        val req = Request.Builder()
            .url("http://127.0.0.1:$port$path")
            .header("Authorization", Runtime.basic(ServerState.password))
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
        http.newCall(req).execute().use { }
    }
}
