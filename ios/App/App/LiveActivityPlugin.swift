import Foundation
import UIKit
import Capacitor
import ActivityKit

/// Live Activity du repos : compte à rebours sur l'écran verrouillé et dans la Dynamic Island.
/// Côté web : Capacitor.registerPlugin('MdlfLiveActivity') (js/platform/native.js), appelé par
/// js/features/rest-activity.js au début du repos, à ±15 s et à la fin. Dessin : extension RestActivity.
///
/// Apple (ActivityKit, « Displaying live data with Live Activities ») : une Live Activity se
/// démarre app au premier plan, se met à jour avec ActivityContent et se termine dès que la tâche
/// est finie. staleDate = fin du repos : l'extension affiche alors « C'est reparti », même si l'app
/// est suspendue et n'a rien pu envoyer.
///
/// App tuée pendant un repos : rien ne termine la Live Activity côté serveur (pas de push), et iOS
/// la garderait jusqu'à 8 h, puis 4 h de plus sur l'écran verrouillé. Elle est donc terminée à la
/// réception de UIApplication.willTerminateNotification. Limite : une app suspendue puis tuée par
/// le système ne reçoit aucun signal ; l'extension affiche alors depuis quand le repos est fini.
@objc(LiveActivityPlugin)
public final class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "MdlfLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
    ]

    private typealias RestActivity = Activity<RestActivityAttributes>

    /// Les appels arrivent sans attendre la fin du précédent (début puis +15 s aussitôt) :
    /// chaque opération attend la précédente, dans l'ordre d'arrivée.
    private var lastOperation: Task<Void, Never>?
    private let lock = NSLock()
    private var terminateObserver: NSObjectProtocol?

    private func enqueue(_ operation: @escaping () async -> Void) {
        lock.lock(); defer { lock.unlock() }
        let previous = lastOperation
        lastOperation = Task {
            await previous?.value
            await operation()
        }
    }

    override public func load() {
        // Repos fini pendant que l'app était fermée : sa Live Activity n'a plus lieu d'être
        enqueue { await Self.endAll(where: { $0.content.state.endDate <= Date() }) }
        observeTermination()
        #if DEBUG
        startDemoIfRequested()
        #endif
    }

    /// App tuée au premier plan ou en arrière-plan actif (balayage dans le sélecteur d'apps) :
    /// iOS laisse quelques secondes au plus après willTerminate (UIKit, « applicationWillTerminate »).
    /// Les Live Activities sont terminées de façon synchrone, avec 1 s au maximum, pour ne pas
    /// laisser « C'est reparti » des heures sur l'écran verrouillé. queue: nil : le bloc s'exécute
    /// tout de suite sur le fil qui poste la notification (Foundation, NotificationCenter). La tâche
    /// est détachée pour ne pas attendre le fil principal, bloqué par le sémaphore.
    private func observeTermination() {
        terminateObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.willTerminateNotification, object: nil, queue: nil
        ) { _ in
            let done = DispatchSemaphore(value: 0)
            Task.detached {
                await LiveActivityPlugin.endAll(where: { _ in true })
                done.signal()
            }
            _ = done.wait(timeout: .now() + 1)
        }
    }

    /// Démarre la Live Activity du repos. Une Live Activity de la même séance déjà affichée
    /// (séance restaurée, page rechargée) est mise à jour au lieu d'être recréée.
    @objc func start(_ call: CAPPluginCall) {
        guard let state = Self.contentState(call) else { call.reject("Repos invalide"); return }
        let attributes = RestActivityAttributes(
            sessionTitle: String((call.getString("title") ?? "Séance").prefix(40)),
            tint: call.getString("color") ?? "indigo")
        enqueue {
            let current = Self.liveActivities
            if let same = current.first(where: { Self.sameSession($0.attributes, attributes) }) {
                await Self.endAll(where: { $0.id != same.id })
                await same.update(Self.content(state))
                call.resolve(["started": true, "id": same.id])
                return
            }
            await Self.endAll(where: { _ in true })
            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                call.resolve(["started": false]); return
            }
            do {
                let activity = try RestActivity.request(attributes: attributes, content: Self.content(state), pushType: nil)
                call.resolve(["started": true, "id": activity.id])
            } catch {
                // Limite de Live Activities atteinte, app en arrière-plan… : le repos continue sans
                call.resolve(["started": false, "reason": error.localizedDescription])
            }
        }
    }

    /// Nouvelle heure de fin ou nouvelle série suivante (±15 s, autre durée)
    @objc func update(_ call: CAPPluginCall) {
        guard let state = Self.contentState(call) else { call.reject("Repos invalide"); return }
        enqueue {
            let current = Self.liveActivities
            for activity in current { await activity.update(Self.content(state)) }
            call.resolve(["updated": !current.isEmpty])
        }
    }

    /// Fin du repos (terminé, passé, annulé) : retirée tout de suite de l'écran verrouillé
    /// et de la Dynamic Island, l'app étant de toute façon déjà à l'écran ou sur le point de l'être.
    @objc func end(_ call: CAPPluginCall) {
        enqueue {
            await Self.endAll(where: { _ in true })
            call.resolve()
        }
    }

    // MARK: - Données

    /// endTime (ms depuis 1970), total (s), next { exercise, set, load } facultatif
    private static func contentState(_ call: CAPPluginCall) -> RestActivityAttributes.ContentState? {
        guard let endMs = call.getDouble("endTime"), endMs > 0 else { return nil }
        let total = max(1, call.getInt("total") ?? 90)
        var next: RestActivityAttributes.NextSet?
        if let n = call.getObject("next"), let exercise = n["exercise"] as? String {
            next = RestActivityAttributes.NextSet(
                exercise: String(exercise.prefix(60)),
                set: (n["set"] as? NSNumber)?.intValue ?? 1,
                load: String(((n["load"] as? String) ?? "").prefix(30)))
        }
        let phase = call.getString("phase") == "effort" ? "effort" : nil
        let label = call.getString("label").map { String($0.prefix(60)) }
        return .init(endDate: Date(timeIntervalSince1970: endMs / 1000), totalSeconds: total, next: next,
                     phase: phase, label: phase == nil ? nil : label)
    }

    /// staleDate = fin du repos : passé cette heure, l'extension montre que le repos est terminé
    private static func content(_ state: RestActivityAttributes.ContentState) -> ActivityContent<RestActivityAttributes.ContentState> {
        ActivityContent(state: state, staleDate: state.endDate)
    }

    private static func sameSession(_ a: RestActivityAttributes, _ b: RestActivityAttributes) -> Bool {
        a.sessionTitle == b.sessionTitle && a.tint == b.tint
    }

    /// Activités encore affichées. Juste après end(…, .immediate), une activité terminée peut rester
    /// listée un instant dans Activity.activities (ActivityKit, « activityState ») : elle ne doit
    /// pas être prise pour la Live Activity de la séance, sinon le nouveau repos s'afficherait sans.
    private static var liveActivities: [RestActivity] {
        RestActivity.activities.filter { $0.activityState == .active || $0.activityState == .stale }
    }

    private static func endAll(where predicate: (RestActivity) -> Bool) async {
        for activity in liveActivities where predicate(activity) {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    // MARK: - Démonstration (Debug seulement)

    #if DEBUG
    /// `-MDLFDemoRestActivity` au lancement (CI : xcrun simctl launch … -MDLFDemoRestActivity) :
    /// démarre un repos factice (55 s restantes sur 90) pour photographier la Live Activity sur le
    /// simulateur, puis, 22 s plus tard (app passée en arrière-plan), envoie une mise à jour avec
    /// alerte : iOS montre alors la présentation étendue de la Dynamic Island. Une fois le repos
    /// fini, l'écran verrouillé montre « C'est reparti ». Le démarrage attend que l'app soit au
    /// premier plan, condition d'ActivityKit.
    private var demoObserver: NSObjectProtocol?

    private func startDemoIfRequested() {
        guard ProcessInfo.processInfo.arguments.contains("-MDLFDemoRestActivity") else { return }
        demoObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            guard let self = self, let observer = self.demoObserver else { return }
            NotificationCenter.default.removeObserver(observer)
            self.demoObserver = nil
            // Laisse le temps d'envoyer l'alerte une fois l'app en arrière-plan
            let background = UIApplication.shared.beginBackgroundTask(withName: "Démonstration Live Activity")
            let state = RestActivityAttributes.ContentState(
                endDate: Date().addingTimeInterval(55), totalSeconds: 90,
                next: .init(exercise: "Développé couché", set: 3, load: "80 kg × 8"))
            self.enqueue {
                defer { Task { @MainActor in UIApplication.shared.endBackgroundTask(background) } }
                do {
                    let activity = try RestActivity.request(
                        attributes: .init(sessionTitle: "Push", tint: "orange"),
                        content: Self.content(state), pushType: nil)
                    try? await Task.sleep(nanoseconds: 22_000_000_000)
                    await activity.update(Self.content(state), alertConfiguration: AlertConfiguration(
                        title: "Repos", body: "Développé couché · série 3", sound: .default))
                } catch {
                    print("⚡️ Live Activity de démonstration refusée : \(error)")
                }
            }
        }
    }
    #endif
}
