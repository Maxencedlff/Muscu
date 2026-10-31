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
///
/// NON COMPILÉ au moment de l'écriture (pas de Xcode sur la machine de développement).
@MainActor
final class WatchSessionModel: NSObject, ObservableObject {
    @Published private(set) var state: WatchSessionState?
    @Published private(set) var reachable = false
    /// Geste envoyé, en attente du nouvel état de l'iPhone
    @Published private(set) var pending = false
    /// Dernier envoi refusé (iPhone injoignable)
    @Published private(set) var failed = false

    private var pendingTimeout: Task<Void, Never>?

    override init() {
        super.init()
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
        let session = WCSession.default
        guard session.activationState == .activated else { return }
        apply(session.receivedApplicationContext)
        guard session.isReachable else { return }
        session.sendMessage([Companion.Key.request: true], replyHandler: nil, errorHandler: nil)
    }

    private func send(_ action: WatchAction, haptic: WKHapticType) {
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
