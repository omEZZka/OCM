package app.opencodemob

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import androidx.core.content.ContextCompat

/**
 * Quick Settings tile: start or stop the local opencode server without opening the app.
 * A long press opens the app directly (TileService automatically launches the intent set via
 * `TileService.requestListeningState`/`startActivityAndCollapse` on newer platforms).
 */
class ServerTileService : TileService() {

    override fun onStartListening() {
        super.onStartListening()
        refresh()
    }

    override fun onClick() {
        super.onClick()
        val ready = ServerState.ready
        if (ready) {
            stopService(Intent(this, OpenCodeService::class.java))
            ServerState.ready = false
            ServerState.error = null
        } else {
            val uid = Prefs.get(this, "uid")
            if (uid.isEmpty()) {
                // no profile yet: let the app create one
                openApp()
                return
            }
            ServerState.error = null
            try {
                ContextCompat.startForegroundService(this, Intent(this, OpenCodeService::class.java).putExtra("uid", uid))
            } catch (_: Exception) {
                openApp()
            }
        }
        // the service flips ServerState asynchronously; show the intent immediately and re-sync
        refresh(if (ready) Tile.STATE_INACTIVE else Tile.STATE_ACTIVE)
    }

    private fun refresh(state: Int = -1) {
        val tile = qsTile ?: return
        val running = if (state >= 0) state == Tile.STATE_ACTIVE else ServerState.ready
        tile.state = if (running) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.label = getString(R.string.tile_server_label)
        if (running) {
            tile.subtitle = getString(R.string.tile_server_running)
        } else {
            tile.subtitle = ServerState.error?.let { getString(R.string.tile_server_error) } ?: getString(R.string.tile_server_stopped)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try { tile.icon = Icon.createWithResource(this, R.drawable.ic_tile_server) } catch (_: Exception) {}
        }
        try { tile.updateTile() } catch (_: Exception) {}
    }

    private fun openApp() {
        val i = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startActivityAndCollapse(android.app.PendingIntent.getActivity(
                this, 0, i, android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
            ))
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(i)
        }
    }

    companion object {
        /** Asks the system to refresh the tile state, e.g. after the server comes up or goes down. */
        fun sync(context: Context) {
            try {
                requestListeningState(context, ComponentName(context, ServerTileService::class.java))
            } catch (_: Exception) {}
        }
    }
}