import Foundation
import Capacitor
import HealthKit

/// Apple Santé : enregistre une séance terminée comme entraînement « Musculation »,
/// lit le poids corporel et les courses et sorties vélo (Apple Watch, Strava…).
/// Côté web : Capacitor.registerPlugin('MdlfHealth').
@objc(HealthPlugin)
public class HealthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthPlugin"
    public let jsName = "MdlfHealth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "bodyMass", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "workouts", returnType: CAPPluginReturnPromise),
    ]

    private let store = HKHealthStore()
    private var workoutType: HKWorkoutType { HKObjectType.workoutType() }
    private var energyType: HKQuantityType { HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)! }
    private var bodyMassType: HKQuantityType { HKObjectType.quantityType(forIdentifier: .bodyMass)! }
    private var runDistanceType: HKQuantityType { HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning)! }
    private var cycleDistanceType: HKQuantityType { HKObjectType.quantityType(forIdentifier: .distanceCycling)! }

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    /// Demande l'autorisation d'écrire les entraînements (et leur énergie) et de lire le poids, les
    /// entraînements et leurs distances (course, vélo). iOS ne redemande que les types jamais demandés.
    /// iOS ne dit pas si la lecture a été accordée (confidentialité) : seul l'état de l'écriture est renvoyé.
    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["available": false, "workouts": false]); return
        }
        store.requestAuthorization(toShare: [workoutType, energyType], read: [bodyMassType, workoutType, runDistanceType, cycleDistanceType]) { _, error in
            if let error = error { call.reject(error.localizedDescription); return }
            let status = self.store.authorizationStatus(for: self.workoutType)
            call.resolve(["available": true, "workouts": status == .sharingAuthorized])
        }
    }

    /// start / end : millisecondes depuis 1970 ; kcal facultatif (énergie active estimée).
    @objc func saveWorkout(_ call: CAPPluginCall) {
        guard let startMs = call.getDouble("start"), let endMs = call.getDouble("end"), endMs > startMs else {
            call.reject("Dates de séance invalides"); return
        }
        guard store.authorizationStatus(for: workoutType) == .sharingAuthorized else {
            call.reject("Accès à Santé non autorisé"); return
        }
        let start = Date(timeIntervalSince1970: startMs / 1000)
        let end = Date(timeIntervalSince1970: endMs / 1000)
        let kcal = call.getDouble("kcal") ?? 0

        let config = HKWorkoutConfiguration()
        config.activityType = .traditionalStrengthTraining
        config.locationType = .indoor
        let builder = HKWorkoutBuilder(healthStore: store, configuration: config, device: .local())

        builder.beginCollection(withStart: start) { ok, error in
            guard ok else { call.reject(error?.localizedDescription ?? "Début de collecte refusé"); return }
            let finish = {
                builder.endCollection(withEnd: end) { ok, error in
                    guard ok else { call.reject(error?.localizedDescription ?? "Fin de collecte refusée"); return }
                    builder.finishWorkout { workout, error in
                        if let error = error { call.reject(error.localizedDescription); return }
                        call.resolve(["saved": workout != nil])
                    }
                }
            }
            guard kcal > 0 else { finish(); return }
            let energy = HKQuantitySample(type: self.energyType,
                                          quantity: HKQuantity(unit: .kilocalorie(), doubleValue: kcal),
                                          start: start, end: end)
            builder.add([energy]) { _, _ in finish() }
        }
    }

    /// Pesées des `days` derniers jours (90 par défaut), de la plus récente à la plus ancienne, en kg.
    @objc func bodyMass(_ call: CAPPluginCall) {
        let days = call.getInt("days") ?? 90
        let since = Calendar.current.date(byAdding: .day, value: -days, to: Date()) ?? Date()
        let predicate = HKQuery.predicateForSamples(withStart: since, end: nil, options: [])
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
        let query = HKSampleQuery(sampleType: bodyMassType, predicate: predicate, limit: 500, sortDescriptors: [sort]) { _, samples, error in
            if let error = error { call.reject(error.localizedDescription); return }
            let kg = HKUnit.gramUnit(with: .kilo)
            let list: [[String: Any]] = (samples as? [HKQuantitySample] ?? []).map {
                ["date": $0.startDate.timeIntervalSince1970 * 1000, "kg": $0.quantity.doubleValue(for: kg)]
            }
            call.resolve(["samples": list])
        }
        store.execute(query)
    }

    /// Courses et sorties vélo des `days` derniers jours (60 par défaut), de la plus récente à la plus
    /// ancienne. start / end en millisecondes depuis 1970, duration en secondes, km (0 si inconnue).
    /// indoor : tapis ou vélo d'appartement. own : écrit par MDLF Training. La requête ne lit que .running et
    /// .cycling et l'app n'écrit que .traditionalStrengthTraining : own reste faux aujourd'hui ; le web écarte
    /// quand même ces entraînements, au cas où l'app écrirait un jour du cardio (il compterait deux fois).
    @objc func workouts(_ call: CAPPluginCall) {
        let days = call.getInt("days") ?? 60
        let since = Calendar.current.date(byAdding: .day, value: -days, to: Date()) ?? Date()
        let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
            HKQuery.predicateForSamples(withStart: since, end: nil, options: []),
            NSCompoundPredicate(orPredicateWithSubpredicates: [
                HKQuery.predicateForWorkouts(with: .running),
                HKQuery.predicateForWorkouts(with: .cycling),
            ]),
        ])
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
        let ownBundle = Bundle.main.bundleIdentifier
        let query = HKSampleQuery(sampleType: workoutType, predicate: predicate, limit: 300, sortDescriptors: [sort]) { _, samples, error in
            if let error = error { call.reject(error.localizedDescription); return }
            let km = HKUnit.meterUnit(with: .kilo)
            let list: [[String: Any]] = (samples as? [HKWorkout] ?? []).map { w -> [String: Any] in
                let running = w.workoutActivityType == .running
                // Distance : statistiques de l'entraînement (iOS 16), sinon le total des anciens entraînements
                let distance = w.statistics(for: running ? self.runDistanceType : self.cycleDistanceType)?.sumQuantity() ?? w.totalDistance
                let source = w.sourceRevision.source
                return [
                    "id": w.uuid.uuidString,
                    "activity": running ? "running" : "cycling",
                    "start": w.startDate.timeIntervalSince1970 * 1000,
                    "end": w.endDate.timeIntervalSince1970 * 1000,
                    "duration": w.duration,
                    "km": distance?.doubleValue(for: km) ?? 0,
                    "source": source.name,
                    "productType": w.sourceRevision.productType ?? "",
                    "indoor": (w.metadata?[HKMetadataKeyIndoorWorkout] as? Bool) ?? false,
                    "own": source.bundleIdentifier == ownBundle,
                ]
            }
            call.resolve(["workouts": list])
        }
        store.execute(query)
    }
}
