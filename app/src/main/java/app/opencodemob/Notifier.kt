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

    private fun open(c: Context) = PendingIntent.getActivity(
        c, 0, Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
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

    fun event(c: Context, kind: String, title: String, text: String) {
        if (!Prefs.flag(c, "snd_$kind")) return
        beep(kind)
        val n = NotificationCompat.Builder(c, kind)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true)
            .setContentIntent(open(c))
            .build()
        try { NotificationManagerCompat.from(c).notify(10 + kind.hashCode() % 1000, n) } catch (_: SecurityException) {}
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
