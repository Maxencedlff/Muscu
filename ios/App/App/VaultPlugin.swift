import Foundation
import UIKit
import LocalAuthentication
import Security
import Capacitor

/// Coffre à photos (Progrès › Mesures › Photos) : Face ID et écran de confidentialité.
/// Côté web : Capacitor.registerPlugin('MdlfVault') (js/platform/native.js, Native.vault) ; logique du
/// coffre dans js/data/photo-vault.js, choix détaillés dans docs/COFFRE_PHOTOS.md.
///
/// - La clé du coffre (256 bits, base64) est confiée au trousseau avec un contrôle d'accès
///   `.biometryCurrentSet` et `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` : lisible seulement après
///   Face ID (ou Touch ID) sur CET iPhone, jamais sauvegardée ni copiée sur un autre appareil, invalidée par
///   iOS si les visages enregistrés changent, effacée si le code de l'iPhone est retiré.
/// - Écran de confidentialité : tant que le coffre est ouvert (`shield(on: true)`), un flou est posé sur la
///   fenêtre dès que l'app cesse d'être active, donc avant la capture du sélecteur d'apps, et retiré au retour.
@objc(VaultPlugin)
public class VaultPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VaultPlugin"
    public let jsName = "MdlfVault"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remember", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unlock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "forget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shield", returnType: CAPPluginReturnPromise),
    ]

    private let service = "com.mdlf.training.photo-vault"
    private let account = "vault-key"
    private var shieldOn = false
    private var shieldView: UIView?

    override public func load() {
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(appWillResign), name: UIApplication.willResignActiveNotification, object: nil)
        nc.addObserver(self, selector: #selector(appWillResign), name: UIApplication.didEnterBackgroundNotification, object: nil)
        nc.addObserver(self, selector: #selector(appDidBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    private func baseQuery() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    private func biometryName(_ ctx: LAContext) -> String {
        var error: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else { return "none" }
        switch ctx.biometryType {
        case .faceID: return "faceID"
        case .touchID: return "touchID"
        default:
            if #available(iOS 17.0, *), ctx.biometryType == .opticID { return "opticID" }
            return "none"
        }
    }

    /// Clé présente sans déclencher Face ID (lecture interdite d'interaction)
    private func keyStored() -> Bool {
        let ctx = LAContext()
        ctx.interactionNotAllowed = true
        var q = baseQuery()
        q[kSecUseAuthenticationContext as String] = ctx
        q[kSecReturnData as String] = false
        let status = SecItemCopyMatching(q as CFDictionary, nil)
        return status == errSecSuccess || status == errSecInteractionNotAllowed
    }

    /// { biometry: 'faceID' | 'touchID' | 'opticID' | 'none', stored }
    @objc func status(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async {
            let name = self.biometryName(LAContext())
            call.resolve(["biometry": name, "stored": self.keyStored()])
        }
    }

    /// { key (base64, 32 octets), reason } : Face ID, puis clé rangée dans le trousseau
    @objc func remember(_ call: CAPPluginCall) {
        guard let b64 = call.getString("key"), let key = Data(base64Encoded: b64), key.count == 32 else {
            call.reject("Clé invalide", "INVALID")
            return
        }
        let reason = call.getString("reason") ?? "Ouvrir le coffre à photos"
        let ctx = LAContext()
        var error: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            call.reject("Face ID indisponible", "UNAVAILABLE")
            return
        }
        ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { ok, err in
            guard ok else {
                let canceled = (err as? LAError)?.code == .userCancel || (err as? LAError)?.code == .appCancel || (err as? LAError)?.code == .systemCancel
                call.reject(canceled ? "Annulé" : "Face ID refusé", canceled ? "CANCELED" : "FAILED")
                return
            }
            var acErr: Unmanaged<CFError>?
            guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, &acErr) else {
                call.reject("Trousseau indisponible", "FAILED")
                return
            }
            SecItemDelete(self.baseQuery() as CFDictionary)
            var add = self.baseQuery()
            add[kSecValueData as String] = key
            add[kSecAttrAccessControl as String] = access
            add[kSecUseAuthenticationContext as String] = ctx
            let status = SecItemAdd(add as CFDictionary, nil)
            if status == errSecSuccess { call.resolve() } else { call.reject("Écriture refusée (\(status))", "FAILED") }
        }
    }

    /// { reason } → { key } après Face ID ; CANCELED si annulé, NOT_FOUND si la clé n'est plus là
    @objc func unlock(_ call: CAPPluginCall) {
        let ctx = LAContext()
        ctx.localizedReason = call.getString("reason") ?? "Ouvrir le coffre à photos"
        ctx.localizedFallbackTitle = "Entrer le code"
        var q = baseQuery()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        q[kSecUseAuthenticationContext as String] = ctx
        DispatchQueue.global(qos: .userInitiated).async {
            var out: CFTypeRef?
            let status = SecItemCopyMatching(q as CFDictionary, &out)
            switch status {
            case errSecSuccess:
                if let data = out as? Data { call.resolve(["key": data.base64EncodedString()]) }
                else { call.reject("Clé illisible", "FAILED") }
            case errSecUserCanceled: call.reject("Annulé", "CANCELED")
            case errSecItemNotFound: call.reject("Clé absente", "NOT_FOUND")
            case errSecAuthFailed: call.reject("Face ID n'a pas reconnu", "FAILED")
            default: call.reject("Face ID refusé (\(status))", "FAILED")
            }
        }
    }

    @objc func forget(_ call: CAPPluginCall) {
        SecItemDelete(baseQuery() as CFDictionary)
        call.resolve()
    }

    /// { on } : écran de confidentialité armé (coffre ouvert) ou non
    @objc func shield(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async {
            self.shieldOn = on
            // Coffre refermé pendant le passage en arrière-plan : le flou reste jusqu'au retour (la vue web
            // n'a peut-être pas encore redessiné l'écran verrouillé quand iOS prend sa capture)
            if !on && UIApplication.shared.applicationState == .active { self.hideShield() }
            call.resolve()
        }
    }

    /// Notification reçue sur le fil principal : le flou est posé tout de suite, avant la capture d'iOS
    @objc private func appWillResign() {
        if Thread.isMainThread { showShield() } else { DispatchQueue.main.sync { showShield() } }
    }

    private func showShield() {
        guard shieldOn, shieldView == nil, let window = bridge?.viewController?.view.window else { return }
        let blur = UIVisualEffectView(effect: UIBlurEffect(style: .systemMaterial))
        blur.frame = window.bounds
        blur.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        window.addSubview(blur)
        shieldView = blur
    }

    @objc private func appDidBecomeActive() {
        DispatchQueue.main.async { self.hideShield() }
    }

    private func hideShield() {
        shieldView?.removeFromSuperview()
        shieldView = nil
    }
}
