import Foundation
import UIKit
import LocalAuthentication
import Security
import Capacitor

/// Coffre à photos (Progrès › Mesures › Photos) : clé du coffre dans le trousseau, ouverte par Face ID ou le
/// code de l'iPhone, et écran de confidentialité.
/// Côté web : Capacitor.registerPlugin('MdlfVault') (js/platform/native.js, Native.vault) ; logique du
/// coffre dans js/data/photo-vault.js, choix et sources dans docs/COFFRE_PHOTOS.md.
///
/// - Clé du coffre : 32 octets tirés par SecRandomCopyBytes à la création, rangés dans le trousseau avec un
///   contrôle d'accès `.userPresence` (Face ID, Touch ID ou Optic ID, avec repli sur le code de l'iPhone ; garde
///   la clé si les visages enregistrés changent) et `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` : lisible
///   seulement iPhone déverrouillé, restaurée par une sauvegarde sur CE iPhone, jamais sur un autre.
/// - La clé n'est rendue au JS qu'après authentification (le contrôle d'accès est évalué par la Secure
///   Enclave). Le JS chiffre et déchiffre les photos lui-même (WebCrypto, AES-GCM) : les images doivent de
///   toute façon être déchiffrées dans la vue web pour s'afficher, et faire passer chaque photo en base64
///   par le pont coûterait plus que ce que ça protège.
/// - Jamais écrasée : `create` reprend une clé déjà présente (le trousseau survit à la suppression de l'app).
/// - Erreurs rendues au JS : CANCELED (annulé, app passée en arrière-plan), NOT_FOUND (pas de clé sur cet
///   iPhone), NO_PASSCODE (aucun code sur l'iPhone), FAILED (le reste).
/// - Écran de confidentialité : tant que le coffre est ouvert (`shield(on: true)`), un flou est posé sur la
///   fenêtre dès que l'app cesse d'être active, donc avant la capture du sélecteur d'apps, et retiré au retour.
@objc(VaultPlugin)
public class VaultPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VaultPlugin"
    public let jsName = "MdlfVault"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "create", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unlock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "forget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shield", returnType: CAPPluginReturnPromise),
    ]

    private let service = "com.mdlf.training.photo-vault"
    private let account = "vault-key"
    private let keyLength = 32
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

    // MARK: - Authentification

    /// Erreur de LocalAuthentication → code rendu au JS
    private func code(for error: Error?) -> String {
        guard let error = error as NSError?, error.domain == LAErrorDomain,
              let code = LAError.Code(rawValue: error.code) else { return "FAILED" }
        switch code {
        case .passcodeNotSet: return "NO_PASSCODE"
        case .userCancel, .appCancel, .systemCancel, .userFallback: return "CANCELED"
        default: return "FAILED"
        }
    }

    /// Code de l'iPhone en place ? (sans lui, ni Face ID ni le contrôle d'accès `.userPresence` ne marchent)
    private func passcodeMissing(_ ctx: LAContext) -> Bool {
        var error: NSError?
        if ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) { return false }
        return error?.domain == LAErrorDomain && error?.code == LAError.Code.passcodeNotSet.rawValue
    }

    private func biometryName() -> String {
        let ctx = LAContext()
        var error: NSError?
        // biometryType n'est renseigné qu'après canEvaluatePolicy
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else { return "none" }
        switch ctx.biometryType {
        case .faceID: return "faceID"
        case .touchID: return "touchID"
        default:
            if #available(iOS 17.0, *), ctx.biometryType == .opticID { return "opticID" }
            return "none"
        }
    }

    // MARK: - Trousseau

    /// Lecture de la clé ; avec un contexte déjà authentifié, iOS ne redemande rien (kSecUseAuthenticationContext)
    private func readKey(_ ctx: LAContext) -> (status: OSStatus, key: Data?) {
        var q = baseQuery()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        q[kSecUseAuthenticationContext as String] = ctx
        var out: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &out)
        return (status, out as? Data)
    }

    /// Statut du trousseau → réponse au JS : { key } ou rejet avec un code
    private func answer(_ call: CAPPluginCall, _ status: OSStatus, _ key: Data?) {
        switch status {
        case errSecSuccess:
            if let key = key, key.count == keyLength { call.resolve(["key": key.base64EncodedString()]) }
            else { call.reject("Clé illisible", "FAILED") }
        case errSecUserCanceled, errSecInteractionNotAllowed: call.reject("Annulé", "CANCELED")
        case errSecItemNotFound: call.reject("Clé absente de cet iPhone", "NOT_FOUND")
        case errSecAuthFailed: call.reject("Authentification refusée", "FAILED")
        default: call.reject("Trousseau indisponible (\(status))", "FAILED")
        }
    }

    // MARK: - Méthodes

    /// { biometry: 'faceID' | 'touchID' | 'opticID' | 'none', passcode: code de l'iPhone en place }. Rien sur la
    /// clé : son absence est dite par `unlock` (NOT_FOUND, sans feuille d'iOS quand il n'y a rien à lire).
    @objc func status(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async {
            call.resolve(["biometry": self.biometryName(), "passcode": !self.passcodeMissing(LAContext())])
        }
    }

    /// { reason } → { key } : Face ID (ou code de l'iPhone), puis clé tirée et rangée dans le trousseau. Une clé
    /// déjà présente est rendue telle quelle, jamais remplacée.
    @objc func create(_ call: CAPPluginCall) {
        let reason = call.getString("reason") ?? "Créer ton coffre à photos"
        let ctx = LAContext()
        if passcodeMissing(ctx) { call.reject("Aucun code sur cet iPhone", "NO_PASSCODE"); return }
        ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, error in
            // Réponse sur une file privée de LocalAuthentication : le trousseau peut y être appelé
            guard ok else { call.reject("Authentification refusée", self.code(for: error)); return }
            let existing = self.readKey(ctx)
            if existing.status != errSecItemNotFound { self.answer(call, existing.status, existing.key); return }

            var key = Data(count: self.keyLength)
            let rc = key.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, self.keyLength, $0.baseAddress!) }
            guard rc == errSecSuccess else { call.reject("Tirage de la clé impossible", "FAILED"); return }
            var acError: Unmanaged<CFError>?
            guard let access = SecAccessControlCreateWithFlags(kCFAllocatorDefault, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                                                               .userPresence, &acError) else {
                call.reject("Trousseau indisponible", "FAILED")
                return
            }
            var add = self.baseQuery()
            add[kSecValueData as String] = key
            add[kSecAttrAccessControl as String] = access
            add[kSecUseAuthenticationContext as String] = ctx
            let status = SecItemAdd(add as CFDictionary, nil)
            if status == errSecSuccess { call.resolve(["key": key.base64EncodedString()]); return }
            if status == errSecDuplicateItem {   // rangée entre-temps par un autre appel : c'est elle qui compte
                let again = self.readKey(ctx)
                self.answer(call, again.status, again.key)
                return
            }
            call.reject("Écriture refusée (\(status))", "FAILED")
        }
    }

    /// { reason } → { key } après Face ID ou le code de l'iPhone (feuille d'iOS déclenchée par la lecture)
    @objc func unlock(_ call: CAPPluginCall) {
        let reason = call.getString("reason") ?? "Ouvrir ton coffre à photos"
        DispatchQueue.global(qos: .userInitiated).async {
            let ctx = LAContext()
            if self.passcodeMissing(ctx) { call.reject("Aucun code sur cet iPhone", "NO_PASSCODE"); return }
            ctx.localizedReason = reason
            let read = self.readKey(ctx)
            self.answer(call, read.status, read.key)
        }
    }

    /// Clé retirée du trousseau (« Supprimer toutes les données », coffre vidé). Ne demande rien : effacer ne
    /// révèle rien.
    @objc func forget(_ call: CAPPluginCall) {
        let status = SecItemDelete(baseQuery() as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound { call.resolve() }
        else { call.reject("Suppression refusée (\(status))", "FAILED") }
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

    // MARK: - Écran de confidentialité

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
