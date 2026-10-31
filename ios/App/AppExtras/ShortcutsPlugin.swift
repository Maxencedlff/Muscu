import Foundation
import Capacitor

/// Demandes de Siri et de l'app Raccourcis (« Démarrer ma séance », StartSessionIntent.swift) remises au JS.
/// Côté web : Capacitor.registerPlugin('MdlfShortcuts') (js/platform/native.js), appelé par js/features/siri.js.
/// À ajouter à la cible App, puis à enregistrer dans MainViewController (docs/WATCH_WIDGETS.md).
///
/// Le raccourci s'exécute dans le processus de l'app, parfois avant que la vue web soit chargée : la
/// demande est donc gardée (ShortcutInbox) et le JS vient la prendre une fois prêt (takeRequest), au
/// démarrage ou à l'évènement « request » si l'app était déjà ouverte.
///
/// NON COMPILÉ au moment de l'écriture (pas de Xcode sur la machine de développement).
@objc(ShortcutsPlugin)
public final class ShortcutsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShortcutsPlugin"
    public let jsName = "MdlfShortcuts"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "takeRequest", returnType: CAPPluginReturnPromise),
    ]

    private var observer: NSObjectProtocol?

    override public func load() {
        observer = NotificationCenter.default.addObserver(
            forName: ShortcutInbox.didPost, object: nil, queue: .main
        ) { [weak self] _ in
            self?.notifyListeners("request", data: [:])
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    /// { action, at } une seule fois, puis {} : une demande n'est jamais suivie deux fois
    @objc func takeRequest(_ call: CAPPluginCall) {
        guard let request = ShortcutInbox.take() else { call.resolve([:]); return }
        call.resolve(["action": request.action, "at": request.at])
    }
}

/// Boîte aux lettres d'une seule demande, gardée dans UserDefaults pour survivre au lancement de l'app
enum ShortcutInbox {
    static let didPost = Notification.Name("MDLFShortcutRequest")
    private static let key = "mdlf.shortcut.request"

    struct Request {
        let action: String
        /// Heure de la demande, en millisecondes depuis 1970 (le JS ignore une demande trop ancienne)
        let at: Double
    }

    static func post(action: String) {
        UserDefaults.standard.set(["action": action, "at": Date().timeIntervalSince1970 * 1000], forKey: key)
        NotificationCenter.default.post(name: didPost, object: nil)
    }

    static func take() -> Request? {
        let defaults = UserDefaults.standard
        guard let saved = defaults.dictionary(forKey: key) else { return nil }
        defaults.removeObject(forKey: key)
        guard let action = saved["action"] as? String, let at = saved["at"] as? Double else { return nil }
        return Request(action: action, at: at)
    }
}
