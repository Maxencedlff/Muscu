import Foundation
import Capacitor
import HealthKit

/// Apple Santé : enregistre une séance terminée comme entraînement « Musculation » (et son cardio de
/// machines dans son propre type : course, marche, vélo, elliptique, rameur, escaliers), lit le poids
/// corporel, les courses et sorties vélo (Apple Watch, Strava…) et le sommeil.
/// Côté web : Capacitor.registerPlugin('MdlfHealth').
@objc(HealthPlugin)
public class HealthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthPlugin"
    public let jsName = "MdlfHealth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authorizationStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveWorkouts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sleep", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "bodyMass", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "workouts", returnType: CAPPluginReturnPromise),
    ]

    private let store = HKHealthStore()
    private var workoutType: HKWorkoutType { HKObjectType.workoutType() }
    private var energyType: HKQuantityType { HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)! }
    private var bodyMassType: HKQuantityType { HKObjectType.quantityType(forIdentifier: .bodyMass)! }
    private var runDistanceType: HKQuantityType { HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning)! }
    private var cycleDistanceType: HKQuantityType { HKObjectType.quantityType(forIdentifier: .distanceCycling)! }
    private var sleepType: HKCategoryType { HKObjectType.categoryType(forIdentifier: .sleepAnalysis)! }
    /// Distance du rameur : type apparu avec iOS 18 (l'app vise iOS 16.4) ; absent avant, rien n'est écrit
    private var rowDistanceType: HKQuantityType? {
        if #available(iOS 18.0, *) { return HKObjectType.quantityType(forIdentifier: .distanceRowing) }
        return nil
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    // Écriture : la séance de musculation et son énergie. Lecture : le poids, puis (demandés à part) les
    // entraînements et leurs distances pour les courses et sorties vélo, et le sommeil.
    // Écriture des distances (tapis, vélo, rameur) : demandée avec la lecture des courses et du sommeil
    // (jamais au lancement, voir requestAuthorization).
    private var shareTypes: Set<HKSampleType> { [workoutType, energyType] }
    private var distanceShareTypes: Set<HKSampleType> {
        var set: Set<HKSampleType> = [runDistanceType, cycleDistanceType]
        if let row = rowDistanceType { set.insert(row) }
        return set
    }
    private var weightReadTypes: Set<HKObjectType> { [bodyMassType] }
    private var workoutReadTypes: Set<HKObjectType> { [workoutType, runDistanceType, cycleDistanceType] }
    private var sleepReadTypes: Set<HKObjectType> { [sleepType] }

    /// Demande l'autorisation d'écrire les entraînements (et leur énergie) et de lire le poids ; avec
    /// workouts (vrai par défaut), aussi celle de lire les entraînements et leurs distances (course, vélo) et
    /// le sommeil, et d'écrire les distances du cardio. iOS ne redemande que les types jamais demandés :
    /// workouts: false n'ouvre pas la fenêtre pour une installation qui a déjà répondu pour le poids et
    /// l'écriture, même si le reste n'a jamais été demandé (c'est l'appel fait au lancement).
    /// iOS ne dit pas si la lecture a été accordée (confidentialité) : seul l'état de l'écriture est renvoyé.
    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["available": false, "workouts": false]); return
        }
        let all = call.getBool("workouts") ?? true
        let read = all ? weightReadTypes.union(workoutReadTypes).union(sleepReadTypes) : weightReadTypes
        let share = all ? shareTypes.union(distanceShareTypes) : shareTypes
        store.requestAuthorization(toShare: share, read: read) { _, error in
            if let error = error { call.reject(error.localizedDescription); return }
            let status = self.store.authorizationStatus(for: self.workoutType)
            call.resolve(["available": true, "workouts": status == .sharingAuthorized])
        }
    }

    /// La fenêtre d'autorisation reste-t-elle à montrer ? Deux réponses indépendantes, sans rien afficher :
    ///   request : poids, écriture des séances, courses et vélo (l'ensemble d'avant la build du 31/10/2026 :
    ///             sa réponse ne change pas pour qui l'avait déjà accordé) ;
    ///   extra   : sommeil et écriture des distances du cardio (arrivés avec cette build).
    /// Valeurs : "shouldRequest" (au moins un type jamais demandé), "unnecessary" (tout a déjà été demandé,
    /// quelle que soit la réponse), "unknown".
    @objc func authorizationStatus(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["available": false, "request": "unknown", "extra": "unknown"]); return
        }
        func name(_ status: HKAuthorizationRequestStatus, _ error: Error?) -> String {
            guard error == nil else { return "unknown" }
            switch status {
            case .shouldRequest: return "shouldRequest"
            case .unnecessary: return "unnecessary"
            default: return "unknown"
            }
        }
        store.getRequestStatusForAuthorization(toShare: shareTypes, read: weightReadTypes.union(workoutReadTypes)) { status, error in
            let request = name(status, error)
            self.store.getRequestStatusForAuthorization(toShare: self.distanceShareTypes, read: self.sleepReadTypes) { status2, error2 in
                call.resolve(["available": true, "request": request, "extra": name(status2, error2)])
            }
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

    // ── Séance détaillée (build qui suit le 31/10/2026) ──────────────────────────────

    /// Entraînements d'une séance, découpés par le web (js/data/health-export.js), écrits l'un après l'autre :
    ///   id : identifiant de la séance ; workouts : [{ activity, start, end (ms), pauses: [[début, fin]…],
    ///   kcal, km, indoor, part }]. activity : traditionalStrengthTraining, running, walking, cycling,
    ///   elliptical, rowing, stairClimbing. Chaque entraînement porte un identifiant de synchro de Santé
    ///   (mdlf:<id>:<part>) et une version (secondes depuis 1970) : renvoyer une séance remplace ses
    ///   entraînements au lieu de les dupliquer. Distance écrite seulement si son écriture est autorisée.
    ///   → { saved: nombre écrit, total }
    @objc func saveWorkouts(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.isEmpty, id.count <= 64 else {
            call.reject("Séance sans identifiant"); return
        }
        let list = call.getArray("workouts", JSObject.self) ?? []
        guard !list.isEmpty, list.count <= 20 else { call.reject("Aucun entraînement à écrire"); return }
        guard store.authorizationStatus(for: workoutType) == .sharingAuthorized else {
            call.reject("Accès à Santé non autorisé"); return
        }
        let version = Int(Date().timeIntervalSince1970)
        var saved = 0
        // Écritures en chaîne : jamais deux HKWorkoutBuilder en même temps pour la même séance
        func next(_ i: Int) {
            guard i < list.count else { call.resolve(["saved": saved, "total": list.count]); return }
            saveOne(list[i], sessionId: id, version: version) { ok in
                if ok { saved += 1 }
                next(i + 1)
            }
        }
        next(0)
    }

    private static func number(_ v: JSValue?) -> Double? {
        if let n = v as? NSNumber { return n.doubleValue }
        return v as? Double
    }

    private static func activityType(_ name: String) -> HKWorkoutActivityType? {
        switch name {
        case "traditionalStrengthTraining": return .traditionalStrengthTraining
        case "running": return .running
        case "walking": return .walking
        case "cycling": return .cycling
        case "elliptical": return .elliptical
        case "rowing": return .rowing
        case "stairClimbing": return .stairClimbing
        default: return nil
        }
    }

    private func distanceType(for activity: HKWorkoutActivityType) -> HKQuantityType? {
        switch activity {
        case .running, .walking: return runDistanceType
        case .cycling: return cycleDistanceType
        case .rowing: return rowDistanceType
        default: return nil
        }
    }

    /// Intervalles actifs d'un entraînement : de start à end, moins les pauses (triées, bornées)
    private static func activeSegments(start: Date, end: Date, pauses: [(Date, Date)]) -> [(Date, Date)] {
        var segments: [(Date, Date)] = []
        var cursor = start
        for (ps, pe) in pauses.sorted(by: { $0.0 < $1.0 }) {
            let s = max(ps, cursor), e = min(pe, end)
            guard e > s else { continue }
            if s > cursor { segments.append((cursor, s)) }
            cursor = e
        }
        if end > cursor { segments.append((cursor, end)) }
        return segments
    }

    /// Une quantité répartie sur les intervalles actifs, au prorata de leur durée (énergie, distance)
    private static func spread(_ type: HKQuantityType, unit: HKUnit, total: Double,
                               over segments: [(Date, Date)]) -> [HKQuantitySample] {
        let span = segments.reduce(0.0) { $0 + $1.1.timeIntervalSince($1.0) }
        guard total > 0, span > 0 else { return [] }
        return segments.map { seg in
            let part = total * seg.1.timeIntervalSince(seg.0) / span
            return HKQuantitySample(type: type, quantity: HKQuantity(unit: unit, doubleValue: part), start: seg.0, end: seg.1)
        }
    }

    private func saveOne(_ w: JSObject, sessionId: String, version: Int, completion: @escaping (Bool) -> Void) {
        guard let activity = Self.activityType(w["activity"] as? String ?? ""),
              let startMs = Self.number(w["start"]), let endMs = Self.number(w["end"]), endMs > startMs,
              endMs - startMs <= 24 * 3_600_000 else { completion(false); return }
        let start = Date(timeIntervalSince1970: startMs / 1000)
        let end = Date(timeIntervalSince1970: endMs / 1000)
        let pauses: [(Date, Date)] = ((w["pauses"] as? [JSValue]) ?? []).compactMap { p in
            guard let pair = p as? [JSValue], pair.count == 2,
                  let a = Self.number(pair[0]), let b = Self.number(pair[1]), b > a else { return nil }
            return (Date(timeIntervalSince1970: a / 1000), Date(timeIntervalSince1970: b / 1000))
        }
        let segments = Self.activeSegments(start: start, end: end, pauses: pauses)
        guard !segments.isEmpty else { completion(false); return }
        let kcal = Self.number(w["kcal"]) ?? 0
        let km = Self.number(w["km"]) ?? 0
        let part = Int(Self.number(w["part"]) ?? 0)
        let indoor = (w["indoor"] as? Bool) ?? true

        let config = HKWorkoutConfiguration()
        config.activityType = activity
        config.locationType = indoor ? .indoor : .outdoor
        let builder = HKWorkoutBuilder(healthStore: store, configuration: config, device: .local())

        let energy = store.authorizationStatus(for: energyType) == .sharingAuthorized
            ? Self.spread(energyType, unit: .kilocalorie(), total: kcal, over: segments) : []
        var distance: [HKQuantitySample] = []
        if let dType = distanceType(for: activity), store.authorizationStatus(for: dType) == .sharingAuthorized {
            distance = Self.spread(dType, unit: .meterUnit(with: .kilo), total: km, over: segments)
        }
        let samples: [HKSample] = energy + distance
        // Pause et reprise datées : Santé calcule lui-même la durée active (sans les pauses)
        var events: [HKWorkoutEvent] = []
        for (s, e) in pauses where s > start && e < end && e > s {
            events.append(HKWorkoutEvent(type: .pause, dateInterval: DateInterval(start: s, duration: 0), metadata: nil))
            events.append(HKWorkoutEvent(type: .resume, dateInterval: DateInterval(start: e, duration: 0), metadata: nil))
        }
        let metadata: [String: Any] = [
            HKMetadataKeyIndoorWorkout: NSNumber(value: indoor),
            HKMetadataKeySyncIdentifier: "mdlf:\(sessionId):\(part)" as NSString,
            HKMetadataKeySyncVersion: NSNumber(value: version),
        ]

        builder.beginCollection(withStart: start) { ok, _ in
            guard ok else { completion(false); return }
            let finish = {
                builder.endCollection(withEnd: end) { ok, _ in
                    guard ok else { completion(false); return }
                    builder.finishWorkout { workout, _ in completion(workout != nil) }
                }
            }
            // Métadonnées, pauses puis échantillons ; un échec de l'un n'empêche pas l'entraînement
            builder.addMetadata(metadata) { _, _ in
                let addSamples = {
                    guard !samples.isEmpty else { finish(); return }
                    builder.add(samples) { _, _ in finish() }
                }
                guard !events.isEmpty else { addSamples(); return }
                builder.addWorkoutEvents(events) { _, _ in addSamples() }
            }
        }
    }

    // ── Sommeil ──────────────────────────────────────────────────────────────────────

    /// Échantillons de sommeil des `days` dernières nuits (8 par défaut, 31 au plus), du plus ancien au plus
    /// récent : start / end en millisecondes depuis 1970, stage : inBed, asleep (sans phase), core, deep,
    /// rem, awake. iOS ne dit pas si la lecture est refusée : liste vide dans ce cas.
    @objc func sleep(_ call: CAPPluginCall) {
        let days = min(31, max(1, call.getInt("days") ?? 8))
        let since = Calendar.current.date(byAdding: .day, value: -days, to: Date()) ?? Date()
        let predicate = HKQuery.predicateForSamples(withStart: since, end: nil, options: [])
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        let query = HKSampleQuery(sampleType: sleepType, predicate: predicate, limit: 2000, sortDescriptors: [sort]) { _, samples, error in
            if let error = error { call.reject(error.localizedDescription); return }
            let list: [[String: Any]] = (samples as? [HKCategorySample] ?? []).compactMap { x in
                guard let stage = Self.sleepStage(x.value) else { return nil }
                return ["start": x.startDate.timeIntervalSince1970 * 1000,
                        "end": x.endDate.timeIntervalSince1970 * 1000,
                        "stage": stage]
            }
            call.resolve(["samples": list])
        }
        store.execute(query)
    }

    /// Valeur HKCategoryValueSleepAnalysis → nom du web ; inconnue (valeur d'un iOS futur) : ignorée
    private static func sleepStage(_ value: Int) -> String? {
        guard let v = HKCategoryValueSleepAnalysis(rawValue: value) else { return nil }
        switch v {
        case .inBed: return "inBed"
        case .awake: return "awake"
        case .asleepUnspecified: return "asleep"
        case .asleepCore: return "core"
        case .asleepDeep: return "deep"
        case .asleepREM: return "rem"
        @unknown default: return nil
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
    /// indoor : tapis ou vélo d'appartement. own : écrit par MDLF Training. Depuis saveWorkouts, l'app écrit
    /// aussi des courses et du vélo (cardio de machines) : le web écarte ces entraînements (own), sinon ils
    /// compteraient deux fois (séance de l'historique et ligne de Santé).
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
