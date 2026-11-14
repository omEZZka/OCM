package app.opencodemob

import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import org.json.JSONObject

/**
 * Continuous speech recognition tuned for a phone call with an agent.
 *
 * Design notes:
 *  • `SpeechRecognizer` is used directly (no system dialog), so it can run behind our own call screen
 *    and restart itself forever without user interaction.
 *  • Audio source is `VOICE_RECOGNITION`, which applies the platform's speech preprocessing and,
 *    crucially, the echo canceller — without it the agent's own TTS leaked back into the microphone
 *    and the recogniser produced nonsense or restarted constantly.
 *  • Silence timeouts are raised a lot compared to the defaults: people pause mid-sentence when they
 *    dictate a task ("открой файл… эээ… и добавь тест"), and the default 1.5 s cut the phrase in half.
 *  • `EXTRA_ENABLE_LANGUAGE_SWITCH` (where the engine supports it) lets a mostly-Russian sentence
 *    containing English identifiers like `MainActivity.kt` be recognised correctly.
 *  • Errors are decoded into readable codes instead of raw ints, and NO_MATCH/timeouts restart
 *    quickly while real failures (no permission, no network for cloud mode) back off.
 */
class SpeechInput(private val context: Context, private val emit: (String, JSONObject) -> Unit) {
    private val ui = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var running = false
    private var mode = "system"
    private var lang = "ru-RU"
    private var biasing: Array<String> = emptyArray()
    // One-shot mode (dictation): deliver a single phrase and stop. Restarting the recogniser
    // after every result is right for a call, but for dictation it produced ERROR_CLIENT loops
    // and the phrase was lost before the UI could pick it up.
    private var oneShot = false
    private var lastPartial = ""
    private var lastRestart = 0L
    private var quickFails = 0
    private var emittedSpeech = false

    fun isAvailable() = SpeechRecognizer.isRecognitionAvailable(context)

    fun start(mode: String, lang: String, bias: Array<String>, single: Boolean = false) {
        if (!isAvailable()) {
            emit("stt", JSONObject().put("t", "error").put("error", "no_recognizer"))
            return
        }
        this.mode = mode.ifEmpty { "system" }
        this.lang = lang.ifEmpty { "ru-RU" }
        this.biasing = bias
        this.oneShot = single
        this.lastPartial = ""
        quickFails = 0
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
        val r = try { SpeechRecognizer.createSpeechRecognizer(context) } catch (e: Exception) {
            emit("stt", JSONObject().put("t", "error").put("error", "create_failed"))
            running = false
            return
        }
        recognizer = r
        emittedSpeech = false
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {
                emit("stt", JSONObject().put("t", "ready"))
            }
            override fun onBeginningOfSpeech() {
                emittedSpeech = true
                emit("stt", JSONObject().put("t", "begin"))
            }
            override fun onRmsChanged(rmsdB: Float) {
                emit("stt", JSONObject().put("t", "level").put("v", rmsdB.toInt()))
            }
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {
                // The engine heard a complete phrase; a result is on the way.
                emit("stt", JSONObject().put("t", "end"))
            }
            override fun onError(error: Int) {
                if (!running) return
                if (oneShot) {
                    // Dictation: NO_MATCH means "we heard something but could not map it" — surface
                    // the partial text instead of losing the whole phrase.
                    if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                        if (lastPartial.isNotBlank()) emit("stt", JSONObject().put("t", "final").put("text", lastPartial).put("salvaged", true))
                        else emit("stt", JSONObject().put("t", "empty"))
                    } else {
                        emit("stt", JSONObject().put("t", "error").put("code", error))
                    }
                    running = false
                    return
                }
                when (error) {
                    SpeechRecognizer.ERROR_NO_MATCH,
                    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> restartSoon(200L)
                    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> restartSoon(600L)
                    SpeechRecognizer.ERROR_CLIENT -> restartSoon(400L)
                    SpeechRecognizer.ERROR_NETWORK,
                    SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
                    SpeechRecognizer.ERROR_SERVER -> {
                        emit("stt", JSONObject().put("t", "offline"))
                        restartSoon(1500L)
                    }
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> {
                        running = false
                        emit("stt", JSONObject().put("t", "error").put("error", "no_permission").put("code", error))
                    }
                    else -> restartSoon(1000L)
                }
            }
            override fun onResults(results: Bundle?) {
                val list = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: arrayListOf()
                // Engines sometimes return an empty list after a good partial: keep the partial text.
                val text = list.firstOrNull().orEmpty().ifBlank { lastPartial }
                val conf = results?.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES)?.firstOrNull() ?: -1f
                if (text.isNotBlank()) {
                    val o = JSONObject().put("t", "final").put("text", text).put("alts", org.json.JSONArray(list))
                    if (conf >= 0f) o.put("conf", conf.toDouble())
                    emit("stt", o)
                    lastPartial = ""
                }
                if (oneShot) {
                    if (text.isBlank()) emit("stt", JSONObject().put("t", "empty"))
                    running = false
                    return
                }
                if (running) restartSoon(120L)
            }
            override fun onPartialResults(partialResults: Bundle?) {
                val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                if (text.isNotBlank()) {
                    lastPartial = text
                    emit("stt", JSONObject().put("t", "partial").put("text", text))
                }
            }
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })

        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang)
            putExtra(RecognizerIntent.EXTRA_ONLY_RETURN_LANGUAGE_PREFERENCE, false)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
            // Long dictation: do not cut the phrase at the first short pause.
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2200L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2200L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 1200L)
            // Technical vocabulary must survive: no censoring of "bad" words in file names/commands.
            putExtra(RecognizerIntent.EXTRA_MASK_OFFENSIVE_WORDS, false)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, mode == "offline")
            if (biasing.isNotEmpty()) putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, ArrayList(biasing.toList()))
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Voice-recognition capture path: AEC + NS, which keeps our own speech out of the input.
                putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, android.media.MediaRecorder.AudioSource.VOICE_RECOGNITION)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                putExtra(RecognizerIntent.EXTRA_ENABLE_LANGUAGE_SWITCH, RecognizerIntent.LANGUAGE_SWITCH_BALANCED)
            }
        }
        try {
            r.startListening(i)
        } catch (e: Exception) {
            emit("stt", JSONObject().put("t", "error").put("error", e.message ?: "start_failed"))
            restartSoon(1500L)
        }
    }

    private fun restartSoon(delay: Long) {
        val now = System.currentTimeMillis()
        if (now - lastRestart < 900L) quickFails++ else quickFails = 0
        lastRestart = now
        if (quickFails > 25) {
            running = false
            emit("stt", JSONObject().put("t", "error").put("error", "restart_loop"))
            return
        }
        ui.postDelayed({ begin() }, delay)
    }
}