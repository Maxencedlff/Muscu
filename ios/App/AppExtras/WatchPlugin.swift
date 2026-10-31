import Foundation
import Capacitor
import WatchConnectivity

/// Apple Watch : la séance en cours part vers la montre, ses gestes reviennent vers le JS.
/// Côté web : Capacitor.registerPlugin('MdlfWatch') (js/platform/native.js), appelé par js/features/watch.js.
/// À ajouter à la cible App, puis à enregistrer dans MainViewController (docs/WATCH_WIDGETS.md).
///
/// Apple (WatchConnectivity, WCSession) :
/// - la session s'active le plus tôt possible, une seule fois, avec un délégué ; WatchLink.shared.activate()
///   est donc aussi appelé depuis AppDelegate : un geste de la montre réveille l'app en arrière-plan,
///   parfois sans que la vue web (et ce module) soit chargée ;
/// - updateApplicationContext remplace le contexte précédent et arrive même si la montre n'est pas
///   joignable : c'est le bon outil pour « l'état actuel » ; sendMessage n'arrive que si elle l'est,
///   tout de suite (l'app de la montre ouverte) ;
/// - sur iPhone, sessionDidDeactivate impose de réactiver la session (changement de montre).
///
/// NON COMPILÉ au moment de l'écriture (pas de Xcode sur la machine de développement).
@objc(WatchPlugin)
public final class WatchPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WatchPlugin"
    public let jsName = "MdlfWatch"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
    ]

    override public func load() {
        WatchLink.shared.activate()
        // Gestes reçus avant le chargement de la vue web, puis ceux qui arrivent ensuite
        WatchLink.shared.attach(
            onAction: { [weak self] action in
                var data: [String: Any] = ["type": action.type.rawValue]
                if let ei = action.ei { data["ei"] = ei }
                if let si = action.si { data["si"] = si }
                if let d = action.d { data["d"] = d }
                // retainUntilConsumed : un geste arrivé avant que le JS n'écoute lui est remis à son
                // addListener (Capacitor, CAPPlugin.notifyListeners). Le JS revérifie la série visée.
                DispatchQueue.main.async { self?.notifyListeners("action", data: data, retainUntilConsumed: true) }
            },
            onRequest: { [weak self] in
                DispatchQueue.main.async { self?.notifyListeners("request", data: [:], retainUntilConsumed: true) }
            })
    }

    /// state : JSON de watchState (js/features/watch.js), borné pour rester léger
    @objc func send(_ call: CAPPluginCall) {
        guard let json = call.getString("state"), json.utf8.count <= 8_192,
              WatchSessionState.decode(json) != nil else {
            call.reject("État de séance invalide"); return
        }
        WatchLink.shared.send(stateJSON: json)
        call.resolve()
    }
}

/// Session WatchConnectivity de l'app, unique (Apple : « Configure and activate the session early »)
final class WatchLink: NSObject, WCSessionDelegate {
    static let shared = WatchLink()

    private let lock = NSLock()
    private var activated = false
    private var lastState: String?
    private var pendingActions: [WatchAction] = []
    private var pendingRequest = false
    private var onAction: ((WatchAction) -> Void)?
    private var onRequest: (() -> Void)?

    private var session: WCSession? { WCSession.isSupported() ? WCSession.default : nil }

    /// Idempotent : appelé par AppDelegate et par le module
    func activate() {
        lock.lock(); defer { lock.unlock() }
        guard !activated, let session else { return }
        activated = true
        session.delegate = self
        session.activate()
    }

    /// Le module JS est prêt : il reçoit d'abord les gestes gardés en attendant, s'ils sont encore frais
    func attach(onAction: @escaping (WatchAction) -> Void, onRequest: @escaping () -> Void) {
        lock.lock()
        self.onAction = onAction
        self.onRequest = onRequest
        let actions = pendingActions.filter { $0.isFresh() }
        let request = pendingRequest
        pendingActions.removeAll()
        pendingRequest = false
        lock.unlock()
        actions.forEach(onAction)
        if request { onRequest() }
    }

    /// Nouvel état : contexte (dernier état, livré dès que possible) et message direct si la montre écoute
    func send(stateJSON: String) {
        lock.lock(); lastState = stateJSON; lock.unlock()
        push(stateJSON)
    }

    private func push(_ json: String) {
        guard let session, session.activationState == .activated,
              session.isPaired, session.isWatchAppInstalled else { return }
        let payload = [Companion.Key.state: json]
        try? session.updateApplicationContext(payload)
        if session.isReachable {
            session.sendMessage(payload, replyHandler: nil, errorHandler: nil)
        }
    }

    // MARK: - Réception

    private func receive(_ message: [String: Any]) {
        if let json = message[Companion.Key.action] as? String,
           let action = WatchAction.decode(json), action.isFresh() {
            lock.lock()
            let handler = onAction
            if handler == nil { pendingActions.append(action) }
            lock.unlock()
            handler?(action)   // le module repasse sur le fil principal avant de parler à la vue web
        }
        if message[Companion.Key.request] as? Bool == true {
            lock.lock()
            let handler = onRequest
            if handler == nil { pendingRequest = true }
            lock.unlock()
            handler?()
        }
    }

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        // Session (ré)activée : la montre reçoit le dernier état connu
        guard activationState == .activated else { return }
        lock.lock(); let json = lastState; lock.unlock()
        if let json { push(json) }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        receive(message)
    }

    /// La montre envoie ses gestes avec une réponse attendue : elle sait ainsi que l'iPhone les a reçus
    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        receive(message)
        replyHandler(["ok": true])
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    /// Changement de montre : la session doit être réactivée pour la nouvelle (Apple, WCSession)
    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    func sessionWatchStateDidChange(_ session: WCSession) {
        // App de la montre installée après coup : elle reçoit l'état actuel
        lock.lock(); let json = lastState; lock.unlock()
        if let json { push(json) }
    }
}
