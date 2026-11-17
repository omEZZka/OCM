package app.opencodemob

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject

/**
 * Standalone assistant brain: parses a phrase into steps and executes them natively.
 *
 * Why native (not WebView JS): the overlay must work even when MainActivity is destroyed —
 * Android kills background activities, and a JS executor living in a dead WebView does nothing.
 *
 * Why apps launch through the accessibility context: Android 10+ blocks background activity
 * starts from a regular service. An AccessibilityService is system-bound and exempt, so
 * `PhoneAccessibilityService.instance` is used as the launch context when available.
 */
object AssistantCore {

    private val ui = Handler(Looper.getMainLooper())

    // ---------- app launching (background-start safe) ----------

    private val ALIASES = mapOf(
        "telegram" to listOf("org.telegram.messenger", "org.telegram.messenger.web", "org.thunderdog.challegram", "org.telegram.plus"),
        "телеграм" to listOf("org.telegram.messenger", "org.telegram.messenger.web", "org.thunderdog.challegram"),
        "телега" to listOf("org.telegram.messenger", "org.thunderdog.challegram"),
        "tg" to listOf("org.telegram.messenger"), "тг" to listOf("org.telegram.messenger"),
        "youtube" to listOf("com.google.android.youtube"), "ютуб" to listOf("com.google.android.youtube"),
        "chrome" to listOf("com.android.chrome"), "хром" to listOf("com.android.chrome"),
        "браузер" to listOf("com.android.chrome", "org.mozilla.firefox"),
        "vk" to listOf("com.vkontakte.android", "com.vk.im"), "вк" to listOf("com.vkontakte.android"),
        "вконтакте" to listOf("com.vkontakte.android"),
        "whatsapp" to listOf("com.whatsapp"), "ватсап" to listOf("com.whatsapp"), "вацап" to listOf("com.whatsapp"),
        "camera" to listOf("com.android.camera", "com.google.android.GoogleCamera"), "камера" to listOf("com.android.camera", "com.google.android.GoogleCamera"),
        "photos" to listOf("com.google.android.apps.photos"), "галерея" to listOf("com.google.android.apps.photos", "com.android.gallery3d"),
        "фото" to listOf("com.google.android.apps.photos"),
        "settings" to listOf("com.android.settings"), "настройки" to listOf("com.android.settings"),
        "calculator" to listOf("com.google.android.calculator", "com.android.calculator2"), "калькулятор" to listOf("com.google.android.calculator", "com.android.calculator2"),
        "music" to listOf("com.google.android.apps.youtube.music", "ru.yandex.music"), "музыка" to listOf("com.google.android.apps.youtube.music", "ru.yandex.music"),
        "github" to listOf("com.github.android"), "гитхаб" to listOf("com.github.android"),
        "files" to listOf("com.google.android.documentsui", "com.android.documentsui"), "файлы" to listOf("com.google.android.documentsui"),
        "clock" to listOf("com.google.android.deskclock", "com.android.deskclock"), "часы" to listOf("com.google.android.deskclock", "com.android.deskclock"),
        "maps" to listOf("com.google.android.apps.maps"), "карты" to listOf("com.google.android.apps.maps"),
        "gmail" to listOf("com.google.android.gm"), "почта" to listOf("com.google.android.gm")
    )

    /** Launch context that is allowed to start activities from the background. */
    private fun launchContext(fallback: Context): Context =
        PhoneAccessibilityService.instance ?: fallback

    fun openApp(c: Context, target: String): Boolean {
        val t = target.trim()
        if (t.isEmpty()) return false
        val ctx = launchContext(c)
        val pm = ctx.packageManager
        val lower = t.lowercase()

        fun start(i: Intent): Boolean = try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
            ctx.startActivity(i)
            true
        } catch (_: Exception) { false }

