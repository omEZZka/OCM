package app.opencodemob

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject

/**
 * Small encrypted key-value store backed by a Keystore-protected preference file.
 *
 * Used for secrets that used to sit in plain localStorage inside the WebView profile (API key
 * rings): anyone with a backup of the app data could read them. The key material never leaves the
 * Android Keystore, and the file itself is AES-256-GCM encrypted at rest.
 */
object SecureStore {
    private const val FILE = "ocm_secure"

    // The Keystore-backed preferences can be create-heavy; keep one instance per process.
    private var prefs: SharedPreferences? = null

    private fun open(c: Context): SharedPreferences? {
        prefs?.let { return it }
        return try {
            val key = MasterKey.Builder(c)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            val p = EncryptedSharedPreferences.create(
                c,
                FILE,
                key,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
            prefs = p
            p
        } catch (_: Exception) {
            null
        }
    }

    fun put(c: Context, k: String, v: String): Boolean = try {
        open(c)?.edit()?.putString(k, v)?.commit() ?: false
    } catch (_: Exception) { false }

    fun get(c: Context, k: String): String = try { open(c)?.getString(k, "") ?: "" } catch (_: Exception) { "" }

    fun remove(c: Context, k: String): Boolean = try {
        open(c)?.edit()?.remove(k)?.commit() ?: false
    } catch (_: Exception) { false }

    /**
     * One-way migration of the legacy plaintext key ring from localStorage into the secure store.
     * Called once from the bridge; the UI drops its copy after a successful move.
     */
    fun importLegacy(c: Context, ringJson: String): Boolean {
        val obj = try { JSONObject(ringJson) } catch (_: Exception) { return false }
        var ok = false
        val it = obj.keys()
        while (it.hasNext()) {
            val pid = it.next()
            val arr = obj.optJSONArray(pid) ?: continue
            if (put(c, "ring.$pid", arr.toString())) ok = true
        }
        return ok
    }

    fun ring(c: Context, pid: String): String = get(c, "ring.$pid")
}