package app.opencodemob

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin

object Notifier {
    const val DONE = "done"
    const val ACTION = "action"
    const val QUOTA = "quota"

    fun ensureChannels(c: Context) {
        val nm = c.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("runtime", "Фоновая служба", NotificationManager.IMPORTANCE_LOW))
        listOf(DONE to "Задача завершена", ACTION to "Требуется действие", QUOTA to "Квота исчерпана").forEach { (id, name) ->
            // Sound is played by Notifier.beep so each event has its own pleasant harmonic chime
            nm.createNotificationChannel(NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH).apply { setSound(null, null) })
        }
    }

    private fun open(c: Context, sessionId: String = "") = PendingIntent.getActivity(
        c,
        if (sessionId.isEmpty()) 0 else sessionId.hashCode(),
        Intent(c, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("widget_action", "open_chat")
            .putExtra("widget_session", sessionId),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    fun runtime(c: Context, text: String): Notification =
        NotificationCompat.Builder(c, "runtime")
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("OpenCode")
            .setContentText(text)
            .setOngoing(true)
            .setContentIntent(open(c))
            .build()

    fun updateRuntime(c: Context, text: String) {
        try { NotificationManagerCompat.from(c).notify(1, runtime(c, text)) } catch (_: SecurityException) {}
    }

    fun event(c: Context, kind: String, title: String, text: String, sessionId: String = "", sessionTitle: String = "", permissionId: String = "", questionId: String = "") {
        if (!Prefs.flag(c, "snd_$kind")) return
        beep(kind)
        val id = 10 + (kind.hashCode() and 0x7fffffff) % 1000
        val prefix = if (kind == ACTION) {
            when {
                questionId.isNotEmpty() -> "@ "
                permissionId.isNotEmpty() -> "! "
                else -> "! "
            }
        } else ""
        val shownTitle = if (sessionTitle.isNotEmpty()) prefix + sessionTitle else prefix + title
        val b = NotificationCompat.Builder(c, kind)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(shownTitle)
            .setContentText(text)
            .setAutoCancel(true)
            .setContentIntent(open(c, sessionId))
        if (kind == ACTION && permissionId.isNotEmpty()) {
            b.addAction(0, "Разрешить", action(c, id, 1, "permission_once", sessionId, permissionId))
            b.addAction(0, "Отклонить", action(c, id, 2, "permission_reject", sessionId, permissionId))
        } else if (kind == ACTION && questionId.isNotEmpty()) {
            b.addAction(0, "Открыть вопрос", open(c, sessionId))
        }
        if (kind == DONE && sessionId.isNotEmpty()) {
            b.addAction(0, "Открыть", open(c, sessionId))
            b.addAction(0, "Стоп", action(c, id, 3, "abort", sessionId, ""))
        }
        if (kind == QUOTA) {
            b.addAction(0, "Настройки", open(c, sessionId))
        }
        try { NotificationManagerCompat.from(c).notify(id, b.build()) } catch (_: SecurityException) {}
    }

    private fun action(c: Context, notifId: Int, slot: Int, op: String, sessionId: String, permissionId: String): PendingIntent {
        val i = Intent(c, ActionReceiver::class.java).apply {
            putExtra("op_action", op)
            putExtra("session_id", sessionId)
            putExtra("permission_id", permissionId)
            putExtra("notif_id", notifId)
        }
        return PendingIntent.getBroadcast(c, notifId * 10 + slot, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun beep(kind: String) {
        Thread {
            try {
                playChime(kind)
            } catch (_: Exception) {}
        }.start()
    }

    /**
     * Synthesizes soft, melodious acoustic bell and chime tones with gentle attack and warm decay.
     * Replaces harsh telephony DTMF dial-tones with harmonious chords.
     */
    private fun playChime(kind: String) {
        val sampleRate = 44100

        data class Tone(val freq: Double, val durationMs: Int, val gapMs: Int = 0)

        val tones = when (kind) {
            DONE -> listOf(
                Tone(659.25, 110, 20), // E5
                Tone(880.00, 130, 20), // A5
                Tone(1318.51, 360, 0)  // E6 warm bell fadeout
            )
            ACTION -> listOf(
                Tone(784.00, 110, 30), // G5
                Tone(1046.50, 280, 0)  // C6 pleasant prompt
            )
            QUOTA -> listOf(
                Tone(587.33, 150, 30), // D5 mellow low
                Tone(493.88, 320, 0)   // B4 soft descending note
            )
            else -> listOf(
                Tone(523.25, 180, 0)
            )
        }

        val totalMs = tones.sumOf { it.durationMs + it.gapMs }
        val totalSamples = (sampleRate * totalMs) / 1000
        val pcm = ShortArray(totalSamples)

        var offset = 0
        for (tone in tones) {
            val noteSamples = (sampleRate * tone.durationMs) / 1000
            val attackSamples = (sampleRate * 0.015).toInt()
            val decayRate = 4.2 / noteSamples

            for (i in 0 until noteSamples) {
                val t = i.toDouble() / sampleRate
                // Harmonic timbre: fundamental (1.0) + 2nd harmonic (0.32) + 3rd harmonic (0.10)
                val wave = sin(2.0 * PI * tone.freq * t) +
                        0.32 * sin(4.0 * PI * tone.freq * t) +
                        0.10 * sin(6.0 * PI * tone.freq * t)

                val env = if (i < attackSamples) {
                    i.toDouble() / attackSamples
                } else {
                    exp(-(i - attackSamples) * decayRate)
                }

                val sample = (wave * env * 14000.0).coerceIn(-32767.0, 32767.0).toInt().toShort()
                if (offset + i < pcm.size) {
                    pcm[offset + i] = sample
                }
            }
            offset += noteSamples + (sampleRate * tone.gapMs) / 1000
        }

        val track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(pcm.size * 2)
            .setTransferMode(AudioTrack.MODE_STATIC)
            .build()

        track.write(pcm, 0, pcm.size)
        track.play()
        Thread.sleep(totalMs.toLong() + 50L)
        track.stop()
        track.release()
    }
}
