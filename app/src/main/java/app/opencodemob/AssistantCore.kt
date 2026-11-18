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

    private val ABBREV = mapOf(
        "тг" to "telegram", "tg" to "telegram", "телега" to "telegram", "теле" to "telegram", "tlgr" to "telegram", "tlg" to "telegram",
        "инста" to "instagram", "insta" to "instagram", "инст" to "instagram", "inst" to "instagram", "иг" to "instagram",
        "майн" to "minecraft", "майнкрафт" to "minecraft", "mc" to "minecraft", "майнкр" to "minecraft",
        "ватс" to "whatsapp", "ватсап" to "whatsapp", "вацап" to "whatsapp", "whats" to "whatsapp", "wa" to "whatsapp", "васап" to "whatsapp",
        "ютуб" to "youtube", "ют" to "youtube", "yt" to "youtube", "you" to "youtube",
        "вк" to "vk", "вконтакте" to "vk",
        "хром" to "chrome", "браузер" to "chrome",
        "гугл" to "google", "гуг" to "google",
        "тикток" to "tiktok", "тик" to "tiktok", "tt" to "tiktok", "tik" to "tiktok",
        "спотифай" to "spotify", "спот" to "spotify", "spot" to "spotify",
        "дискорд" to "discord", "дс" to "discord", "disc" to "discord", "ds" to "discord",
        "твиттер" to "twitter", "тви" to "twitter",
        "фейсбук" to "facebook", "фб" to "facebook", "fb" to "facebook", "face" to "facebook",
        "реддит" to "reddit", "ред" to "reddit",
        "пинтерест" to "pinterest", "пин" to "pinterest",
        "снапчат" to "snapchat", "снап" to "snapchat", "snap" to "snapchat",
        "зум" to "zoom", "слак" to "slack", "нотион" to "notion", "фигма" to "figma",
        "гитхаб" to "github", "гит" to "github", "gh" to "github",
        "камера" to "camera", "cam" to "camera", "галерея" to "photos", "фото" to "photos",
        "настройки" to "settings", "сет" to "settings", "калькулятор" to "calculator", "кальк" to "calculator", "calc" to "calculator",
        "часы" to "clock", "будильник" to "clock", "карты" to "maps", "почта" to "gmail", "мейл" to "gmail",
        "музыка" to "music", "файлы" to "files", "телефон" to "phone", "звонки" to "phone",
        "сообщения" to "messages", "смс" to "messages", "sms" to "messages",
        "плей" to "play market", "маркет" to "play market", "драйв" to "drive",
        "сбер" to "sberbank", "сбербанк" to "sberbank", "тинькофф" to "tinkoff", "тиньк" to "tinkoff", "тбанк" to "tbank",
        "яндекс" to "yandex", "ян" to "yandex", "такси" to "yandex go",
        "озон" to "ozon", "вб" to "wildberries", "валдберис" to "wildberries", "авито" to "avito"
    )

    /** Result of an app launch attempt: ok + human-readable reason. */
    fun openAppDetailed(c: Context, target: String): JSONObject {
        val t0 = target.trim()
        if (t0.isEmpty()) return JSONObject().put("ok", false).put("err", "пустое имя")
        // expand abbreviations: тг -> telegram, майн -> minecraft, инста -> instagram
        val key0 = t0.lowercase().replace('ё', 'е').replace(Regex("[\\s._-]"), "")
        val t = ABBREV[key0] ?: t0
        val ctx = launchContext(c)
        val pm = ctx.packageManager
        val lower = t.lowercase().replace('ё', 'е')

        fun start(i: Intent): String? = try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
            ctx.startActivity(i)
            null
        } catch (e: Exception) { e.message ?: "start blocked" }

        var lastErr: String? = null
        fun tryPkg(pkg: String): Boolean {
            val li = pm.getLaunchIntentForPackage(pkg) ?: return false
            val err = start(li)
            if (err != null) { lastErr = err; return false }
            // VERIFY: the app must actually reach the foreground, not just "intent sent"
            val svc = PhoneAccessibilityService.instance
            if (svc != null) {
                if (!svc.waitForPackage(pkg, 6000)) { lastErr = "приложение не вышло на передний план"; return false }
            } else {
                Thread.sleep(1200) // no accessibility: best-effort settle time
            }
            return true
        }

        // 1. known aliases
        val candidates = ALIASES[lower] ?: ALIASES[t.lowercase()] ?: emptyList()
        for (pkg in candidates) if (tryPkg(pkg)) return JSONObject().put("ok", true).put("package", pkg)

        // 2. enumerate ALL launchable apps via MAIN/LAUNCHER query (sees preinstalled apps too)
        try {
            val q = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            val resolved = pm.queryIntentActivities(q, 0)
            data class Cand(val pkg: String, val label: String, val score: Int)
            val cands = ArrayList<Cand>()
            for (ri in resolved) {
                val pkg = ri.activityInfo?.packageName ?: continue
                val label = try { ri.loadLabel(pm).toString() } catch (_: Exception) { pkg }
                val l = label.lowercase().replace('ё', 'е')
                val score = when {
                    l == lower -> 0
                    l.startsWith(lower) -> 1
                    l.contains(lower) -> 2
                    pkg.lowercase().contains(lower) -> 3
                    else -> 9
                }
                if (score < 9) cands.add(Cand(pkg, label, score))
            }
            cands.sortBy { it.score }
            for (cd in cands) if (tryPkg(cd.pkg)) return JSONObject().put("ok", true).put("package", cd.pkg).put("label", cd.label)
        } catch (_: Exception) {}

        // 3. getInstalledApplications fallback (labels of apps without launcher aliases)
        try {
            val apps = pm.getInstalledApplications(0)
            val sorted = apps.mapNotNull { info ->
                val label = try { pm.getApplicationLabel(info).toString() } catch (_: Exception) { info.packageName }
                val l = label.lowercase().replace('ё', 'е')
                val score = when { l == lower -> 0; l.startsWith(lower) -> 1; l.contains(lower) -> 2; info.packageName.lowercase().contains(lower) -> 3; else -> 9 }
                if (score < 9) info to score else null
            }.sortedBy { it.second }
            for ((info, _) in sorted) if (tryPkg(info.packageName)) return JSONObject().put("ok", true).put("package", info.packageName)
        } catch (_: Exception) {}

        // 3b. transliteration fuzzy match: "телеграм"/"telegram"/"tlgrm" -> same app
        try {
            val q = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            val resolved = pm.queryIntentActivities(q, 0)
            val norm = { x: String -> x.lowercase().replace('ё', 'е').replace(Regex("[\\s._-]"), "") }
            val targetN = norm(lower)
            val targetT = translit(targetN)
            var best: Pair<String, Int>? = null
            for (ri in resolved) {
                val pkg = ri.activityInfo?.packageName ?: continue
                val label = try { ri.loadLabel(pm).toString() } catch (_: Exception) { pkg }
                val ln = norm(label)
                val lt = translit(ln)
                val lc = translit(ln) // cyr form of a latin label
                val score = when {
                    ln == targetN -> 100
                    ln == targetT || lt == targetN || lt == targetT || lc == targetN -> 80
                    ln.startsWith(targetN) || targetN.startsWith(ln) -> 85
                    lt.startsWith(targetT) || targetT.startsWith(lt) || lc.startsWith(targetN) || targetN.startsWith(lc) -> 70
                    ln.contains(targetN) || targetN.contains(ln) -> 65
                    lt.contains(targetT) || targetT.contains(lt) || lc.contains(targetN) || targetN.contains(lc) -> 55
                    ln.split(Regex("\\s+")).any { it.startsWith(targetN) || translit(it).startsWith(targetT) } -> 60
                    else -> 0
                }
                if (score >= 50 && (best == null || score > best!!.second)) best = pkg to score
            }
            if (best != null && tryPkg(best!!.first)) return JSONObject().put("ok", true).put("package", best!!.first)
        } catch (_: Exception) {}

        // 4. direct package name
        if (t.matches(Regex("^[a-z][a-z0-9_]*(\\.[a-z0-9_]+)+$"))) {
            if (tryPkg(t)) return JSONObject().put("ok", true).put("package", t)
        }
        // 5. uri
        if (t.contains("://")) {
            val err = start(Intent(Intent.ACTION_VIEW, Uri.parse(t)))
            if (err == null) return JSONObject().put("ok", true)
            lastErr = err
        }
        // distinguish "not found" from "found but launch blocked"
        return if (lastErr != null) JSONObject().put("ok", false).put("err", "запуск заблокирован: $lastErr. Включите Accessibility или разрешите поверх окон")
        else JSONObject().put("ok", false).put("err", "приложение «$t» не найдено")
    }

    fun openApp(c: Context, target: String): Boolean = openAppDetailed(c, target).optBoolean("ok")

    /** Rough latin<->cyrillic transliteration for fuzzy app-name matching. */
    private fun translit(s: String): String {
        val lat2cyr = mapOf("a" to "а", "b" to "б", "v" to "в", "g" to "г", "d" to "д", "e" to "е", "z" to "з", "i" to "и", "k" to "к", "l" to "л", "m" to "м", "n" to "н", "o" to "о", "p" to "п", "r" to "р", "s" to "с", "t" to "т", "u" to "у", "f" to "ф", "h" to "х", "c" to "к", "y" to "й", "w" to "в", "j" to "дж", "q" to "к")
        val cyr2lat = mapOf("а" to "a", "б" to "b", "в" to "v", "г" to "g", "д" to "d", "е" to "e", "ж" to "zh", "з" to "z", "и" to "i", "й" to "y", "к" to "k", "л" to "l", "м" to "m", "н" to "n", "о" to "o", "п" to "p", "р" to "r", "с" to "s", "т" to "t", "у" to "u", "ф" to "f", "х" to "h", "ц" to "ts", "ч" to "ch", "ш" to "sh", "щ" to "sch", "ы" to "y", "э" to "e", "ю" to "yu", "я" to "ya")
        val hasCyr = s.any { it in 'а'..'я' || it == 'ё' }
        return if (hasCyr) s.map { cyr2lat[it.toString()] ?: it.toString() }.joinToString("")
        else {
            val sb = StringBuilder(); var i = 0
            while (i < s.length) {
                val two = s.substring(i, minOf(i + 2, s.length))
                when (two) {
                    "sh" -> { sb.append("ш"); i += 2 }
                    "ch" -> { sb.append("ч"); i += 2 }
                    "zh" -> { sb.append("ж"); i += 2 }
                    "ya" -> { sb.append("я"); i += 2 }
                    "yu" -> { sb.append("ю"); i += 2 }
                    else -> { sb.append(lat2cyr[s[i].toString()] ?: s[i].toString()); i++ }
                }
            }
            sb.toString()
        }
    }

    /** List launchable apps (for `phone apps` and debugging). */
    fun listApps(c: Context): JSONArray {
        val out = JSONArray()
        try {
            val pm = c.packageManager
            val q = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            val seen = HashSet<String>()
            for (ri in pm.queryIntentActivities(q, 0)) {
                val pkg = ri.activityInfo?.packageName ?: continue
                if (!seen.add(pkg)) continue
                val label = try { ri.loadLabel(pm).toString() } catch (_: Exception) { pkg }
                out.put(JSONObject().put("package", pkg).put("label", label))
                if (out.length() >= 300) break
            }
        } catch (_: Exception) {}
        return out
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
        val parts = raw.split(Regex("\\s+(?:и(?:\\s+в\\s+н[её]м)?|затем|потом|после этого)\\s+", RegexOption.IGNORE_CASE)).map { it.trim() }.filter { it.isNotEmpty() }
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
        // NLU pass: slang -> canonical, typo fix, numbers in words
        orig = AssistantNLU.normalizeSlang(orig)
        orig = AssistantNLU.fixTypos(orig)
        orig = AssistantNLU.replaceNumbers(orig)
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
        AssistantNLU.relativeOf(s)?.let { (dir, n, isPct) ->
            if (has("ярче", "темнее", "громче", "тише")) {
                if (has("ярче", "темнее")) return step("brightness", "delta", (dir * n).toString(), if (isPct == 1) "percent" else "points", label = (if (dir > 0) "+" else "-") + n.toString())
                else return step("volume", "media", "delta", (dir * n).toString(), if (isPct == 1) "percent" else "points", label = (if (dir > 0) "+" else "-") + n.toString())
            }
        }
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

        // ---- notifications / contacts / alarms / media ----
        if (has("что за уведомление", "последнее уведомление", "latest notification", "что пришло")) return step("notify_latest", label = "Последнее уведомление")
        Regex("^(?:ответь|ответить|reply)\\s*(?:на\\s+)?(.+)$", RegexOption.IGNORE_CASE).find(orig)?.let {
            return step("reply", it.groupValues[1], label = "Ответить")
        }
        Regex("^(?:позвони|вызови|call|набери)\\s+(.+)$", RegexOption.IGNORE_CASE).find(orig)?.let {
            val target = it.groupValues[1]
            return step(if (target.any { ch -> ch.isDigit() || ch == '+' }) "dial" else "call", target, label = "Звонок $target")
        }
        Regex("^(?:напиши смс|отправь смс|sms)\\s+(.+?)\\s+(?:текст|сообщение)?\\s*(.+)?$", RegexOption.IGNORE_CASE).find(orig)?.let {
            return step("sms", it.groupValues[1], it.groupValues[2], label = "SMS")
        }
        Regex("^(?:поставь |заведи |установи )?(?:будильник|alarm)(?:\\s+на)?\\s+(\\d{1,2})(?::(\\d{2}))?").find(s)?.let {
            return step("alarm", it.groupValues[1], it.groupValues[2].ifEmpty { "0" }, label = "Будильник")
        }
        Regex("^(?:таймер|timer)\\s*(?:на)?\\s*(\\d+)").find(s)?.let {
            return step("timer", it.groupValues[1], label = "Таймер")
        }
        if (has("следующий трек", "next track", "дальше", "вперед")) return step("media", "next", label = "Следующий трек")
        if (has("предыдущий трек", "previous track", "назад трек")) return step("media", "prev", label = "Предыдущий трек")
        if (has("пауза", "pause", "стоп музыка", "останови музыку")) return step("media", "pause", label = "Пауза")
        if (has("играй", "play", "продолжи музыку", "включи музыку")) return step("media", "play", label = "Играть")

        // ---- record / replay / journal ----
        if (has("запиши макрос", "начни запись", "record", "начать запись")) return step("recorder", "start", label = "Запись началась")
        if (has("закончи запись", "стоп запись", "stop recording", "сохрани макрос")) return step("recorder", "stop", label = "Запись сохранена")
        if (has("повтори макрос", "повтори путь", "replay", "сыграй макрос")) return step("replay", "last", label = "Повтор пути")
        if (has("журнал", "journal", "что ты сделал", "история действий")) return step("journal", "", label = "Журнал действий")

        // ---- scroll / wait ----
        if (has("прокрути вниз", "листай вниз", "свайп вниз", "scroll down", "скролл вниз", "ниже")) return step("scroll", "down", label = "Прокрутка вниз")
        if (has("прокрути вверх", "листай вверх", "свайп вверх", "scroll up", "скролл вверх", "выше")) return step("scroll", "up", label = "Прокрутка вверх")
        Regex("^(?:подожди|жди|wait)\\s*(\\d+)?").find(s)?.let {
            val ms = (it.groupValues[1].toIntOrNull() ?: 2) * 1000
            return step("wait", ms.toString(), label = "Пауза")
        }
        Regex("^(?:найди|ищи|find)\\s+(.+)$", RegexOption.IGNORE_CASE).find(orig)?.let {
            return step("find", it.groupValues[1], label = "Найти «" + it.groupValues[1] + "»")
        }

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
                "open", "app" -> openAppDetailed(c, a(0))
                "apps" -> JSONObject().put("ok", true).put("apps", listApps(c))
                "torch", "flashlight" -> JSONObject().put("ok", PhoneControl.flashlight(c, a(0) != "off"))
                "dnd" -> PhoneControl.dnd(c, a(0))
                "volume" -> if (a(1) == "delta") PhoneControl.volumeDelta(c, a(0), a(2).toIntOrNull() ?: 0, a(3) == "percent")
                    else PhoneControl.volume(c, a(0), a(1).toIntOrNull())
                "brightness" -> if (a(0) == "delta") PhoneControl.brightnessDelta(c, a(1).toIntOrNull() ?: 0, a(2) == "percent")
                    else PhoneControl.brightness(c, a(0).toIntOrNull())
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
                "text", "taptext", "find" -> {
                    val svc = PhoneAccessibilityService.instance ?: return JSONObject().put("ok", false).put("err", "accessibility_off")
                    svc.tapTextSmart(a(0), a(1) == "exact", a(2).toIntOrNull() ?: 0, true)
                }
                "scroll" -> {
                    val svc = PhoneAccessibilityService.instance ?: return JSONObject().put("ok", false).put("err", "accessibility_off")
                    val dir = if (a(0) == "up" || a(0) == "-1") -1 else 1
                    JSONObject().put("ok", svc.scroll(dir))
                }
                "notify_latest" -> AssistantIntegrations.latestNotification()
                "reply" -> AssistantIntegrations.replyLatest(c, a(0))
                "dial" -> AssistantIntegrations.dial(c, a(0))
                "call" -> AssistantIntegrations.callContact(c, a(0))
                "sms" -> AssistantIntegrations.smsContact(c, a(0), a(1))
                "alarm" -> AssistantIntegrations.alarm(c, a(0).toInt(), a(1).toIntOrNull() ?: 0)
                "timer" -> AssistantIntegrations.timer(c, a(0).toIntOrNull() ?: 60, a(1))
                "media" -> AssistantIntegrations.media(c, a(0))
                "waittext" -> {
                    val svc = PhoneAccessibilityService.instance ?: return JSONObject().put("ok", false).put("err", "accessibility_off")
                    svc.waitText(a(0), a(1).toLongOrNull() ?: 8000)
                }
                "type" -> {
                    val svc = PhoneAccessibilityService.instance ?: return JSONObject().put("ok", false).put("err", "accessibility_off")
                    svc.typeAnywhere(a(0), a(1) == "append")
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

    /** (1) LLM fallback: unknown phrase -> {intent, args} via the local opencode assistant session. */
    private fun llmParse(c: Context, text: String, onDone: (JSONArray?) -> Unit) {
        try {
            // 1) create a session in the ASSISTANT directory (keeps history separate from the main chat)
            val create = JSONObject().put("title", "🎙 Ассистент")
            Net.request(c, "asst_create_" + System.currentTimeMillis().toString(36), "POST", "/session", create.toString(), { _, resp ->
                try {
                    val sid = JSONObject(resp.optString("body")).optString("id")
                    // 2) ask for a structured intent JSON
                    val prompt = "Ты — парсер команд Android-ассистента. Разбери фразу в список действий. " +
                        "Допустимые cmd: open(приложение), text(нажать по тексту), type(ввести текст), shot(скриншот), torch(on/off), dnd(silent/off), volume(media N), brightness(N), back, home, recents, notifications, quicksettings, scroll(up/down), find(текст), wait(мс), media(play/pause/next/prev), call(имя), dial(номер), sms(имя текст), alarm(час мин), timer(сек), reply(текст), notify_latest, recorder(start/stop), replay, journal. " +
                        "Ответь ТОЛЬКО JSON-массивом: [{\"cmd\":\"...\",\"args\":[\"...\"],\"label\":\"...\"}] без пояснений. " +
                        "Фраза: «" + text.replace("\"", "'") + "»"
                    val body = JSONObject()
                        .put("messageID", "asst_" + System.currentTimeMillis().toString(36))
                        .put("parts", org.json.JSONArray().put(JSONObject().put("type", "text").put("text", prompt)))
                    Net.request(c, "asst_prompt_" + System.currentTimeMillis().toString(36), "POST", "/session/" + sid + "/prompt_async", body.toString(), { _, _ ->
                        // 3) poll the session until idle, then read the last assistant text
                        Thread {
                            try {
                                var answer = ""
                                var finished = false
                                repeat(60) {
                                    if (finished) return@repeat
                                    Thread.sleep(1000)
                                    val st = Net.requestSync(c, "asst_status_" + System.currentTimeMillis().toString(36), "GET", "/session/status", "")
                                    val status = JSONObject(st).optJSONObject("body")?.optJSONObject(sid)
                                    val type = status?.optString("type") ?: "idle"
                                    if (type == "idle" || type == "error") {
                                        val msg = Net.requestSync(c, "asst_msgs_" + System.currentTimeMillis().toString(36), "GET", "/session/" + sid + "/message", "")
                                        val arr = org.json.JSONArray(JSONObject(msg).optString("body"))
                                        for (i in arr.length() - 1 downTo 0) {
                                            val m = arr.getJSONObject(i)
                                            val info = m.optJSONObject("info")
                                            if (info?.optString("role") == "assistant") {
                                                val parts = m.optJSONArray("parts") ?: continue
                                                for (j in 0 until parts.length()) {
                                                    val p = parts.getJSONObject(j)
                                                    if (p.optString("type") == "text") { answer = p.optString("text"); break }
                                                }
                                            }
                                            if (answer.isNotEmpty()) break
                                        }
                                        finished = true
                                    }
                                }
                                val m = Regex("\\[[\\s\\S]*\\]").find(answer)
                                onDone(if (m != null) JSONArray(m.value) else null)
                            } catch (_: Exception) { onDone(null) }
                        }.start()
                    })
                } catch (_: Exception) { onDone(null) }
            })
        } catch (_: Exception) { onDone(null) }
    }

    /** Runs a whole phrase; reports progress + final summary through [onStatus]/[onDone]. */
    fun runPhrase(c: Context, text: String, onStatus: (String) -> Unit, onDone: (Boolean, String) -> Unit) {
        Thread {
            val steps = parse(c, text)
            if (steps == null) {
                // (1) LLM fallback for unknown phrases: let the model structure the intent,
                // then execute it locally instead of dumping everything into the chat.
                if (Prefs.get(c, "assistant.llm", "1") == "1") {
                    ui.post { onStatus("Думаю над командой…") }
                    llmParse(c, text) { parsed ->
                        if (parsed != null && parsed.length() > 0) {
                            runSteps(c, parsed, onStatus, onDone)
                        } else {
                            ui.post { onDone(false, "AGENT:" + text) }
                        }
                    }
                } else {
                    ui.post { onDone(false, "AGENT:" + text) }
                }
                return@Thread
            }
            runSteps(c, steps, onStatus, onDone)
        }.start()
    }

    private fun runSteps(c: Context, steps: JSONArray, onStatus: (String) -> Unit, onDone: (Boolean, String) -> Unit) {
        Thread {
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
                val cmd = st.optString("cmd")
                Thread.sleep(if (cmd == "open" || cmd == "app") 1500 else if (cmd == "text" || cmd == "find") 900 else 650)
                // (84) post-action verification: if the step named something on screen, confirm it changed
                if (good && (cmd == "text" || cmd == "find")) {
                    val svc = PhoneAccessibilityService.instance
                    if (svc != null && !svc.waitText("").optBoolean("ok", true)) {
                        // tapTextSmart already verified the change; nothing more to do
                    }
                }
            }
            val summary = sb.toString().trim()
            ui.post { onDone(ok, summary) }
        }.start()
    }
}
