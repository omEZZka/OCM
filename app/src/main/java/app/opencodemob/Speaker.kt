package app.opencodemob

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import org.json.JSONObject
import java.util.Locale

/**
 * Text-to-speech for the call mode.
 *
 * Uses the device TTS engine (no cloud dependency, works while the screen is on and offline).
 * Sentences are queued as separate utterances so the first one starts playing as soon as it is
 * synthesised, and `onDone` is reported per utterance id — the UI uses that to know when the agent
 * has finished speaking and can start listening again.
 */
class Speaker(private val context: Context, private val emit: (String, JSONObject) -> Unit) {
    private var tts: TextToSpeech? = null
    private var ready = false
    private var pending = false
    private var voiceId = ""
    private var rate = 1.0f
    private var pitch = 1.0f
    private var queue = ArrayList<String>()
    private var seq = 0
    private val ui = Handler(Looper.getMainLooper())

    fun init(voice: String, rate: Float, pitch: Float) {
        this.voiceId = voice
        this.rate = rate
        this.pitch = pitch
        if (tts != null) { applyVoice(); return }
        pending = true
        tts = TextToSpeech(context) { status ->
            ready = status == TextToSpeech.SUCCESS
            if (ready) {
                applyVoice()
                tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(id: String?) { emit("tts", JSONObject().put("t", "start").put("id", id ?: "")) }
                    override fun onDone(id: String?) {
                        emit("tts", JSONObject().put("t", "done").put("id", id ?: ""))
                        drainNext()
                    }
                    @Deprecated("deprecated in API 21")
                    override fun onError(id: String?) {
                        emit("tts", JSONObject().put("t", "error").put("id", id ?: ""))
                        drainNext()
                    }
                    override fun onError(id: String?, errorCode: Int) {
                        emit("tts", JSONObject().put("t", "error").put("id", id ?: "").put("code", errorCode))
                        drainNext()
                    }
                    override fun onStop(id: String?, interrupted: Boolean) {
                        emit("tts", JSONObject().put("t", "stop").put("id", id ?: ""))
                    }
                })
                emit("tts", JSONObject().put("t", "ready"))
                if (pending) { pending = false; queue.forEach { speakNow(it) }; queue.clear() }
            } else {
                emit("tts", JSONObject().put("t", "error").put("error", "init_failed"))
            }
        }
    }

    private fun applyVoice() {
        val t = tts ?: return
        t.language = if (voiceId.isEmpty()) Locale.getDefault() else Locale.forLanguageTag(voiceId)
        try {
            if (voiceId.isNotEmpty()) {
                t.voices?.firstOrNull { it.name == voiceId }?.let { t.voice = it }
            }
        } catch (_: Exception) {}
        t.setSpeechRate(rate.coerceIn(0.5f, 2.0f))
        t.setPitch(pitch.coerceIn(0.5f, 2.0f))
    }

    fun voices(): String {
        val t = tts ?: return "[]"
        val arr = org.json.JSONArray()
        try {
            t.voices?.forEach { v ->
                    arr.put(JSONObject()
                        .put("id", v.name)
                        .put("locale", v.locale.toLanguageTag())
                        .put("label", v.locale.displayName + (if (v.isNetworkConnectionRequired) " · online" else ""))
                        .put("network", v.isNetworkConnectionRequired))
                }
        } catch (_: Exception) {}
        return arr.toString()
    }

    fun configure(voice: String, rate: Float, pitch: Float) {
        this.voiceId = voice; this.rate = rate; this.pitch = pitch
        applyVoice()
    }

    /** Speaks a chunk; chunks are queued so a long answer is not cut off. */
    fun speak(text: String) {
        val clean = sanitize(text)
        if (clean.isEmpty()) return
        if (!ready) { queue.add(clean); if (tts == null) init(voiceId, rate, pitch); return }
        speakNow(clean)
    }

    private fun speakNow(text: String) {
        val t = tts ?: return
        // Long chunks are split: some engines truncate around 4k characters.
        val parts = splitForSpeech(text)
        parts.forEach { p ->
            val id = "u" + (++seq)
            t.speak(p, TextToSpeech.QUEUE_ADD, null, id)
        }
    }

    /** Strips markdown that sounds terrible when read aloud; keeps code out of the speaker. */
    private fun sanitize(text: String): String = text
        .replace(Regex("```[\\s\\S]*?```"), " ")
        .replace(Regex("`([^`]*)`"), "$1")
        .replace(Regex("!\\[([^\\]]*)\\]\\([^)]*\\)"), "$1")
        .replace(Regex("\\[([^\\]]*)\\]\\([^)]*\\)"), "$1")
        .replace(Regex("^#{1,6}\\s*", RegexOption.MULTILINE), "")
        .replace(Regex("[*_>#|]"), " ")
        .replace(Regex("\\s{2,}"), " ")
        .trim()

    private fun splitForSpeech(text: String): List<String> {
        if (text.length <= 1200) return listOf(text)
        val out = ArrayList<String>()
        var start = 0
        while (start < text.length) {
            var end = minOf(text.length, start + 1200)
            if (end < text.length) {
                val cut = text.lastIndexOfAny(charArrayOf('.', '!', '?', '\n'), end)
                if (cut > start + 200) end = cut + 1
            }
            out.add(text.substring(start, end))
            start = end
        }
        return out
    }

    private fun drainNext() {
        if (queue.isEmpty()) return
        val next = queue.removeAt(0)
        speakNow(next)
    }

    fun stop() {
        queue.clear()
        try { tts?.stop() } catch (_: Exception) {}
    }

    fun shutdown() {
        stop()
        try { tts?.shutdown() } catch (_: Exception) {}
        tts = null; ready = false
    }
}