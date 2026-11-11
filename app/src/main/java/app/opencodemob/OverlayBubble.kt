package app.opencodemob

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.os.SystemClock
import android.view.View
import androidx.core.content.ContextCompat

/**
 * The floating bubble itself: a 46dp circle that keeps a ring for the current agent state and a
 * pulsing dot while work is in progress. When a label is set (working / MM role) the view widens
 * into a pill and draws up to four job dots underneath.
 *
 * Everything is drawn manually so the overlay stays one lightweight view: no layout passes, no
 * ripple, and zero invalidations while idle.
 */
class OverlayBubble(context: Context) : View(context) {
    companion object {
        const val ACCENT = 0xFFFAB283.toInt()
        const val ATTENTION = 0xFFF59E0B.toInt()
        const val ERROR = 0xFFEF4444.toInt()
        const val IDLE = 0xFF71717A.toInt()
    }

    private val density = resources.displayMetrics.density
    private fun dp(v: Float) = v * density

    private val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xE6121214.toInt() }
    private val ringPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = dp(2.2f)
        strokeCap = Paint.Cap.ROUND
    }
    private val dotPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = dp(12f)
        typeface = Typeface.DEFAULT_BOLD
        isSubpixelText = true
    }
    private val subPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFF9CA3AF.toInt()
        textSize = dp(9.5f)
        isSubpixelText = true
    }
    private val icon: Drawable? = ContextCompat.getDrawable(context, R.drawable.ic_tile_server)

    var working: Boolean = false
        set(v) {
            if (field == v) return
            field = v
            requestLayout(); invalidate()
        }

    var stateColor: Int = IDLE
        set(v) { field = v; invalidate() }

    var label: String? = null
        set(v) {
            val t = v?.takeIf { it.isNotBlank() }
            if (field == t) return
            field = t
            requestLayout(); invalidate()
        }

    var sublabel: String? = null
        set(v) {
            val t = v?.takeIf { it.isNotBlank() }
            if (field == t) return
            field = t
            requestLayout(); invalidate()
        }

    var jobs: List<String> = emptyList()
        set(v) {
            if (field == v) return
            field = v
            requestLayout(); invalidate()
        }

    private val bubble get() = dp(46f)

    private fun textWidth(): Float {
        var w = 0f
        label?.let { w = w.coerceAtLeast(textPaint.measureText(it)) }
        if (jobs.isNotEmpty()) w = w.coerceAtLeast(jobs.size.coerceAtMost(4) * dp(9f))
        return w
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val extra = if (label != null || jobs.isNotEmpty()) dp(9f) + textWidth() + dp(12f) else 0f
        setMeasuredDimension((bubble + extra).toInt(), bubble.toInt())
    }

    override fun onDraw(canvas: Canvas) {
        val r = bubble / 2f
        val cx = r
        val cy = height / 2f

        canvas.drawCircle(cx, cy, r, bgPaint)

        // State ring: indeterminate sweep while working, quiet full ring otherwise.
        ringPaint.color = stateColor
        val ring = RectF(cx - r + dp(2.4f), cy - r + dp(2.4f), cx + r - dp(2.4f), cy + r - dp(2.4f))
        if (working) {
            val start = (SystemClock.uptimeMillis() % 1400L) / 1400f * 360f
            ringPaint.alpha = 235
            canvas.drawArc(ring, start, 110f, false, ringPaint)
            ringPaint.alpha = 70
            canvas.drawArc(ring, start + 180f, 55f, false, ringPaint)
        } else {
            ringPaint.alpha = 90
            canvas.drawArc(ring, 0f, 360f, false, ringPaint)
        }

        icon?.let {
            val s = dp(18f).toInt()
            it.setBounds((cx - s / 2).toInt(), (cy - s / 2).toInt(), (cx + s / 2).toInt(), (cy + s / 2).toInt())
            it.setTint(Color.WHITE)
            it.draw(canvas)
        }

        // Pulsing attention dot while working.
        if (working) {
            val phase = (SystemClock.uptimeMillis() % 1200L) / 1200f
            dotPaint.color = stateColor
            dotPaint.alpha = (255 * (1f - phase * 0.55f)).toInt()
            canvas.drawCircle(cx + r * 0.60f, cy - r * 0.60f, dp(3f) + dp(2.4f) * (1f - phase), dotPaint)
            // ~25 fps is enough for the sweep dot and keeps the overlay cheap on battery
            postInvalidateDelayed(40)
        } else if (label != null || jobs.isNotEmpty()) {
            postInvalidateDelayed(2000) // nothing animates; keep the static ring fresh
        }

        val x = bubble + dp(9f)
        label?.let {
            val y = if (jobs.isNotEmpty() || sublabel != null) cy - dp(3f) else cy + textPaint.textSize / 3f
            canvas.drawText(it, x, y, textPaint)
        }
        sublabel?.let { canvas.drawText(it, x, cy + dp(9f), subPaint) }

        if (jobs.isNotEmpty()) {
            var dx = x + dp(1f)
            val dy = if (label != null) cy + dp(9f) else cy
            jobs.take(4).forEach { st ->
                dotPaint.alpha = 255
                dotPaint.color = when (st) {
                    "done" -> 0xFF22C55E.toInt()
                    "running" -> stateColor
                    "error" -> ERROR
                    "stopped" -> 0xFF71717A.toInt()
                    else -> 0xFF3F3F46.toInt()
                }
                canvas.drawCircle(dx + dp(3f), dy, dp(3f), dotPaint)
                dx += dp(9f)
            }
        }
    }
}