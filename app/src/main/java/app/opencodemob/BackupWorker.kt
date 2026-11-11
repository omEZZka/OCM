package app.opencodemob

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/** Periodic encrypted backup of the current profile. Password is stored in Prefs (opt-in). */
class BackupWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val ctx = applicationContext
        val uid = Prefs.get(ctx, "uid")
        val pw = Prefs.get(ctx, "auto_backup_pw")
        if (uid.isEmpty() || pw.isEmpty()) return Result.success()
        return try {
            Backup.runAutoBackup(ctx, uid, pw)
            Result.success()
        } catch (_: Exception) {
            // A wrong password or a full disk does not fix itself: endless retries just burn
            // battery. Skip this cycle after three attempts but keep the periodic schedule alive
            // (Result.failure() would cancel the periodic work permanently).
            if (runAttemptCount < 3) Result.retry() else Result.success()
        }
    }

    companion object {
        const val UNIQUE = "ocm-auto-backup"
    }
}
