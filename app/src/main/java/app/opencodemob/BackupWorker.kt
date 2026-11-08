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
            Result.retry()
        }
    }

    companion object {
        const val UNIQUE = "ocm-auto-backup"
    }
}
