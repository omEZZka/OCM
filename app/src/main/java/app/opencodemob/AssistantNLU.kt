package app.opencodemob

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Assistant NLU: context memory, typo tolerance, word numbers, relative adjustments,
 * time expressions, mixed ru+en, slang, and an LLM fallback for unknown phrases.
 */
object AssistantNLU {

    // ---- conversation context (idea 2) ----
    @Volatile var lastPackage: String = ""
    @Volatile var lastChat: String = ""
    @Volatile var lastAppQuery: String = ""
    @Volatile var pendingConfirm: JSONObject? = null

    // ---- numbers in words (idea 5) ----
    private val NUMBERS = mapOf(
        "ноль" to 0, "нуль" to 0, "один" to 1, "одна" to 1, "два" to 2, "две" to 2, "три" to 3,
        "четыре" to 4, "пять" to 5, "шесть" to 6, "семь" to 7, "восемь" to 8, "девять" to 9,
        "десять" to 10, "одиннадцать" to 11, "двенадцать" to 12, "тринадцать" to 13,
        "четырнадцать" to 14, "пятнадцать" to 15, "шестнадцать" to 16, "семнадцать" to 17,
        "восемнадцать" to 18, "девятнадцать" to 19, "двадцать" to 20, "тридцать" to 30,
        "сорок" to 40, "пятьдесят" to 50, "шестьдесят" to 60, "семьдесят" to 70,
        "восемьдесят" to 80, "девяносто" to 90, "сто" to 100,
        "zero" to 0, "one" to 1, "two" to 2, "three" to 3, "four" to 4, "five" to 5,
        "six" to 6, "seven" to 7, "eight" to 8, "nine" to 9, "ten" to 10,
        "eleven" to 11, "twelve" to 12, "thirteen" to 13, "fourteen" to 14, "fifteen" to 15,
        "twenty" to 20, "thirty" to 30, "forty" to 40, "fifty" to 50
    )
    private val NUM_RE = NUMBERS.keys.joinToString("|").let { Regex("($it)", RegexOption.IGNORE_CASE) }

    fun wordToNumber(s: String): Int? {
        val t = s.trim().lowercase().replace('ё', 'е')
        if (t.matches(Regex("\\d+"))) return t.toIntOrNull()
        if (t in NUMBERS) return NUMBERS[t]
        // compound: "двадцать пять", "twenty five"
        val parts = t.split(Regex("\\s+"))
        if (parts.size == 2 && parts[0] in NUMBERS && parts[1] in NUMBERS) {
            val a = NUMBERS[parts[0]]!!; val b = NUMBERS[parts[1]]!!
            if (a >= 20 && b < 10) return a + b
        }
        if (parts.size == 3 && parts[0] == "сто") {
            val b = NUMBERS[parts[1]] ?: return null
            val c = NUMBERS[parts[2]] ?: return null
            return 100 + b + c
        }
        return null
    }

    fun replaceNumbers(s: String): String = NUM_RE.replace(s) { (wordToNumber(it.value)?.toString() ?: it.value) }

    // ---- relative adjustments (idea 6) ----
    fun relativeOf(s: String): Triple<Int, Int, Int>? {
        // "ярче на 20%", "громче на 10", "тише на треть", "ярче в два раза"
        val m = Regex("(ярче|темнее|громче|тише|выше|ниже|больше|меньше)\\s+(?:на\\s+)?(\\d+)(?:\\s*(%|процента|процентов|пункта|пунктах|раза|раз|делен)?)?").find(s)
            ?: return null
        val n = m.groupValues[2].toInt()
        val unit = m.groupValues[3]
        val dir = when (m.groupValues[1]) { "ярче", "громче", "выше", "больше" -> 1; else -> -1 }
        val pct = unit == "%" || unit.startsWith("процент")
        return Triple(dir, n, if (pct) 1 else 0)
    }

    // ---- typo tolerance (idea 4): Levenshtein against command vocabulary ----
    private val VOCAB = listOf(
        "телеграм", "ютуб", "хром", "вк", "ватсап", "инстаграм", "дискорд", "тикток", "спотифай",
        "фонарик", "скриншот", "настройки", "калькулятор", "камера", "галерея", "музыка", "файлы",
        "громкость", "яркость", "назад", "домой", "уведомления", "майнкрафт", "телега", "инста", "майн"
    )
    private fun lev(a: String, b: String): Int {
        val dp = Array(a.length + 1) { IntArray(b.length + 1) }
        for (i in 0..a.length) dp[i][0] = i
        for (j in 0..b.length) dp[0][j] = j
        for (i in 1..a.length) for (j in 1..b.length) {
            dp[i][j] = minOf(dp[i - 1][j] + 1, dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + if (a[i - 1] == b[j - 1]) 0 else 1)
        }
        return dp[a.length][b.length]
    }
    fun fixTypos(s: String): String = s.split(Regex("\\s+")).joinToString(" ") { w ->
        if (w.length < 4) return@joinToString w
        val best = VOCAB.minByOrNull { lev(w, it) } ?: return@joinToString w
        if (lev(w, best) <= 1 && best != w) best else w
    }

    // ---- time expressions (idea 7): "напомни через 10 минут", "будильник на 7 утра" ----
    fun timeOf(s: String): Long? {
        val low = s.lowercase().replace('ё', 'е')
        Regex("через\\s+(\\d+)\\s*(секунд|секунды|секунды?|сек|s|sec)").find(low)?.let {
            return System.currentTimeMillis() + it.groupValues[1].toLong() * 1000
        }
        Regex("через\\s+(\\d+)\\s*(минут|минуты|мин|m|min)").find(low)?.let {
            return System.currentTimeMillis() + it.groupValues[1].toLong() * 60000
        }
        Regex("через\\s+(\\d+)\\s*(час|часа|часов|h|hour)").find(low)?.let {
            return System.currentTimeMillis() + it.groupValues[1].toLong() * 3600000
        }
        // "на 7 утра", "на 19:30"
        Regex("(?:на|в)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(утра|дня|вечера|ночи)?").find(low)?.let {
            val h = it.groupValues[1].toInt()
            val min = it.groupValues[2].toIntOrNull() ?: 0
            val now = java.util.Calendar.getInstance()
            val cal = now.clone() as java.util.Calendar
            var hour = h
            when (it.groupValues[3]) {
                "дня" -> if (hour < 12) hour += 12
                "вечера" -> if (hour < 12) hour += 12
            }
            cal.set(java.util.Calendar.HOUR_OF_DAY, hour)
            cal.set(java.util.Calendar.MINUTE, min)
            cal.set(java.util.Calendar.SECOND, 0)
            if (cal.timeInMillis <= System.currentTimeMillis()) cal.add(java.util.Calendar.DAY_OF_YEAR, 1)
            return cal.timeInMillis
        }
        return null
    }

    // ---- slang normalization (idea 9) ----
    private val SLANG = mapOf(
        "вруби" to "включи", "врубай" to "включи", "бахни" to "сделай", "запили" to "сделай",
        "музон" to "музыку", "скрин" to "скриншот", "сфоткай" to "сделай снимок",
        "открой мне" to "открой", "запусти мне" to "запусти", "погнали" to "запусти",
        "убавь" to "убавь звук", "прибавь" to "прибавь звук", "заглуши" to "выключи звук",
        "тп" to "тг", "телегу" to "телеграм", "телегрм" to "телеграм", "телегрмм" to "телеграм"
    )
    fun normalizeSlang(s: String): String = SLANG.entries.fold(s) { acc, (k, v) -> acc.replace(Regex("\\b$k\\b", RegexOption.IGNORE_CASE), v) }
}
