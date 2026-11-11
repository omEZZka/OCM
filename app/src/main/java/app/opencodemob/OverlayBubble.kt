package app.opencodemob

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.drawable.Drawable
import android.os.SystemClock
import android.view.View
import androidx.core.content.ContextCompat

/**
 * The floating bubble itself: a 46dp circle that keeps a ring for the current agent state, a pulsing
 * dot while work is in progress, and up to four small job markers.
 *
 * No text at all: only colours carry the meaning, so the bubble stays a perfect circle and never
 * covers what is next to it. The legend lives in Settings → Appearance.
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
    private val icon: Drawable? = ContextCompat.getDrawable(context, R.drawable.ic_tile_server)

    var working: Boolean = false
        set(v) {
            if (field == v) return
            field = v
            requestLayout(); invalidate()
        }

    var stateColor: Int = IDLE
        set(v) { field = v; invalidate() }

    var jobs: List<String> = emptyList()
        set(v) {
            if (field == v) return
            field = v
            requestLayout(); invalidate()
        }

    private val bubble get() = dp(46f)

    // Colour markers only: the bubble never grows into a pill, so it cannot cover content next to it.
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        setMeasuredDimension(bubble.toInt(), bubble.toInt())
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
        } else if (jobs.isNotEmpty()) {
            postInvalidateDelayed(2000) // nothing animates; keep the static ring fresh
        }

        // Job markers: up to four tiny dots along the bottom edge, inside the circle.
        if (jobs.isNotEmpty()) {
            val shown = jobs.take(4)
            val gap = dp(7f)
            val total = gap * (shown.size - 1)
            var dx = cx - total / 2f
            val dy = cy + r * 0.52f
            dotPaint.alpha = 255
            shown.forEach { st ->
                dotPaint.color = when (st) {
                    "done" -> 0xFF22C55E.toInt()
                    "running" -> stateColor
                    "error" -> ERROR
                    "stopped" -> 0xFF71717A.toInt()
                    else -> 0xFF52525B.toInt()
                }
                canvas.drawCircle(dx, dy, dp(2.6f), dotPaint)
                dx += gap
            }
        }
    }
}