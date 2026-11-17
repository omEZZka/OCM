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
import org.json.JSONObject

/**
 * Device-level controls that do NOT need accessibility: flashlight, DND, volume, brightness,
 * wifi/bluetooth settings pages, battery saver page. Used by the assistant, macros and the agent.
 */
object PhoneControl {

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
