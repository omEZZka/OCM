package app.opencodemob

import android.content.Context
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.SecureRandom
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream
import javax.crypto.Cipher
import javax.crypto.CipherInputStream
import javax.crypto.CipherOutputStream
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/** Encrypted profile backup/restore shared by the UI bridge and the scheduled worker. */
object Backup {
    private fun deriveKey(password: String, salt: ByteArray): SecretKeySpec {
        val spec = PBEKeySpec(password.toCharArray(), salt, 120_000, 256)
        val f = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        return SecretKeySpec(f.generateSecret(spec).encoded, "AES")
    }

    fun backupDir(context: Context): File =
        File("/sdcard/Download").takeIf { it.exists() && it.canWrite() } ?: context.filesDir

    /** Returns the number of files skipped because of the size caps (reported to the user). */
    fun backupZip(home: File, out: File, password: String): Int {
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, deriveKey(password, salt), GCMParameterSpec(128, iv))
        val skip = setOf("node_modules", ".cache", "tmp", "bin", "rootfs", "proot-tmp")
        var total = 0L
        var skipped = 0
        // Write next to the target and swap it in only on success: a crash or a full disk must not
        // leave a truncated .ocmbak that later looks like a usable backup.
        val tmp = File(out.parentFile, out.name + ".part")
        try {
            FileOutputStream(tmp).use { fos ->
                fos.write("OCMB1".toByteArray())
                fos.write(salt)
                fos.write(iv)
                CipherOutputStream(fos, cipher).use { cos ->
                    ZipOutputStream(cos).use { zos ->
                        home.walkTopDown().forEach { f ->
                            if (!f.isFile) return@forEach
                            val rel = f.relativeTo(home).path
                            if (rel.split('/').any { it in skip }) return@forEach
                            if (f.length() > 50_000_000L || total + f.length() > 200_000_000L) { skipped++; return@forEach }
                            total += f.length()
                            try {
                                zos.putNextEntry(ZipEntry(rel))
                                f.inputStream().use { it.copyTo(zos) }
                                zos.closeEntry()
                            } catch (_: Exception) {}
                        }
                    }
                }
            }
        } catch (e: Throwable) {
            tmp.delete()
            throw e
        }
        if (!tmp.renameTo(out)) {
            tmp.copyTo(out, overwrite = true)
            tmp.delete()
        }
        out.setLastModified(System.currentTimeMillis())
        return skipped
    }

    fun restoreZip(src: File, home: File, password: String) {
        // Extract into a staging directory first: AES-GCM only proves authenticity when the stream
        // reaches its end, so decrypting straight into HOME used to leave a half-restored profile
        // behind when the password was wrong or the file was truncated.
        val staging = File(home.parentFile, home.name + ".restore-" + System.currentTimeMillis())
        try {
            staging.mkdirs()
            FileInputStream(src).use { fis ->
                val magic = ByteArray(5)
                if (fis.read(magic) != 5 || String(magic) != "OCMB1") throw IllegalArgumentException("not an OCM backup")
                val salt = ByteArray(16); if (fis.read(salt) != 16) throw IllegalArgumentException("corrupt backup")
                val iv = ByteArray(12); if (fis.read(iv) != 12) throw IllegalArgumentException("corrupt backup")
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, deriveKey(password, salt), GCMParameterSpec(128, iv))
                CipherInputStream(fis, cipher).use { cis ->
                    ZipInputStream(cis).use { zis ->
                        var e = zis.nextEntry
                        while (e != null) {
                            val name = e.name
                            if (name.startsWith("/") || name.contains("..")) {
                                zis.closeEntry(); e = zis.nextEntry; continue
                            }
                            val dest = File(staging, name)
                            if (!dest.canonicalPath.startsWith(staging.canonicalPath + File.separator)) {
                                zis.closeEntry(); e = zis.nextEntry; continue
                            }
                            dest.parentFile?.mkdirs()
                            FileOutputStream(dest).use { zis.copyTo(it) }
                            zis.closeEntry()
                            e = zis.nextEntry
                        }
                    }
                }
            }
            // Fully authenticated by now: merge the staged tree into the live profile. Overwritten
            // originals are parked in a rollback dir first, so a failure mid-merge (disk full,
            // killed process is still best-effort) can put the previous profile back intact.
            val rollback = File(home.parentFile, home.name + ".rollback-" + System.currentTimeMillis())
            val created = ArrayList<File>()
            try {
                staging.walkTopDown().forEach { f ->
                    if (!f.isFile) return@forEach
                    val rel = f.relativeTo(staging).path
                    val dest = File(home, rel)
                    if (dest.exists()) {
                        val park = File(rollback, rel)
                        park.parentFile?.mkdirs()
                        if (!dest.renameTo(park)) dest.copyTo(park, overwrite = true)
                    } else created.add(dest)
                    dest.parentFile?.mkdirs()
                    f.copyTo(dest, overwrite = true)
                }
            } catch (e: Throwable) {
                // undo: remove newly created files, put parked originals back
                created.forEach { runCatching { it.delete() } }
                rollback.walkTopDown().forEach { f ->
                    if (!f.isFile) return@forEach
                    val dest = File(home, f.relativeTo(rollback).path)
                    runCatching { dest.parentFile?.mkdirs(); f.copyTo(dest, overwrite = true) }
                }
                throw e
            } finally {
                runCatching { rollback.deleteRecursively() }
            }
        } finally {
            try { staging.deleteRecursively() } catch (_: Exception) {}
        }
    }

    /** Creates a timestamped backup and keeps only the newest [keep] auto-backups. */
    fun runAutoBackup(context: Context, uid: String, password: String, keep: Int = 5): File {
        val home = Runtime.home(context, uid)
        val dir = backupDir(context)
        val out = File(dir, "OCM-auto-" + System.currentTimeMillis() + ".ocmbak")
        backupZip(home, out, password)
        try {
            val autos = dir.listFiles { f -> f.name.startsWith("OCM-auto-") && f.name.endsWith(".ocmbak") }
                ?.sortedByDescending { it.lastModified() } ?: emptyList()
            autos.drop(keep).forEach { it.delete() }
        } catch (_: Exception) {}
        return out
    }
}
