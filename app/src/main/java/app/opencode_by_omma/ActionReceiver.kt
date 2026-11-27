package app.opencode_by_omma

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
        val qid = intent.getStringExtra("question_id") ?: ""
        val notifId = intent.getIntExtra("notif_id", 0)
        val replyText = androidx.core.app.RemoteInput.getResultsFromIntent(intent)
            ?.getCharSequence("reply_text")?.toString()?.trim() ?: ""
        val pending = goAsync()
        Thread {
            var ok = false
            try {
                val port = ServerState.port
                if (port > 0) {
                    when (op) {
                        "permission_once" -> post(port, "/permission/$pid/reply", """{"reply":"once"}""")
                        "permission_reject" -> post(port, "/permission/$pid/reply", """{"reply":"reject"}""")
                        "abort" -> post(port, "/session/$sid/abort", "{}")
                        "question_reply" -> if (replyText.isNotEmpty()) {
                            val answer = org.json.JSONObject.quote(replyText)
                            if (qid.startsWith("mmq_")) {
                                // MM role question: resolved inside the UI, not by the server.
                                Prefs.put(context, "mm_reply_qid", qid)
                                Prefs.put(context, "mm_reply_text", replyText)
                                val i = Intent(context, MainActivity::class.java)
                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                                    .putExtra("widget_action", "mm_reply")
                                    .putExtra("widget_session", sid)
                                context.startActivity(i)
                            } else {
                                post(port, "/question/$qid/reply", """{"answers":[[$answer]]}""")
                            }
                        } else throw IllegalStateException("empty reply")
                    }
                    ok = true
                }
            } catch (_: Exception) {
            } finally {
                // Keep the notification when the server was not reachable, so the action can be
                // retried instead of silently disappearing.
                if (ok && notifId != 0) {
                    try { NotificationManagerCompat.from(context).cancel(notifId) } catch (_: Exception) {}
                }
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
        http.newCall(req).execute().use { r ->
            // A 4xx/5xx (stale permission id, server still booting) is not a success: surface it so
            // the notification is kept instead of being dismissed as if the action had worked.
            if (!r.isSuccessful) throw IllegalStateException("HTTP ${r.code}")
        }
    }
}
