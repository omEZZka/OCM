package app.opencodemob

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import org.json.JSONObject

/**
 * Continuous speech recognition, independent of the system dialog.
 *
 * Uses `SpeechRecognizer` directly (no `ACTION_RECOGNIZE_SPEECH` overlay) so the recogniser can run
 * in the background while the app shows its own call screen, and restarts itself after every
 * utterance to keep the microphone open.
 *
 * Engine choice:
 *  - `system`  : whatever recogniser the phone ships (usually Google, sometimes offline)
 *  - `offline` : `EXTRA_PREFER_OFFLINE` — Android's on-device model, no network, lower quality
 *  - `cloud`   : the system recogniser without the offline preference (Google cloud)
 *
 * Partial results are streamed so the UI can show live text and detect end-of-turn quickly.
 */
class SpeechInput(private val context: Context, private val emit: (String, JSONObject) -> Unit) {
    private val ui = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var running = false
    private var mode = "system"
    private var lang = "ru-RU"
    private var restarts = 0
    private var lastRestart = 0L

    fun isAvailable() = SpeechRecognizer.isRecognitionAvailable(context)

    fun start(mode: String, lang: String) {
        if (!isAvailable()) {
            emit("stt", JSONObject().put("t", "error").put("error", "no_recognizer"))
            return
        }
        this.mode = mode.ifEmpty { "system" }
        this.lang = lang.ifEmpty { "ru-RU" }
        restarts = 0
        running = true
        ui.post { begin() }
    }

    fun stop() {
        running = false
        ui.post {
            try { recognizer?.stopListening() } catch (_: Exception) {}
            try { recognizer?.cancel() } catch (_: Exception) {}
            try { recognizer?.destroy() } catch (_: Exception) {}
            recognizer = null
        }
    }

    private fun begin() {
        if (!running) return
        try { recognizer?.destroy() } catch (_: Exception) {}
        val r = SpeechRecognizer.createSpeechRecognizer(context)
        recognizer = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {
                emit("stt", JSONObject().put("t", "ready"))
            }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {
                emit("stt", JSONObject().put("t", "level").put("v", rmsdB.toInt()))
            }
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onError(error: Int) {
                if (!running) return
                // 7 = NO_MATCH, 6 = SPEECH_TIMEOUT: normal pauses, just restart and keep listening.
                if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                    restartSoon(250L); return
                }
                emit("stt", JSONObject().put("t", "error").put("code", error))
                // 1 network, 2 network timeout, 9 insufficient permissions, 5 client: stop retrying
                if (error == 9 || error == 5) { running = false; return }
                restartSoon(1200L)
            }
            override fun onResults(results: Bundle?) {
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                if (text.isNotBlank()) emit("stt", JSONObject().put("t", "final").put("text", text))
                if (running) restartSoon(200L)
            }
            override fun onPartialResults(partialResults: Bundle?) {
                val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                if (text.isNotBlank()) emit("stt", JSONObject().put("t", "partial").put("text", text))
            }
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
            if (mode == "offline") {
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            } else if (mode == "cloud") {
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false)
            }
        }
        try { r.startListening(intent) } catch (e: Exception) {
            emit("stt", JSONObject().put("t", "error").put("error", e.message ?: "start_failed"))
            running = false
        }
    }

    private fun restartSoon(delay: Long) {
        // The counter resets whenever a restart actually leads to audio, so long calls are not
        // capped; a tight failure loop still stops after a few dozen quick retries.
        val now = System.currentTimeMillis()
        if (now - lastRestart < 800L) restarts++ else restarts = 0
        lastRestart = now
        if (restarts > 40) { running = false; emit("stt", JSONObject().put("t", "error").put("error", "restart_loop")); return }
        ui.postDelayed({ begin() }, delay)
    }
}