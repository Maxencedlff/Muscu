import Foundation
import Capacitor
import HealthKit

/// Apple Santé : enregistre une séance terminée comme entraînement « Musculation »
/// et lit le poids corporel. Côté web : Capacitor.registerPlugin('MdlfHealth').
@objc(HealthPlugin)
public class HealthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthPlugin"
    public let jsName = "MdlfHealth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "bodyMass", returnType: CAPPluginReturnPromise),
    ]

    private let store = HKHealthStore()
    private var workoutType: HKWorkoutType { HKObjectType.workoutType() }
    private var energyType: HKQuantityType { HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)! }
    private var bodyMassType: HKQuantityType { HKObjectType.quantityType(forIdentifier: .bodyMass)! }

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    /// Demande l'autorisation d'écrire les entraînements (et leur énergie) et de lire le poids.
    /// iOS ne dit pas si la lecture a été accordée (confidentialité) : seul l'état de l'écriture est renvoyé.
    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["available": false, "workouts": false]); return
        }
        store.requestAuthorization(toShare: [workoutType, energyType], read: [bodyMassType]) { _, error in
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
}
