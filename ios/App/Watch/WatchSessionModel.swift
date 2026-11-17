import Foundation
import WatchConnectivity
import WatchKit

/// Lien avec l'iPhone (WatchConnectivity) et état affiché par la montre.
///
/// Apple (WatchConnectivity, WCSession) : la session s'active au lancement ; le dernier contexte
/// envoyé par l'iPhone (updateApplicationContext) se relit dans receivedApplicationContext, même s'il
/// est arrivé pendant que l'app était fermée ; sendMessage n'aboutit que si l'iPhone est joignable
/// (isReachable) et réveille alors son app en arrière-plan.
///
/// Un geste n'est envoyé que si l'iPhone est joignable : il porte la série visée et son heure, et
/// l'iPhone ignore un geste périmé. Après un geste, la montre attend le nouvel état de l'iPhone
/// (pending) au lieu de deviner : la séance n'a qu'une vérité, celle de l'iPhone.
@MainActor
final class WatchSessionModel: NSObject, ObservableObject {
    @Published private(set) var state: WatchSessionState?
    @Published private(set) var reachable = false
    /// Geste envoyé, en attente du nouvel état de l'iPhone
    @Published private(set) var pending = false
    /// Dernier envoi refusé (iPhone injoignable)
    @Published private(set) var failed = false

    private var pendingTimeout: Task<Void, Never>?

    /// Mode démonstration (Debug seulement) : état figé, aucun lien avec l'iPhone
    private var demo = false

    override init() {
        super.init()
        #if DEBUG
        if let requested = WatchDemo.requested() {
            demo = true
            state = requested.state
            reachable = requested.reachable
            return
        }
        #endif
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    // MARK: - Gestes

    func validate() {
        guard let ref = state?.cur, state?.canValidate == true else { return }
        send(.validate(ref), haptic: .success)
    }

    func skipRest() { send(.skipRest, haptic: .click) }

    func adjustRest(_ seconds: Int) { send(.restAdjust(seconds), haptic: .click) }

    func requestState() {
        guard !demo else { return }
        let session = WCSession.default
        guard session.activationState == .activated else { return }
        apply(session.receivedApplicationContext)
        guard session.isReachable else { return }
        session.sendMessage([Companion.Key.request: true], replyHandler: nil, errorHandler: nil)
    }

    private func send(_ action: WatchAction, haptic: WKHapticType) {
        guard !demo else { return }
        let session = WCSession.default
        guard !pending, session.activationState == .activated, session.isReachable,
              let json = action.json() else {
            failed = true
            WKInterfaceDevice.current().play(.failure)
            return
        }
        failed = false
        pending = true
        WKInterfaceDevice.current().play(haptic)
        session.sendMessage([Companion.Key.action: json], replyHandler: { _ in }, errorHandler: { [weak self] _ in
            Task { @MainActor in self?.endPending(failed: true) }
        })
        // Sans nouvel état sous 5 s (app iPhone suspendue…), le bouton redevient utilisable
        pendingTimeout?.cancel()
        pendingTimeout = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            guard !Task.isCancelled else { return }
            self?.endPending(failed: true)
        }
    }

    private func endPending(failed: Bool) {
        guard pending else { return }
        pending = false
        self.failed = failed
        pendingTimeout?.cancel()
        if failed { WKInterfaceDevice.current().play(.failure) }
    }

    // MARK: - Réception

    fileprivate func apply(_ payload: [String: Any]) {
        guard let next = WatchSessionState.decode(payload[Companion.Key.state] as? String) else { return }
        // Le repos vient de commencer : un tapotement, comme sur l'iPhone
        if next.rest != nil && state?.rest == nil && state != nil { WKInterfaceDevice.current().play(.start) }
        state = next
        pending = false
        failed = false
        pendingTimeout?.cancel()
    }

    fileprivate func updateReachability(_ value: Bool) { reachable = value }
}

extension WatchSessionModel: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        let context = session.receivedApplicationContext, reachable = session.isReachable
        Task { @MainActor in
            self.updateReachability(reachable)
            self.apply(context)
            self.requestState()
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor in self.apply(applicationContext) }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        Task { @MainActor in self.apply(message) }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        let reachable = session.isReachable
        Task { @MainActor in
            self.updateReachability(reachable)
            if reachable { self.requestState() }
        }
    }
}

// MARK: - Démonstration (Debug seulement)

#if DEBUG
/// `-MDLFWatchDemo <état>` au lancement (CI : .github/workflows/montre.yml, xcrun simctl launch …) :
/// la montre affiche un état figé sans iPhone, pour photographier chaque écran et lire ses libellés
/// VoiceOver. Compilé seulement en Debug : la version envoyée sur TestFlight n'en contient rien.
/// États : aucune, serie, repos, duree, fini, long (nom d'exercice très long), horsportee.
enum WatchDemo {
    static func requested(_ arguments: [String] = ProcessInfo.processInfo.arguments) -> (state: WatchSessionState, reachable: Bool)? {
        guard let i = arguments.firstIndex(of: "-MDLFWatchDemo"), i + 1 < arguments.count else { return nil }
        return state(arguments[i + 1])
    }

    static func state(_ name: String) -> (state: WatchSessionState, reachable: Bool)? {
        let v = Companion.watchStateVersion
        var s = WatchSessionState(v: v, active: true, title: "Push", tint: "#FF7A1A",
                                  startedAt: Date().addingTimeInterval(-1_500).timeIntervalSince1970 * 1000,
                                  done: 5, total: 18, cur: .init(ei: 1, si: 1), exercise: "Développé couché",
                                  setNo: 2, setCount: 4, load: "80 kg × 8", canValidate: true, blocked: "")
        switch name {
        case "aucune":
            return (WatchSessionState(v: v, active: false, next: .init(title: "Pull", tint: "#FF7A1A")), true)
        case "serie":
            return (s, true)
        case "repos":
            s.rest = .init(endTime: Date().addingTimeInterval(75).timeIntervalSince1970 * 1000, total: 120)
            return (s, true)
        case "duree":
            s.exercise = "Gainage"; s.load = "45 s"; s.setNo = 1; s.setCount = 3
            s.canValidate = false; s.blocked = "Série à saisir sur l'iPhone"
            return (s, true)
        case "fini":
            s.done = 18; s.cur = nil; s.exercise = ""; s.setNo = 0; s.setCount = 0; s.load = ""; s.canValidate = false
            return (s, true)
        case "long":
            s.title = "Haut du corps (programme coach)"
            s.exercise = "Développé incliné haltères prise neutre sur banc à 30 degrés"
            s.load = "32,5 kg × 10 à 12"
            return (s, true)
        case "horsportee":
            return (s, false)
        default:
            return nil
        }
    }
}
#endif
