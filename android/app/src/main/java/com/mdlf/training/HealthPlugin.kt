package com.mdlf.training

import android.content.Context
import android.content.Intent
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.health.connect.client.units.Energy
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.Instant
import java.time.ZoneId

/**
 * Santé sur Android : Health Connect, équivalent de ios/App/App/HealthPlugin.swift (HealthKit).
 * Côté web : Capacitor.registerPlugin('MdlfHealth') (js/platform/native.js, Native.health) ; mêmes
 * méthodes et mêmes réponses qu'iOS, pour que js/features/apple-services.js n'ait rien à savoir.
 *
 * - Écriture : la séance terminée (ExerciseSessionRecord « musculation ») et son énergie estimée
 *   (ActiveCaloriesBurnedRecord). Lecture : le poids, puis (demandés à part) les courses et sorties vélo
 *   avec leur distance.
 * - Health Connect n'est pas toujours là : intégré au système depuis Android 14, appli à installer
 *   (ou à mettre à jour) avant. [available] est faux tant que getSdkStatus ne dit pas SDK_AVAILABLE.
 * - Autorisations, même sémantique qu'iOS (le web, js/features/apple-services.js, a été écrit pour elle) :
 *   la fenêtre n'est montrée qu'une fois par ensemble (poids et écriture ; courses et vélo), puis plus
 *   jamais, quelle que soit la réponse. Health Connect, lui, remontrerait sa fenêtre tant qu'une
 *   autorisation manque (jusqu'à deux refus) : sans ce souvenir, chaque lancement l'ouvrirait en plein
 *   bilan de séance. Le souvenir (« déjà demandé ») est gardé dans les SharedPreferences [PREFS], hors
 *   sauvegarde Google (data_extraction_rules.xml et backup_rules.xml n'incluent que la copie de la
 *   donnée) : une réinstallation redemande, comme iOS sur une nouvelle installation.
 * - Contrairement à HealthKit, Health Connect dit ce qui est accordé, lecture comprise : le champ
 *   workoutsRead de [requestAuthorization] le dit au web, qui explique alors où autoriser.
 * - Historique : sans la permission READ_HEALTH_DATA_HISTORY (non demandée), Health Connect ne rend que
 *   les 30 jours précédant la première autorisation, puis tout ce qui suit. Le web demande 90 jours de
 *   pesées puis 10 ans s'il n'y a rien : il recevra simplement moins, sans erreur.
 */
