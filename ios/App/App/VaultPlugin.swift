import Foundation
import UIKit
import LocalAuthentication
import Security
import Capacitor

/// Coffre à photos (Progrès › Mesures › Photos) : clé du coffre dans le trousseau iCloud, rendue après Face ID
/// ou le code de l'iPhone, et écran de confidentialité.
/// Côté web : Capacitor.registerPlugin('MdlfVault') (js/platform/native.js, Native.vault) ; logique du
/// coffre dans js/data/photo-vault.js, choix et sources dans docs/COFFRE_PHOTOS.md.
///
/// - Clé du coffre : 32 octets tirés par SecRandomCopyBytes, rangés dans le trousseau avec
///   `kSecAttrSynchronizable = true` (trousseau iCloud, chiffré de bout en bout : elle suit sur un nouvel
///   iPhone) et `kSecAttrAccessibleWhenUnlocked` (une valeur `…ThisDeviceOnly` interdit la synchronisation).
///   Trousseau iCloud désactivé : la clé reste sur cet iPhone.
/// - Pas de contrôle d'accès (`SecAccessControl`, `.userPresence`) sur l'élément : iOS refuse un élément
///   synchronisable qui en porte un (errSecParam). Face ID est donc un contrôle de l'app :
///   `evaluatePolicy(.deviceOwnerAuthentication)` doit réussir AVANT toute lecture de la clé. Aucune méthode
///   ne rend la clé sans cette authentification.
/// - Une clé par coffre : compte `vault-key.<id>`, id tiré par le JS et gardé dans les réglages du coffre.
///   `create` reprend la clé de cet id si elle existe déjà (ici ou arrivée par iCloud), jamais remplacée.
/// - Toutes les requêtes précisent `kSecAttrSynchronizable` : true à l'ajout, Any pour chercher, lire et effacer.
/// - Erreurs rendues au JS : CANCELED (annulé, app quittée), NOT_FOUND (clé pas, ou pas encore, sur cet
///   iPhone), NO_PASSCODE (aucun code sur l'iPhone), FAILED (le reste, id invalide compris).
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
    private let keyLength = 32
    private var shieldOn = false
    private var shieldView: UIView?

    override public func load() {
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(appWillResign), name: UIApplication.willResignActiveNotification, object: nil)
        nc.addObserver(self, selector: #selector(appWillResign), name: UIApplication.didEnterBackgroundNotification, object: nil)
        nc.addObserver(self, selector: #selector(appDidBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    // MARK: - Trousseau

    /// Identifiant du coffre venu du JS : 16 à 64 caractères hexadécimaux, sinon nil
    private func vaultId(_ call: CAPPluginCall) -> String? {
        guard let id = call.getString("id"), (16...64).contains(id.count),
              id.allSatisfy({ $0.isHexDigit }) else { return nil }
        return id.lowercased()
    }

    /// Élément de la clé d'un coffre ; `sync` : true à l'ajout, kSecAttrSynchronizableAny pour chercher,
    /// lire et effacer (la clé peut être synchronisée ou, ancienne, locale)
    private func query(_ id: String, sync: Any = kSecAttrSynchronizableAny) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: "vault-key.\(id)",
         kSecAttrSynchronizable as String: sync]
    }

    /// Clé présente ? Attributs seulement : rien de secret ne sort (sert à dire « absente » sans Face ID)
    private func keyExists(_ id: String) -> OSStatus {
        var q = query(id)
        q[kSecReturnAttributes as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        return SecItemCopyMatching(q as CFDictionary, &out)
    }

    /// Lecture de la clé : appelée seulement après une authentification réussie
    private func readKey(_ id: String) -> (status: OSStatus, key: Data?) {
        var q = query(id)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
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
        case errSecItemNotFound: call.reject("Clé absente de cet iPhone", "NOT_FOUND")
        case errSecInteractionNotAllowed: call.reject("iPhone verrouillé", "CANCELED")
        default: call.reject("Trousseau indisponible (\(status))", "FAILED")
        }
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

    /// Code de l'iPhone absent ? (sans lui, .deviceOwnerAuthentication échoue avec passcodeNotSet)
    private func passcodeMissing(_ ctx: LAContext) -> Bool {
        var error: NSError?
        if ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) { return false }
        return error?.domain == LAErrorDomain && error?.code == LAError.Code.passcodeNotSet.rawValue
    }

    /// Face ID (ou Touch ID, Optic ID), avec repli sur le code de l'iPhone ; `then` seulement en cas de succès.
    /// Réponse sur une file privée de LocalAuthentication : le trousseau peut y être appelé.
    private func authenticate(_ call: CAPPluginCall, reason: String, then: @escaping () -> Void) {
        let ctx = LAContext()
        if passcodeMissing(ctx) { call.reject("Aucun code sur cet iPhone", "NO_PASSCODE"); return }
        ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, error in
            guard ok else { call.reject("Authentification refusée", self.code(for: error)); return }
            then()
        }
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

    // MARK: - Méthodes

    /// { biometry: 'faceID' | 'touchID' | 'opticID' | 'none', passcode: code de l'iPhone en place }
    @objc func status(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async {
            call.resolve(["biometry": self.biometryName(), "passcode": !self.passcodeMissing(LAContext())])
        }
    }

    /// { id, reason } → { key } : Face ID (ou le code), puis la clé de ce coffre, reprise si elle existe déjà
    /// (ici ou arrivée par le trousseau iCloud), sinon tirée et rangée en synchronisable.
    @objc func create(_ call: CAPPluginCall) {
        guard let id = vaultId(call) else { call.reject("Identifiant invalide", "FAILED"); return }
        authenticate(call, reason: call.getString("reason") ?? "Créer ton coffre à photos") {
            let existing = self.readKey(id)
            if existing.status != errSecItemNotFound { self.answer(call, existing.status, existing.key); return }

            var key = Data(count: self.keyLength)
            let rc = key.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, self.keyLength, $0.baseAddress!) }
            guard rc == errSecSuccess else { call.reject("Tirage de la clé impossible", "FAILED"); return }
            var add = self.query(id, sync: true)
            add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked
            add[kSecValueData as String] = key
            let status = SecItemAdd(add as CFDictionary, nil)
            if status == errSecSuccess { call.resolve(["key": key.base64EncodedString()]); return }
            if status == errSecDuplicateItem {   // arrivée entre-temps (autre appel, trousseau iCloud) : c'est elle qui compte
                let again = self.readKey(id)
                self.answer(call, again.status, again.key)
                return
            }
            call.reject("Écriture refusée (\(status))", "FAILED")
        }
    }

    /// { id, reason } → { key } après Face ID ou le code de l'iPhone. Clé absente : NOT_FOUND tout de suite,
    /// sans feuille d'iOS (rien à ouvrir).
    @objc func unlock(_ call: CAPPluginCall) {
        guard let id = vaultId(call) else { call.reject("Identifiant invalide", "FAILED"); return }
        let reason = call.getString("reason") ?? "Ouvrir ton coffre à photos"
        DispatchQueue.global(qos: .userInitiated).async {
            let found = self.keyExists(id)
            if found != errSecSuccess { self.answer(call, found, nil); return }
            self.authenticate(call, reason: reason) {
                let read = self.readKey(id)
                self.answer(call, read.status, read.key)
            }
        }
    }

    /// { id } : clé retirée du trousseau, et donc de tous les appareils du trousseau iCloud (« Supprimer toutes
    /// les données »). Ne demande rien : effacer ne révèle rien.
    @objc func forget(_ call: CAPPluginCall) {
        guard let id = vaultId(call) else { call.reject("Identifiant invalide", "FAILED"); return }
        let status = SecItemDelete(query(id) as CFDictionary)
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
