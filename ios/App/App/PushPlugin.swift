import Foundation
import Capacitor
import UIKit
import UserNotifications

/// Notifications push (APNs) : autorisation, jeton de l'appareil, toucher d'une notification.
/// Côté web : Capacitor.registerPlugin('MdlfPush') (js/platform/native.js, Native.push).
///
/// Le jeton arrive dans AppDelegate (didRegisterForRemoteNotificationsWithDeviceToken), qui le relaie par
/// NotificationCenter sous les noms de Capacitor (.capacitorDidRegisterForRemoteNotifications), comme le
/// module officiel @capacitor/push-notifications. Les notifications reçues passent par le routeur de
/// Capacitor (bridge.notificationRouter, délégué de UNUserNotificationCenter) : il donne les push à ce module
/// (pushNotificationHandler) et les notifications locales (fin du repos) à LocalNotifications, sans conflit.
///
/// Rien n'est demandé ici sans un geste : la fenêtre d'autorisation d'iOS ne s'ouvre que par
/// requestPermission, appelé par Réglages › Notifications quand on allume un type de notification.
@objc(PushPlugin)
public class PushPlugin: CAPPlugin, CAPBridgedPlugin, NotificationHandlerProtocol {
    public let identifier = "PushPlugin"
    public let jsName = "MdlfPush"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "permission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "register", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
    ]

    /// Appels de register en attente du jeton (iOS répond une fois pour tous)
    private var waiting: [CAPPluginCall] = []

    /// Environnement APNs de cette build : Debug (Xcode, simulateur) → sandbox ; Release (TestFlight,
    /// App Store) → production. Doit correspondre à aps-environment de la signature (App.entitlements).
    private static var environment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    override public func load() {
        bridge?.notificationRouter.pushNotificationHandler = self
        NotificationCenter.default.addObserver(self, selector: #selector(didRegister(_:)),
                                               name: .capacitorDidRegisterForRemoteNotifications, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(didFailToRegister(_:)),
                                               name: .capacitorDidFailToRegisterForRemoteNotifications, object: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    // ── Autorisation ──────────────────────────────────────────────────────────────────

    private static func name(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "prompt"
        case .denied: return "denied"
        case .authorized, .provisional, .ephemeral: return "granted"
        @unknown default: return "prompt"
        }
    }

    /// État de l'autorisation, sans rien montrer : "prompt" (jamais demandée), "granted", "denied".
    /// Elle est commune aux notifications locales (fin du repos) et push.
    @objc func permission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            call.resolve(["permission": Self.name(settings.authorizationStatus)])
        }
    }

    /// Fenêtre d'autorisation d'iOS si elle n'a jamais été montrée ; sinon renvoie la réponse déjà donnée.
    @objc func requestPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in
            UNUserNotificationCenter.current().getNotificationSettings { settings in
                call.resolve(["permission": Self.name(settings.authorizationStatus)])
            }
        }
    }

    // ── Jeton ─────────────────────────────────────────────────────────────────────────

    /// Inscrit l'appareil auprès d'APNs (à chaque lancement s'il le faut : iOS peut changer le jeton) et
    /// renvoie { token: hexadécimal, environment: "production" | "sandbox" }. Refusé sans autorisation.
    @objc func register(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            guard Self.name(settings.authorizationStatus) == "granted" else {
                call.reject("Notifications non autorisées", "DENIED"); return
            }
            DispatchQueue.main.async {
                self.waiting.append(call)   // promesse résolue par didRegister / didFailToRegister
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    @objc private func didRegister(_ note: Notification) {
        guard let data = note.object as? Data else { return }
        let token = data.map { String(format: "%02x", $0) }.joined()
        DispatchQueue.main.async {
            let calls = self.waiting
            self.waiting.removeAll()
            for call in calls {
                call.resolve(["token": token, "environment": Self.environment])
            }
        }
    }

    @objc private func didFailToRegister(_ note: Notification) {
        let message = (note.object as? Error)?.localizedDescription ?? "Inscription aux notifications refusée"
        DispatchQueue.main.async {
            let calls = self.waiting
            self.waiting.removeAll()
            for call in calls {
                call.reject(message, "REGISTER_FAILED")
            }
        }
    }

    /// Réglages de l'app dans l'app Réglages d'iOS (notifications coupées : seul endroit pour les rallumer)
    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { call.resolve(["opened": false]); return }
            UIApplication.shared.open(url) { ok in call.resolve(["opened": ok]) }
        }
    }

    // ── Notifications reçues (routeur de Capacitor) ───────────────────────────────────

    /// Contenu propre à l'app : { kind, ref } posés par la fonction serveur push-send (clé "mdlf")
    private static func payload(_ userInfo: [AnyHashable: Any]) -> [String: Any] {
        let mdlf = userInfo["mdlf"] as? [String: Any] ?? [:]
        var out: [String: Any] = [:]
        if let kind = mdlf["kind"] as? String, kind.count <= 32 { out["kind"] = kind }
        if let ref = mdlf["ref"] as? String, ref.count <= 64 { out["ref"] = ref }
        return out
    }

    /// App au premier plan : la bannière s'affiche quand même (comme Messages), et le web relit l'état
    /// (badge des Amis, coach) sans attendre.
    public func willPresent(notification: UNNotification) -> UNNotificationPresentationOptions {
        notifyListeners("received", data: Self.payload(notification.request.content.userInfo))
        return [.banner, .list, .sound]
    }

    /// Toucher d'une notification : gardé jusqu'à l'abonnement du web (lancement à froid par le toucher)
    public func didReceive(response: UNNotificationResponse) {
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier else { return }
        notifyListeners("tap", data: Self.payload(response.notification.request.content.userInfo), retainUntilConsumed: true)
    }
}