@CapacitorPlugin(name = "MdlfHealth")
class HealthPlugin : Plugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    // Écriture : la séance et son énergie. Lecture : le poids ; puis entraînements et distances (course, vélo).
    private val writePermissions = setOf(
        HealthPermission.getWritePermission(ExerciseSessionRecord::class),
        HealthPermission.getWritePermission(ActiveCaloriesBurnedRecord::class),
    )
    private val weightPermissions = setOf(HealthPermission.getReadPermission(WeightRecord::class))
    private val workoutPermissions = setOf(
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
        HealthPermission.getReadPermission(DistanceRecord::class),
    )
    private val sessionWrite = HealthPermission.getWritePermission(ExerciseSessionRecord::class)

    private fun client(): HealthConnectClient? =
        if (HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE)
            HealthConnectClient.getOrCreate(context) else null

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }

    /** Lance un appel suspendu ; toute exception devient un rejet (jamais un plantage de l'app). */
    private fun launchCall(call: PluginCall, block: suspend () -> Unit) {
        scope.launch {
            try { block() } catch (e: Exception) { call.reject(e.message ?: "Health Connect indisponible") }
        }
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        call.resolve(JSObject().put("available", client() != null))
    }

    /**
     * Ouvre la fenêtre d'autorisation de Health Connect pour les ensembles jamais demandés et pas déjà
     * accordés : poids et écriture, plus (workouts, vrai par défaut) la lecture des courses et du vélo.
     * Tout a déjà été demandé : aucune fenêtre, l'état réel est rendu tout de suite (comme iOS).
     * → { available, workouts, workoutsRead } ; workouts : l'écriture des séances est accordée (comme
     * sur iOS) ; workoutsRead (Android seulement) : la lecture des courses et du vélo est accordée.
     */
    @PluginMethod
    fun requestAuthorization(call: PluginCall) {
        val hc = client() ?: run { call.resolve(unavailable()); return }
        val withWorkouts = call.getBoolean("workouts", true) == true
        launchCall(call) {
            val granted = hc.permissionController.getGrantedPermissions()
            val toAsk = (if (asked(KEY_BASE)) emptySet<String>() else writePermissions + weightPermissions) +
                (if (withWorkouts && !asked(KEY_WORKOUTS)) workoutPermissions else emptySet<String>())
            if (granted.containsAll(toAsk)) {   // rien de nouveau à demander (ensemble vide compris)
                call.resolve(answer(granted))
                return@launchCall
            }
            // Contrat officiel de Health Connect, joué par le mécanisme d'activités de Capacitor
            val intent: Intent = PermissionController.createRequestPermissionResultContract()
                .createIntent(context, toAsk)
            startActivityForResult(call, intent, "onPermissionsResult")
        }
    }

    @ActivityCallback
    private fun onPermissionsResult(call: PluginCall?, result: ActivityResult) {
        // Fenêtre montrée (ou refusée d'office par Health Connect après deux refus) : demandé, quelle que
        // soit la réponse. Les deux ensembles ont été proposés ensemble ; ceux déjà demandés restent vrais.
        val editor = prefs().edit().putBoolean(KEY_BASE, true)
        if (call?.getBoolean("workouts", true) == true) editor.putBoolean(KEY_WORKOUTS, true)
        editor.apply()
        call ?: return
        val hc = client() ?: run { call.resolve(unavailable()); return }
        // La réponse de la fenêtre peut être incomplète (fenêtre fermée) : on relit l'état réel
        launchCall(call) { call.resolve(answer(hc.permissionController.getGrantedPermissions())) }
    }

    /**
     * La fenêtre des courses et du vélo reste-t-elle à montrer ? request : "shouldRequest" (jamais
     * demandée et pas accordée), "unnecessary" (déjà demandée, quelle que soit la réponse, ou accordée),
     * "unknown". Même sens qu'iOS ; ne porte que sur les courses et le vélo (le poids et l'écriture sont
     * demandés à l'activation de Santé), et ne montre rien.
     */
    @PluginMethod
    fun authorizationStatus(call: PluginCall) {
        val hc = client() ?: run { call.resolve(JSObject().put("available", false).put("request", "unknown")); return }
        scope.launch {
            val request = try {
                if (asked(KEY_WORKOUTS) || hc.permissionController.getGrantedPermissions().containsAll(workoutPermissions))
                    "unnecessary" else "shouldRequest"
            } catch (e: Exception) { "unknown" }
            call.resolve(JSObject().put("available", true).put("request", request))
        }
    }

    private fun answer(granted: Set<String>) = JSObject()
        .put("available", true)
        .put("workouts", sessionWrite in granted)
        .put("workoutsRead", granted.containsAll(workoutPermissions))

    private fun prefs() = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun asked(key: String) = prefs().getBoolean(key, false)

    /** start / end : millisecondes depuis 1970 ; kcal facultatif (énergie active estimée). */
    @PluginMethod
    fun saveWorkout(call: PluginCall) {
        // Entiers longs côté web (Date.now()) : lus par CallArgs.kt, jamais par getDouble (rendrait null)
        val startMs = call.epochMillis("start")
        val endMs = call.epochMillis("end")
        if (startMs == null || endMs == null || endMs <= startMs) { call.reject("Dates de séance invalides"); return }
        val hc = client() ?: run { call.reject("Health Connect indisponible"); return }
        val start = Instant.ofEpochMilli(startMs)
        val end = Instant.ofEpochMilli(endMs)
        val kcal = call.number("kcal", 0.0).coerceAtLeast(0.0)
        launchCall(call) {
            val granted = hc.permissionController.getGrantedPermissions()
            if (sessionWrite !in granted) { call.reject("Accès à Santé non autorisé"); return@launchCall }
            val zone = ZoneId.systemDefault().rules
            val records = mutableListOf<androidx.health.connect.client.records.Record>(
                ExerciseSessionRecord(
                    startTime = start, startZoneOffset = zone.getOffset(start),
                    endTime = end, endZoneOffset = zone.getOffset(end),
                    exerciseType = ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING,
                    title = "Musculation",
                    // Saisie dans l'app (séries notées à la main), pas mesurée par un capteur. clientRecordId :
                    // la même séance renvoyée (historique envoyé deux fois) ne crée pas de doublon dans Health Connect
                    metadata = Metadata.manualEntry(clientRecordId = "mdlf-session-$startMs"),
                ),
            )
            if (kcal > 0 && HealthPermission.getWritePermission(ActiveCaloriesBurnedRecord::class) in granted) {
                records += ActiveCaloriesBurnedRecord(
                    startTime = start, startZoneOffset = zone.getOffset(start),
                    endTime = end, endZoneOffset = zone.getOffset(end),
                    energy = Energy.kilocalories(kcal),
                    metadata = Metadata.manualEntry(clientRecordId = "mdlf-kcal-$startMs"),
                )
            }
            hc.insertRecords(records)
            call.resolve(JSObject().put("saved", true))
        }
    }

    /** Pesées des `days` derniers jours (90 par défaut), de la plus récente à la plus ancienne, en kg. */
    @PluginMethod
    fun bodyMass(call: PluginCall) {
        val hc = client() ?: run { call.reject("Health Connect indisponible"); return }
        val days = (call.getInt("days") ?: 90).coerceIn(1, 3650)
        launchCall(call) {
            // readRecords lève une SecurityException sans autorisation : le poids refusé donne une liste
            // vide (comme HealthKit sur iOS), pas un échec que l'app proposerait de réessayer sans fin
            val granted = hc.permissionController.getGrantedPermissions()
            if (!granted.containsAll(weightPermissions)) { call.resolve(JSObject().put("samples", JSArray())); return@launchCall }
            val now = Instant.now()
            val response = hc.readRecords(ReadRecordsRequest(
                WeightRecord::class,
                timeRangeFilter = TimeRangeFilter.between(now.minus(Duration.ofDays(days.toLong())), now),
                ascendingOrder = false,
                pageSize = 500,
            ))
            val list = JSArray()
            for (r in response.records) {
                list.put(JSObject().put("date", r.time.toEpochMilli().toDouble()).put("kg", r.weight.inKilograms))
            }
            call.resolve(JSObject().put("samples", list))
        }
    }

    /**
     * Courses et sorties vélo des `days` derniers jours (60 par défaut), de la plus récente à la plus
     * ancienne : mêmes champs qu'iOS. indoor : tapis ou vélo d'appartement. own : écrit par cette app
     * (elle n'écrit que de la musculation : own reste faux, le web écarte quand même ces entraînements).
     * productType : vide (Health Connect ne donne pas le modèle de montre).
     */
    @PluginMethod
    fun workouts(call: PluginCall) {
        val hc = client() ?: run { call.reject("Health Connect indisponible"); return }
        val days = (call.getInt("days") ?: 60).coerceIn(1, 3650)
        launchCall(call) {
            val granted = hc.permissionController.getGrantedPermissions()
            if (!granted.containsAll(workoutPermissions)) { call.resolve(JSObject().put("workouts", JSArray())); return@launchCall }
            val now = Instant.now()
            val response = hc.readRecords(ReadRecordsRequest(
                ExerciseSessionRecord::class,
                timeRangeFilter = TimeRangeFilter.between(now.minus(Duration.ofDays(days.toLong())), now),
                ascendingOrder = false,
                pageSize = 300,
            ))
            val list = JSArray()
            for (s in response.records) {
                val activity = ACTIVITIES[s.exerciseType] ?: continue
                // Distance : total des DistanceRecord pendant la séance (dédoublonné par Health Connect)
                val km = try {
                    hc.aggregate(AggregateRequest(
                        metrics = setOf(DistanceRecord.DISTANCE_TOTAL),
                        timeRangeFilter = TimeRangeFilter.between(s.startTime, s.endTime),
                    ))[DistanceRecord.DISTANCE_TOTAL]?.inKilometers ?: 0.0
                } catch (e: Exception) { 0.0 }
                val origin = s.metadata.dataOrigin.packageName
                list.put(JSObject()
                    .put("id", s.metadata.id)
                    .put("activity", activity)
                    .put("start", s.startTime.toEpochMilli().toDouble())
                    .put("end", s.endTime.toEpochMilli().toDouble())
                    .put("duration", Duration.between(s.startTime, s.endTime).seconds.toDouble())
                    .put("km", km)
                    .put("source", appLabel(origin))
                    .put("productType", "")
                    .put("indoor", s.exerciseType in INDOOR)
                    .put("own", origin == context.packageName))
            }
            call.resolve(JSObject().put("workouts", list))
        }
    }

    private fun unavailable() = JSObject().put("available", false).put("workouts", false)

    /** Nom affichable de l'app qui a écrit l'entraînement (Strava, Samsung Health…), sinon son paquet. */
    private fun appLabel(pkg: String): String = try {
        val pm = context.packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (e: Exception) { pkg }

    private companion object {
        // « Déjà demandé » par ensemble d'autorisations (voir la note en tête de classe)
        const val PREFS = "mdlf_health"
        const val KEY_BASE = "asked_base"          // poids et écriture des séances
        const val KEY_WORKOUTS = "asked_workouts"  // lecture des courses et du vélo
        val ACTIVITIES = mapOf(
            ExerciseSessionRecord.EXERCISE_TYPE_RUNNING to "running",
            ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL to "running",
            ExerciseSessionRecord.EXERCISE_TYPE_BIKING to "cycling",
            ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY to "cycling",
        )
        val INDOOR = setOf(
            ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL,
            ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY,
        )
    }
}