        // 1. known aliases → installed package
        val candidates = ALIASES[lower] ?: listOf(t)
        for (pkg in candidates) {
            val li = pm.getLaunchIntentForPackage(pkg) ?: continue
            if (start(li)) return true
        }
        // 2. fuzzy search over installed app labels
        try {
            val apps = pm.getInstalledApplications(PackageManager.GET_META_DATA)
            // exact label first, then contains
            val sorted = apps.sortedBy {
                val l = pm.getApplicationLabel(it).toString().lowercase()
                when { l == lower -> 0; l.startsWith(lower) -> 1; l.contains(lower) -> 2; it.packageName.contains(lower) -> 3; else -> 9 }
            }
            for (info in sorted) {
                val l = pm.getApplicationLabel(info).toString().lowercase()
                if (l == lower || l.contains(lower) || info.packageName.lowercase().contains(lower)) {
                    val li = pm.getLaunchIntentForPackage(info.packageName) ?: continue
                    if (start(li)) return true
                }
            }
        } catch (_: Exception) {}
        // 3. uri
        if (t.contains("://")) {
            return start(Intent(Intent.ACTION_VIEW, Uri.parse(t)))
        }
        // 4. market fallback for a package-looking name
        if (t.matches(Regex("^[a-z][a-z0-9_]*(\\.[a-z0-9_]+)+$"))) {
            return start(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$t")))
        }
        return false
    }

    // ---------- macros stored in Prefs (shared with the WebView) ----------

    fun macros(c: Context): JSONArray = try {
        val raw = Prefs.get(c, "assistant_macros", "")
        if (raw.isEmpty()) DEFAULT_MACROS else JSONArray(raw)
    } catch (_: Exception) { DEFAULT_MACROS }

    fun saveMacros(c: Context, arr: JSONArray) { Prefs.put(c, "assistant_macros", arr.toString()) }

    private val DEFAULT_MACROS = JSONArray().apply {
        put(JSONObject().put("id", "game").put("name", "Игровой режим").put("steps", JSONArray()
            .put(JSONObject().put("cmd", "dnd").put("args", JSONArray().put("priority")))
            .put(JSONObject().put("cmd", "volume").put("args", JSONArray().put("media").put("12")))))
        put(JSONObject().put("id", "night").put("name", "Ночной режим").put("steps", JSONArray()
            .put(JSONObject().put("cmd", "dnd").put("args", JSONArray().put("silent")))
            .put(JSONObject().put("cmd", "brightness").put("args", JSONArray().put("30")))
            .put(JSONObject().put("cmd", "volume").put("args", JSONArray().put("media").put("3")))))
        put(JSONObject().put("id", "work").put("name", "Рабочий режим").put("steps", JSONArray()
            .put(JSONObject().put("cmd", "dnd").put("args", JSONArray().put("off")))
            .put(JSONObject().put("cmd", "volume").put("args", JSONArray().put("media").put("8")))))
    }

    fun macroByName(c: Context, name: String): JSONObject? {
        val q = name.trim().lowercase()
        val arr = macros(c)
        for (i in 0 until arr.length()) {
            val m = arr.getJSONObject(i)
            val n = m.optString("name").lowercase()
            if (n == q || n.contains(q)) return m
        }
        return null
    }

    // ---------- phrase parser (ru/en) ----------

    fun parse(c: Context, text: String): JSONArray? {
        val raw = text.trim()
        if (raw.isEmpty()) return null
        macroByName(c, raw)?.let {
            return JSONArray().put(JSONObject().put("cmd", "macro").put("args", JSONArray().put(it.optString("id"))).put("label", it.optString("name")))
        }
        val parts = raw.split(Regex("\\s+(?:и(?:\\s+в\\s+н[её]м)?|затем|потом|после этого)\\s+", RegexOption.IGNORE_CASE))
            .map { it.trim() }.filter { it.isNotEmpty() }
        val steps = JSONArray()
        for (p in parts) {
            val one = parseOne(c, p) ?: return null
            for (i in 0 until one.length()) steps.put(one.getJSONObject(i))
        }
        return if (steps.length() > 0) steps else null
    }

