package com.mdlf.training

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Repos en cours hors de l'app, équivalent Android de la Live Activity d'iOS
 * (ios/App/App/LiveActivityPlugin.swift). Côté web : Capacitor.registerPlugin('MdlfLiveActivity'),
 * mêmes méthodes start / update / end et mêmes données (js/features/rest-activity.js).
 *
 * Android n'a pas de Live Activity : c'est une **notification continue** avec un compte à rebours
 * dessiné par le système (setUsesChronometer + setChronometerCountDown), visible sur l'écran verrouillé
 * et dans le volet, qui avance seule même app en arrière-plan ou suspendue.
 *
 * - **Silencieuse** (canal d'importance basse, setOnlyAlertOnce) : la sonnerie de fin de repos reste la
 *   notification de @capacitor/local-notifications programmée par Native.scheduleRestEnd.
 * - **Retirée seule** à la fin du repos (setTimeoutAfter) : même app tuée, rien ne reste affiché, alors
 *   qu'iOS montre « C'est reparti » (pas d'équivalent simple ici : la notification de fin le dit déjà).
 * - **Autorisation** : POST_NOTIFICATIONS (Android 13+) est demandée par le web au premier repos
 *   (Native.scheduleRestEnd). Refusée : start répond started: false, le repos continue sans.
 * - Une seule notification à la fois (même identifiant) : start remplace, update met à jour, end retire.
 *
 * Plus tard (Android 16, « Live Updates ») : la même notification pourra être mise en avant en haut de
 * l'écran avec Notification.ProgressStyle et setRequestPromotedOngoing ; non fait ici (docs/ANDROID.md).
 */
@CapacitorPlugin(name = "MdlfLiveActivity")
class LiveActivityPlugin : Plugin() {

    override fun load() {
        createChannel(context)
        // Repos d'un lancement précédent (app tuée) : setTimeoutAfter l'a normalement déjà retiré
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    }

    @PluginMethod
    fun start(call: PluginCall) = show(call, "started")

    /** Nouvelle heure de fin ou nouvelle série suivante (±15 s, autre durée) */
    @PluginMethod
    fun update(call: PluginCall) = show(call, "updated")

    /** Fin du repos (terminé, passé, annulé) : retirée tout de suite. */
    @PluginMethod
    fun end(call: PluginCall) {
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
        call.resolve()
    }

    private fun show(call: PluginCall, key: String) {
        val endMs = call.getDouble("endTime")
        if (endMs == null || endMs <= 0) { call.reject("Repos invalide"); return }
        val remaining = endMs.toLong() - System.currentTimeMillis()
        val manager = NotificationManagerCompat.from(context)
        if (remaining <= 0 || !manager.areNotificationsEnabled()) {
            manager.cancel(NOTIFICATION_ID)
            call.resolve(JSObject().put(key, false))
            return
        }
        val effort = call.getString("phase") == "effort"
        val session = (call.getString("title") ?: "Séance").take(40)
        val title = if (effort) (call.getString("label") ?: "Effort").take(60) else "Repos · $session"
        val next = call.getObject("next")
        val text = next?.getString("exercise")?.let { exercise ->
            val load = next.getString("load").orEmpty().take(30)
            val set = next.optInt("set", 1)
            listOf(exercise.take(60), "série $set", load).filter { it.isNotEmpty() }.joinToString(" · ")
        }

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_mdlf)
            .setColor(tint(call.getString("color")))
            .setContentTitle(title)
            .setContentText(text)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(true)
            .setWhen(endMs.toLong())
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setTimeoutAfter(remaining + 1_000)
            .setContentIntent(openApp())
            .build()
        try {
            manager.notify(NOTIFICATION_ID, notification)
            call.resolve(JSObject().put(key, true))
        } catch (e: SecurityException) {
            // Autorisation retirée entre la vérification et l'envoi
            call.resolve(JSObject().put(key, false).put("reason", "notifications"))
        }
    }

    /** Toucher la notification rouvre l'app là où elle était (singleTask, aucune donnée transmise). */
    private fun openApp(): PendingIntent? {
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** Couleur de la séance (même liste de noms que l'extension iOS RestActivity), orange de la marque sinon. */
    private fun tint(name: String?): Int = TINTS[name] ?: TINTS.getValue("orange")

    companion object {
        private const val CHANNEL_ID = "mdlf_rest"
        private const val NOTIFICATION_ID = 4201

        // Couleurs système d'iOS (clair), comme le dessin de la Live Activity
        private val TINTS = mapOf(
            "orange" to 0xFFFF9500.toInt(), "red" to 0xFFFF3B30.toInt(), "pink" to 0xFFFF2D55.toInt(),
            "purple" to 0xFFAF52DE.toInt(), "indigo" to 0xFF5856D6.toInt(), "blue" to 0xFF007AFF.toInt(),
            "teal" to 0xFF30B0C7.toInt(), "green" to 0xFF34C759.toInt(), "yellow" to 0xFFFFCC00.toInt(),
        )

        // Canaux : Android 8 (API 26) et suivants, c'est-à-dire tous les téléphones visés (minSdk 26)
        fun createChannel(context: Context) {
            val channel = NotificationChannel(CHANNEL_ID, "Repos en cours", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Compte à rebours du repos entre deux séries"
                setShowBadge(false)
            }
            context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
        }
    }
}
