package app.opencodemob

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject

/**
 * Device-level controls that do NOT need accessibility: flashlight, DND, volume, brightness,
 * wifi/bluetooth settings pages, battery saver page, app launching. Used by the agent's `phone` CLI.
 */
object PhoneControl {

    // ---------- app launching (kept from the removed assistant: the agent still opens apps) ----------

    private val APP_ALIASES = mapOf(
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

    private val APP_ABBREV = mapOf(
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
        "снапчат" to "snapchat", "снап" to "snapchat",
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

    /** Launch context that is allowed to start activities from the background (Android 10+). */
    private fun launchContext(fallback: Context): Context =
        PhoneAccessibilityService.instance ?: fallback

    /** Result of an app launch attempt: ok + human-readable reason. */
    fun openAppDetailed(c: Context, target: String): JSONObject {
        val t0 = target.trim()
        if (t0.isEmpty()) return JSONObject().put("ok", false).put("err", "пустое имя")
        val key0 = t0.lowercase().replace('ё', 'е').replace(Regex("[\\s._-]"), "")
        val t = APP_ABBREV[key0] ?: t0
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
                Thread.sleep(1200)
            }
            return true
        }

        val candidates = APP_ALIASES[lower] ?: APP_ALIASES[t.lowercase()] ?: emptyList()
        for (pkg in candidates) if (tryPkg(pkg)) return JSONObject().put("ok", true).put("package", pkg)

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

        // transliteration fuzzy match: "телеграм"/"telegram"/"tlgrm" -> same app
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
                val score = when {
                    ln == targetN -> 100
                    ln == targetT || lt == targetN || lt == targetT -> 80
                    ln.startsWith(targetN) || targetN.startsWith(ln) -> 85
                    lt.startsWith(targetT) || targetT.startsWith(lt) -> 70
                    ln.contains(targetN) || targetN.contains(ln) -> 65
                    lt.contains(targetT) || targetT.contains(lt) -> 55
                    ln.split(Regex("\\s+")).any { it.startsWith(targetN) || translit(it).startsWith(targetT) } -> 60
                    else -> 0
                }
                if (score >= 50 && (best == null || score > best!!.second)) best = pkg to score
            }
            if (best != null && tryPkg(best!!.first)) return JSONObject().put("ok", true).put("package", best!!.first)
        } catch (_: Exception) {}

        if (t.matches(Regex("^[a-z][a-z0-9_]*(\\.[a-z0-9_]+)+$"))) {
            if (tryPkg(t)) return JSONObject().put("ok", true).put("package", t)
        }
        if (t.contains("://")) {
            val err = start(Intent(Intent.ACTION_VIEW, Uri.parse(t)))
            if (err == null) return JSONObject().put("ok", true)
            lastErr = err
        }
        return if (lastErr != null) JSONObject().put("ok", false).put("err", "запуск заблокирован: $lastErr. Включите Accessibility или разрешите поверх окон")
        else JSONObject().put("ok", false).put("err", "приложение «$t» не найдено")
    }

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

    /** List launchable apps (for `phone apps`). */
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

    @Volatile private var torchOn = false
    private var torchId: String? = null

    fun flashlight(c: Context, on: Boolean): Boolean = try {
        val cm = c.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        if (torchId == null) {
            torchId = cm.cameraIdList.firstOrNull {
                cm.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
            }
        }
        val id = torchId ?: return false
        if (Build.VERSION.SDK_INT >= 23) {
            cm.setTorchMode(id, on)
            torchOn = on
            true
        } else false
    } catch (_: Exception) { false }

    fun torchState(): Boolean = torchOn

    /** DND: needs Notification Policy access; returns false + opens the grant page when missing. */
    fun dnd(c: Context, mode: String): JSONObject {
        val nm = c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (!nm.isNotificationPolicyAccessGranted) {
            return JSONObject().put("ok", false).put("err", "policy_access")
                .put("hint", "Разрешите «Не беспокоить» для OpenCode Mobile")
        }
        val f = when (mode.lowercase()) {
            "off", "none_off" -> NotificationManager.INTERRUPTION_FILTER_ALL
            "priority" -> NotificationManager.INTERRUPTION_FILTER_PRIORITY
            "alarms" -> NotificationManager.INTERRUPTION_FILTER_ALARMS
            "silent", "total", "on" -> NotificationManager.INTERRUPTION_FILTER_NONE
            else -> NotificationManager.INTERRUPTION_FILTER_ALL
        }
        return try {
            nm.setInterruptionFilter(f)
            JSONObject().put("ok", true).put("mode", mode)
        } catch (e: Exception) { JSONObject().put("ok", false).put("err", e.message ?: "failed") }
    }

    fun volumeDelta(c: Context, stream: String, delta: Int, isPercent: Boolean): JSONObject = try {
        val am = c.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val s = if (stream == "alarm") AudioManager.STREAM_ALARM else AudioManager.STREAM_MUSIC
        val cur = am.getStreamVolume(s)
        val max = am.getStreamMaxVolume(s)
        val target = if (isPercent) (cur * (100 + delta) / 100).coerceIn(0, max) else (cur + delta).coerceIn(0, max)
        am.setStreamVolume(s, target, 0)
        JSONObject().put("ok", true).put("level", target).put("max", max)
    } catch (e: Exception) { JSONObject().put("ok", false).put("err", e.message ?: "failed") }

    fun volume(c: Context, stream: String, level: Int?): JSONObject = try {
        val am = c.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val s = when (stream.lowercase()) {
            "media", "music" -> AudioManager.STREAM_MUSIC
            "ring", "ringer" -> AudioManager.STREAM_RING
            "alarm" -> AudioManager.STREAM_ALARM
            "call", "voice" -> AudioManager.STREAM_VOICE_CALL
            "notification" -> AudioManager.STREAM_NOTIFICATION
            else -> AudioManager.STREAM_MUSIC
        }
        val max = am.getStreamMaxVolume(s)
        if (level != null) am.setStreamVolume(s, level.coerceIn(0, max), 0)
        JSONObject().put("ok", true).put("stream", stream).put("level", am.getStreamVolume(s)).put("max", max)
    } catch (e: Exception) { JSONObject().put("ok", false).put("err", e.message ?: "failed") }

    fun brightnessDelta(c: Context, delta: Int, isPercent: Boolean): JSONObject {
        if (!Settings.System.canWrite(c)) return JSONObject().put("ok", false).put("err", "write_settings")
        return try {
            val cur = Settings.System.getInt(c.contentResolver, Settings.System.SCREEN_BRIGHTNESS, 128)
            val target = if (isPercent) (cur * (100 + delta) / 100).coerceIn(1, 255) else (cur + delta).coerceIn(1, 255)
            Settings.System.putInt(c.contentResolver, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL)
            Settings.System.putInt(c.contentResolver, Settings.System.SCREEN_BRIGHTNESS, target)
            JSONObject().put("ok", true).put("level", target)
        } catch (e: Exception) { JSONObject().put("ok", false).put("err", e.message ?: "failed") }
    }

    fun brightness(c: Context, level: Int?): JSONObject {
        // system brightness needs WRITE_SETTINGS; open the page when not granted
        if (!Settings.System.canWrite(c)) {
            return JSONObject().put("ok", false).put("err", "write_settings")
        }
        return try {
            if (level != null) {
                Settings.System.putInt(c.contentResolver, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL)
                Settings.System.putInt(c.contentResolver, Settings.System.SCREEN_BRIGHTNESS, level.coerceIn(1, 255))
            }
            val cur = Settings.System.getInt(c.contentResolver, Settings.System.SCREEN_BRIGHTNESS, 128)
            JSONObject().put("ok", true).put("level", cur)
        } catch (e: Exception) { JSONObject().put("ok", false).put("err", e.message ?: "failed") }
    }

    fun openSettingsPage(c: Context, page: String): Boolean = try {
        val a = when (page.lowercase()) {
            "wifi" -> Settings.ACTION_WIFI_SETTINGS
            "bluetooth" -> Settings.ACTION_BLUETOOTH_SETTINGS
            "battery", "battery_saver" -> Settings.ACTION_BATTERY_SAVER_SETTINGS
            "dnd", "zen" -> Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS
            "accessibility" -> Settings.ACTION_ACCESSIBILITY_SETTINGS
            "display" -> Settings.ACTION_DISPLAY_SETTINGS
            "sound" -> Settings.ACTION_SOUND_SETTINGS
            "apps" -> Settings.ACTION_APPLICATION_SETTINGS
            "location" -> Settings.ACTION_LOCATION_SOURCE_SETTINGS
            "airplane" -> Settings.ACTION_AIRPLANE_MODE_SETTINGS
            "data" -> Settings.ACTION_DATA_ROAMING_SETTINGS
            "write_settings" -> Settings.ACTION_MANAGE_WRITE_SETTINGS
            else -> Settings.ACTION_SETTINGS
        }
        val i = Intent(a).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (page == "write_settings") i.data = Uri.parse("package:" + c.packageName)
        c.startActivity(i)
        true
    } catch (_: Exception) { false }

    fun status(c: Context): JSONObject {
        val nm = c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val am = c.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        return JSONObject()
            .put("accessibility", PhoneAccessibilityService.enabled())
            .put("overlay", Settings.canDrawOverlays(c))
            .put("dndAccess", nm.isNotificationPolicyAccessGranted)
            .put("dndFilter", nm.currentInterruptionFilter)
            .put("writeSettings", Settings.System.canWrite(c))
            .put("torch", torchOn)
            .put("mediaVolume", am.getStreamVolume(AudioManager.STREAM_MUSIC))
            .put("mediaMax", am.getStreamMaxVolume(AudioManager.STREAM_MUSIC))
            .put("batterySaver", (c.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager).isPowerSaveMode)
    }
}