    private fun parseOne(c: Context, t: String): JSONArray? {
        // normalize: strip polite/filler words, punctuation, leading "в нём"
        var orig = t.trim().trimEnd('.', '!', '?', ',')
            .replace(Regex("^в\\s+н[её]м\\s+", RegexOption.IGNORE_CASE), "")
        orig = orig.replace(Regex("^(пожалуйста|плиз|please|ну|давай|ка|будь добр[аы]?|сделай мне|мне)\\s+", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\s+(пожалуйста|плиз|please)$", RegexOption.IGNORE_CASE), "")
            .trim()
        val s = orig.lowercase().replace('ё', 'е')
        if (s.isEmpty()) return null
        fun step(cmd: String, vararg args: String, label: String = cmd): JSONArray {
            val a = JSONArray(); args.forEach { a.put(it) }
            return JSONArray().put(JSONObject().put("cmd", cmd).put("args", a).put("label", label))
        }
        fun has(vararg words: String) = words.any { s.contains(it) }
        fun starts(vararg words: String) = words.any { s.startsWith(it) }

        // ---- macros ----
        if (has("режим", "макрос", "macro", "mode")) {
            val name = s.replace(Regex("^(включи|запусти|активируй|вруби|поставь|activate|enable|turn on)?\\s*(режим|макрос|macro|mode)?\\s*"), "").trim()
            macroByName(c, name)?.let { return step("macro", it.optString("id"), label = it.optString("name")) }
            macroByName(c, s)?.let { return step("macro", it.optString("id"), label = it.optString("name")) }
        }

        // ---- screenshot ----
        if (has("скриншот", "скрин", "screenshot", "снимок экрана", "screen shot", "сфоткай экран", "захвати экран"))
            return step("shot", label = "Скриншот")

        // ---- flashlight (on/off anywhere in the phrase) ----
        if (has("фонарик", "фонарь", "flashlight", "torch", "вспышк")) {
            val off = has("выключи", "выкл", "off", "потуши", "убери", "отключи", "disable", "turn off")
            return step("torch", if (off) "off" else "on", label = if (off) "Фонарик выкл" else "Фонарик вкл")
        }

        // ---- DND / silence ----
        if (has("не беспокоить", "днд", "dnd", "без звука", "тихий режим", "режим тишины", "тишину", "do not disturb", "беззвучн", "mute all", "не тревожить")) {
            val off = has("выключи", "выкл", "off", "отключи", "сними", "disable", "turn off", "верни звук")
            return step("dnd", if (off) "off" else "silent", label = if (off) "DND выкл" else "DND вкл")
        }

        // ---- volume ----
        Regex("(?:громкость|звук|volume)(?:\\s+медиа|\\s+музыки|\\s+media)?\\s*(?:на|до|=)?\\s*(\\d+)").find(s)?.let {
            return step("volume", "media", it.groupValues[1], label = "Громкость " + it.groupValues[1])
        }
        if (has("выключи звук", "убери звук", "без звука полностью", "mute", "заглуши", "тише полностью", "звук на ноль", "громкость 0"))
            return step("volume", "media", "0", label = "Звук выкл")
        if (has("прибавь звук", "погромче", "громче", "volume up", "увеличь громкость"))
            return step("volume", "media", "12", label = "Громче")
        if (has("убавь звук", "потише", "тише", "volume down", "уменьши громкость"))
            return step("volume", "media", "4", label = "Тише")

        // ---- brightness ----
        Regex("(?:яркость|brightness)(?:\\s+экрана)?\\s*(?:на|до|=)?\\s*(\\d+)").find(s)?.let {
            return step("brightness", it.groupValues[1], label = "Яркость " + it.groupValues[1])
        }
        if (has("ярче", "яркость выше", "прибавь яркость", "brighter")) return step("brightness", "220", label = "Ярче")
        if (has("темнее", "яркость ниже", "убавь яркость", "dimmer", "потусклее")) return step("brightness", "40", label = "Темнее")

        // ---- navigation ----
        if (has("назад", "back") && !has("вернись назад в")) return step("back", label = "Назад")
        if (has("домой", "на главную", "home", "главный экран", "рабочий стол")) return step("home", label = "Домой")
        if (has("недавние", "recents", "последние приложения", "открытые приложения", "recent apps")) return step("recents", label = "Недавние")
        if (has("шторка", "уведомления", "notifications", "шторку", "панель уведомлений")) return step("notifications", label = "Уведомления")
        if (has("быстрые настройки", "quick settings", "быстрые переключатели")) return step("quicksettings", label = "Быстрые настройки")
        if (has("заблокируй", "lock", "блокировка экрана", "заблокировать экран")) return step("lock", label = "Блокировка")

        // ---- settings pages ----
        if (has("вайфай", "wifi", "вай-фай", "wi-fi", "вифи")) return step("settings", "wifi", label = "WiFi")
        if (has("блютуз", "bluetooth", "блютус")) return step("settings", "bluetooth", label = "Bluetooth")
        if (has("экономию энергии", "battery saver", "энергосбережение", "энергосберегающий", "режим энергосбережения")) return step("settings", "battery_saver", label = "Экономия энергии")
        if (has("настройки экрана", "display settings", "экран настройки")) return step("settings", "display", label = "Настройки экрана")
        if (has("настройки звука", "sound settings")) return step("settings", "sound", label = "Настройки звука")
        if (has("геолокация", "location", "местоположение", "gps")) return step("settings", "location", label = "Геолокация")
        if (has("авиарежим", "airplane", "режим полета", "в самолете")) return step("settings", "airplane", label = "Авиарежим")
        if (s == "настройки" || s == "открой настройки" || s == "settings") return step("settings", "", label = "Настройки")

        // ---- chat / contact (before generic open) ----
        Regex("^(?:открой|найди|перейди в|зайди в|напиши в|открыть|open)?\\s*(?:чат|диалог|контакт|переписку с|чат с)\\s+(.+)$", RegexOption.IGNORE_CASE).find(orig)?.let {
            val name = it.groupValues[1].trim()
            if (name.isNotEmpty()) return step("text", name, label = "Чат «$name»")
        }
        Regex("^чат\\s+(.+)$", RegexOption.IGNORE_CASE).find(orig)?.let {
            return step("text", it.groupValues[1], label = "Чат «" + it.groupValues[1] + "»")
        }

        // ---- tap visible text ----
        Regex("^(?:нажми|тапни|кликни|нажать|tap|click|press)\\s+(?:на\\s+)?(.+)$", RegexOption.IGNORE_CASE).find(orig)?.let {
            return step("text", it.groupValues[1], label = "Нажать «" + it.groupValues[1] + "»")
        }

        // ---- type text ----
        Regex("^(?:напиши|введи|напечатай|ввести|type|набрать)\\s+(.+)$", RegexOption.IGNORE_CASE).find(orig)?.let {
            return step("type", it.groupValues[1], label = "Ввести текст")
        }

        // ---- open app: flexible verb + optional "приложение" ----
        Regex("^(?:открой|запусти|включи|вруби|открыть|запустить|open|launch|start|запусти мне|открой мне)\\s+(?:приложение\\s+|app\\s+)?(.+)$", RegexOption.IGNORE_CASE).find(orig)?.let {
            val name = it.groupValues[1].trim().removeSuffix(" приложение").removePrefix("приложение ").trim()
            if (name.isNotEmpty()) return step("open", name, label = "Открыть $name")
        }

        // ---- bare known app name ("телеграм", "youtube") ----
        val bare = s.removeSuffix(" приложение").trim()
        if (ALIASES.containsKey(bare)) return step("open", bare, label = "Открыть " + orig)

        // ---- swipe gestures ----
        if (has("свайп вверх", "swipe up", "листай вверх", "прокрути вверх")) return step("swipe", "540", "1800", "540", "600", label = "Свайп вверх")
        if (has("свайп вниз", "swipe down", "листай вниз", "прокрути вниз")) return step("swipe", "540", "600", "540", "1800", label = "Свайп вниз")

        return null
    }

    // ---------- executor ----------

    fun runStep(c: Context, st: JSONObject): JSONObject {
        val cmd = st.optString("cmd")
        val args = st.optJSONArray("args") ?: JSONArray()
        fun a(i: Int) = args.optString(i, "")
        return try {
            when (cmd) {
                "macro" -> {
                    val arr = macros(c)
                    var mac: JSONObject? = null
                    for (i in 0 until arr.length()) {
                        val m = arr.getJSONObject(i)
                        if (m.optString("id") == a(0) || m.optString("name").equals(a(0), true)) { mac = m; break }
                    }
                    if (mac == null) JSONObject().put("ok", false).put("err", "macro not found")
                    else {
                        val steps = mac.optJSONArray("steps") ?: JSONArray()
                        var ok = true; val labels = StringBuilder()
                        for (i in 0 until steps.length()) {
                            val r = runStep(c, steps.getJSONObject(i))
                            if (!r.optBoolean("ok")) { ok = false; labels.append("✗ ").append(r.optString("err")).append('\n'); break }
                            labels.append("✓ ").append(steps.getJSONObject(i).optString("label", steps.getJSONObject(i).optString("cmd"))).append('\n')
                            Thread.sleep(450)
                        }
                        JSONObject().put("ok", ok).put("label", mac.optString("name")).put("detail", labels.toString().trim())
                    }
                }
                "open", "app" -> { val ok = openApp(c, a(0)); JSONObject().put("ok", ok).put("err", if (ok) "" else "приложение не найдено") }
                "torch", "flashlight" -> JSONObject().put("ok", PhoneControl.flashlight(c, a(0) != "off"))
                "dnd" -> PhoneControl.dnd(c, a(0))
                "volume" -> PhoneControl.volume(c, a(0), a(1).toIntOrNull())
                "brightness" -> PhoneControl.brightness(c, a(0).toIntOrNull())
                "settings" -> JSONObject().put("ok", PhoneControl.openSettingsPage(c, a(0)))
                "wait" -> { Thread.sleep(a(0).toLongOrNull() ?: 500); JSONObject().put("ok", true) }
                "back", "home", "recents", "notifications", "quicksettings", "power", "lock", "split" -> {
                    val svc = PhoneAccessibilityService.instance
                    if (svc == null) JSONObject().put("ok", false).put("err", "accessibility_off")
                    else JSONObject().put("ok", svc.global(cmd))
                }
                "tap" -> {
                    val svc = PhoneAccessibilityService.instance ?: return JSONObject().put("ok", false).put("err", "accessibility_off")
                    JSONObject().put("ok", svc.tap(a(0).toFloat(), a(1).toFloat()))
                }
                "swipe" -> {
                    val svc = PhoneAccessibilityService.instance ?: return JSONObject().put("ok", false).put("err", "accessibility_off")
                    JSONObject().put("ok", svc.swipe(a(0).toFloat(), a(1).toFloat(), a(2).toFloat(), a(3).toFloat(), a(4).toLongOrNull() ?: 300))
                }
                "text", "taptext" -> {
                    val svc = PhoneAccessibilityService.instance ?: return JSONObject().put("ok", false).put("err", "accessibility_off")
                    JSONObject().put("ok", svc.tapText(a(0), a(1) == "exact", a(2).toIntOrNull() ?: 0))
                }
                "type" -> {
                    val svc = PhoneAccessibilityService.instance ?: return JSONObject().put("ok", false).put("err", "accessibility_off")
                    JSONObject().put("ok", svc.typeText(a(0)))
                }
                "shot", "screenshot" -> {
                    val svc = PhoneAccessibilityService.instance ?: return JSONObject().put("ok", false).put("err", "accessibility_off")
                    val dest = a(0).ifEmpty { "/storage/emulated/0/Download/OCM/screens/shot_" + System.currentTimeMillis() + ".png" }
                    JSONObject(svc.screenshot(dest))
                }
                else -> JSONObject().put("ok", false).put("err", "unknown cmd: $cmd")
            }
        } catch (e: Exception) { JSONObject().put("ok", false).put("err", e.message ?: "failed") }
    }

    /** Runs a whole phrase; reports progress + final summary through [onStatus]/[onDone]. */
    fun runPhrase(c: Context, text: String, onStatus: (String) -> Unit, onDone: (Boolean, String) -> Unit) {
        Thread {
            val steps = parse(c, text)
            if (steps == null) {
                // unknown → hand to the agent chat if the app is alive, else say so
                ui.post { onDone(false, "AGENT:" + text) }
                return@Thread
            }
            val sb = StringBuilder()
            var ok = true
            for (i in 0 until steps.length()) {
                val st = steps.getJSONObject(i)
                val label = st.optString("label", st.optString("cmd"))
                ui.post { onStatus(label + "…") }
                val r = runStep(c, st)
                val good = r.optBoolean("ok")
                if (good) sb.append("✓ ").append(label)
                else {
                    ok = false
                    val err = r.optString("err")
                    sb.append("✗ ").append(label).append(if (err.isNotEmpty()) " — $err" else "")
                }
                val detail = r.optString("detail")
                if (detail.isNotEmpty()) sb.append('\n').append(detail)
                sb.append('\n')
                if (!good) break
                Thread.sleep(650)
            }
            val summary = sb.toString().trim()
            ui.post { onDone(ok, summary) }
        }.start()
    }
}
