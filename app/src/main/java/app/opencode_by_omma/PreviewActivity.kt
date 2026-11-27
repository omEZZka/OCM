package app.opencode_by_omma

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.webkit.WebViewAssetLoader
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import java.io.ByteArrayInputStream
import java.io.File

/**
 * Sandboxed viewer for generated project previews.
 *
 * Preview documents are arbitrary project code, not our UI. Opening them in an iframe inside the
 * main WebView exposed the `OC` bridge to them (JavascriptInterface is injected into every frame,
 * regardless of the sandbox attribute), which meant a cloned repository could read the profile,
 * the stored keys or call native network helpers. This activity runs a separate WebView with no
 * JavascriptInterface at all and no file access: the preview can only render itself.
 */
class PreviewActivity : ComponentActivity() {
    private var web: WebView? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val url = intent?.getStringExtra("url").orEmpty()
        if (url.isEmpty()) { finish(); return }

        val dir = File(cacheDir, "preview")
        // One root handler: project files may reference assets with relative or absolute paths
        // ("/style.css"), and both must resolve inside the prepared preview directory.
        fun serve(relIn: String): WebResourceResponse {
            val rel = relIn.removePrefix("/").ifEmpty { "index.html" }
            val file = File(dir, rel)
            val inside = try { file.canonicalPath.startsWith(dir.canonicalPath + File.separator) } catch (_: Exception) { false }
            if (!inside || !file.isFile) {
                return WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
            }
            val mime = when (file.extension.lowercase()) {
                "html", "htm" -> "text/html"
                "css" -> "text/css"
                "js", "mjs" -> "application/javascript"
                "json" -> "application/json"
                "svg" -> "image/svg+xml"
                "png" -> "image/png"
                "jpg", "jpeg" -> "image/jpeg"
                "webp" -> "image/webp"
                "gif" -> "image/gif"
                "ico" -> "image/x-icon"
                "woff2" -> "font/woff2"
                "woff" -> "font/woff"
                "ttf" -> "font/ttf"
                else -> "application/octet-stream"
            }
            return WebResourceResponse(mime, "UTF-8", 200, "OK",
                mapOf("Cache-Control" to "no-cache, no-store, must-revalidate"), file.inputStream())
        }

        val loader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/_preview/", WebViewAssetLoader.PathHandler { path ->
                serve(path.orEmpty().removePrefix("/_preview/"))
            })
            .addPathHandler("/", WebViewAssetLoader.PathHandler { path -> serve(path.orEmpty()) })
            .build()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFF0D0D0F.toInt())
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, ins ->
            val i = ins.getInsets(WindowInsetsCompat.Type.systemBars())
            v.setPadding(i.left, i.top, i.right, i.bottom)
            WindowInsetsCompat.CONSUMED
        }

        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(0xFF141417.toInt())
            setPadding(12, 10, 12, 10)
        }
        val close = Button(this).apply {
            text = "✕"
            setTextColor(Color.parseColor("#E4E4E7"))
            setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener { finish() }
        }
        val title = TextView(this).apply {
            text = intent?.getStringExtra("title") ?: "Preview"
            setTextColor(Color.parseColor("#E4E4E7"))
            textSize = 14f
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.MIDDLE
        }
        bar.addView(close, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        bar.addView(title, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        root.addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        val w = WebView(this).apply {
            setBackgroundColor(0xFF0D0D0F.toInt())
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.allowFileAccessFromFileURLs = false
            settings.allowUniversalAccessFromFileURLs = false
            settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.setSupportZoom(true)
            settings.builtInZoomControls = true
            settings.displayZoomControls = false
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(v: WebView, r: WebResourceRequest): WebResourceResponse? =
                    loader.shouldInterceptRequest(r.url)
                override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                    val u = r.url
                    if (u.host == "appassets.androidplatform.net") return false
                    if (u.scheme == "http" || u.scheme == "https") {
                        try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (_: Exception) {}
                        return true
                    }
                    return true
                }
            }
            // no addJavascriptInterface on purpose
        }
        web = w
        root.addView(w, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        w.loadUrl(url)

        onBackPressedDispatcher.addCallback(this) {
            if (w.canGoBack()) w.goBack() else finish()
        }
    }

    override fun onDestroy() {
        val w = web
        try { (w?.parent as? ViewGroup)?.removeView(w) } catch (_: Exception) {}
        try { w?.destroy() } catch (_: Exception) {}
        web = null
        super.onDestroy()
    }
}