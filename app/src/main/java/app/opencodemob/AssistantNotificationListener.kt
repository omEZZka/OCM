package app.opencodemob

import android.app.Notification
import android.content.Intent
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArrayList

/**
 * NotificationListener: sees every notification on the phone (needs the user's opt-in once).
 * Enables "reply to the latest message from X" without opening the chat app.
 */
class AssistantNotificationListener : NotificationListenerService() {

    data class Item(
        val pkg: String,
        val title: String,
        val text: String,
        val remoteInput: android.app.RemoteInput?,
        val actions: JSONArray
    )

    companion object {
        private val items = CopyOnWriteArrayList<Item>()
        fun latest(): List<Item> = items.toList()
        fun enabled(): Boolean = items.isNotEmpty()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val n = sbn.notification
        val extras = n.extras
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: sbn.packageName
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
            ?: extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: ""
        var remoteInput: android.app.RemoteInput? = null
        val actions = JSONArray()
        n.actions?.forEach { a ->
            actions.put(a.title)
            if (a.remoteInputs?.isNotEmpty() == true && remoteInput == null) {
                remoteInput = a.remoteInputs[0]
            }
        }
        items.add(Item(sbn.packageName, title, text, remoteInput, actions))
        if (items.size > 40) items.removeAt(0)
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification) {}
}
