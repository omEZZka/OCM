package app.opencodemob

import android.app.RemoteInput
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.AlarmClock
import android.provider.ContactsContract
import android.speech.tts.TextToSpeech
import org.json.JSONArray
import org.json.JSONObject

/**
 * Assistant integrations: notifications→actions, contacts/phone, alarms/timers,
 * media transport, TTS replies, and a NotificationListener for reply-from-anywhere.
 */
object AssistantIntegrations {

    // ---- (61) notification actions ----
    fun latestNotification(): JSONObject {
        val n = AssistantNotificationListener.latest().lastOrNull()
            ?: return JSONObject().put("ok", false).put("err", "уведомлений нет (или нет доступа NotificationListener)")
        return JSONObject().put("ok", true).put("pkg", n.pkg).put("title", n.title).put("text", n.text).put("actions", n.actions)
    }

    fun replyLatest(c: Context, text: String): JSONObject {
        val n = AssistantNotificationListener.latest().lastOrNull()
            ?: return JSONObject().put("ok", false).put("err", "нет уведомления для ответа")
        return try {
            val remoteInput = n.remoteInput ?: return JSONObject().put("ok", false).put("err", "это уведомление не поддерживает быстрый ответ")
            val pi = n.actionIntent ?: return JSONObject().put("ok", false).put("err", "нет действия для ответа")
            val results = Bundle()
            results.putCharSequence(remoteInput.resultKey, text)
            val intent = Intent()
            RemoteInput.addResultsToIntent(arrayOf(remoteInput), intent, results)
            pi.send(c, 0, intent, null, null)
            JSONObject().put("ok", true)
        } catch (e: Exception) { JSONObject().put("ok", false).put("err", e.message ?: "failed") }
    }

    // ---- (64) contacts ----
    fun dial(c: Context, target: String): JSONObject = try {
        val i = Intent(Intent.ACTION_DIAL, Uri.parse("tel:$target"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        c.startActivity(i)
        JSONObject().put("ok", true)
    } catch (e: Exception) { JSONObject().put("ok", false).put("err", e.message ?: "failed") }

    fun callContact(c: Context, name: String): JSONObject {
        // resolve a contact by name via Contacts provider
        try {
            val cr = c.contentResolver
            val cursor = cr.query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER),
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " LIKE ?",
                arrayOf("%$name%"), null)
            var number = ""
            cursor?.use { if (it.moveToFirst()) number = it.getString(0) }
            if (number.isEmpty()) return JSONObject().put("ok", false).put("err", "контакт «$name» не найден")
            return dial(c, number)
        } catch (e: Exception) {
            return JSONObject().put("ok", false).put("err", e.message ?: "contacts permission")
        }
    }

    fun smsContact(c: Context, name: String, text: String): JSONObject {
        try {
            val cr = c.contentResolver
            val cursor = cr.query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER),
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " LIKE ?",
                arrayOf("%$name%"), null)
            var number = ""
            cursor?.use { if (it.moveToFirst()) number = it.getString(0) }
            if (number.isEmpty()) return JSONObject().put("ok", false).put("err", "контакт «$name» не найден")
            val i = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:$number"))
                .putExtra("sms_body", text).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            c.startActivity(i)
            return JSONObject().put("ok", true)
        } catch (e: Exception) { return JSONObject().put("ok", false).put("err", e.message ?: "failed") }
    }

    // ---- (65) alarms / timers ----
    fun alarm(c: Context, hour: Int, minute: Int): JSONObject = try {
        val i = Intent(AlarmClock.ACTION_SET_ALARM)
            .putExtra(AlarmClock.EXTRA_HOUR, hour)
            .putExtra(AlarmClock.EXTRA_MINUTES, minute)
            .putExtra(AlarmClock.EXTRA_SKIP_UI, false)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        c.startActivity(i)
        JSONObject().put("ok", true).put("time", "%02d:%02d".format(hour, minute))
    } catch (e: Exception) { JSONObject().put("ok", false).put("err", e.message ?: "failed") }

    fun timer(c: Context, seconds: Int, label: String = "Таймер"): JSONObject = try {
        val i = Intent(AlarmClock.ACTION_SET_TIMER)
            .putExtra(AlarmClock.EXTRA_LENGTH, seconds)
            .putExtra(AlarmClock.EXTRA_MESSAGE, label)
            .putExtra(AlarmClock.EXTRA_SKIP_UI, false)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        c.startActivity(i)
        JSONObject().put("ok", true).put("seconds", seconds)
    } catch (e: Exception) { JSONObject().put("ok", false).put("err", e.message ?: "failed") }

    // ---- (66) media transport via media button broadcast ----
    fun media(c: Context, action: String): JSONObject = try {
        val am = c.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val key = when (action) {
            "play", "pause", "toggle" -> android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
            "next" -> android.view.KeyEvent.KEYCODE_MEDIA_NEXT
            "prev", "previous" -> android.view.KeyEvent.KEYCODE_MEDIA_PREVIOUS
            "stop" -> android.view.KeyEvent.KEYCODE_MEDIA_STOP
            else -> android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
        }
        val intent = Intent(Intent.ACTION_MEDIA_BUTTON)
        val evt = android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, key)
        intent.putExtra(Intent.EXTRA_KEY_EVENT, evt)
        c.sendOrderedBroadcast(intent, null)
        JSONObject().put("ok", true).put("action", action)
    } catch (e: Exception) { JSONObject().put("ok", false).put("err", e.message ?: "failed") }

    // ---- (27) TTS replies ----
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    fun speak(c: Context, text: String, rate: Float = 1.0f, pitch: Float = 1.0f) {
        if (text.isBlank()) return
        if (tts == null) {
            tts = TextToSpeech(c) { status ->
                ttsReady = status == TextToSpeech.SUCCESS
                if (ttsReady) {
                    tts?.setSpeechRate(rate)
                    tts?.setPitch(pitch)
                    tts?.speak(text, TextToSpeech.QUEUE_ADD, Bundle(), "assistant_" + System.nanoTime())
                }
            }
        } else if (ttsReady) {
            tts?.setSpeechRate(rate); tts?.setPitch(pitch)
            tts?.speak(text, TextToSpeech.QUEUE_ADD, Bundle(), "assistant_" + System.nanoTime())
        }
    }
    fun stopSpeak() { try { tts?.stop() } catch (_: Exception) {} }
}
