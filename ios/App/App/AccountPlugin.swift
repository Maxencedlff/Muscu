import Foundation
import Capacitor
import AuthenticationServices
import CryptoKit
import Security

/// Compte MDLF : connexion avec Apple et session gardée dans le Trousseau de l'iPhone.
/// Côté web : Capacitor.registerPlugin('MdlfAccount') (js/platform/native.js, Native.account ;
/// js/data/account.js pour le compte, js/data/sync.js pour la synchronisation).
///
/// - Connexion : AuthenticationServices, sans nom ni e-mail demandés (requestedScopes vide). Le nonce
///   brut vient du JS ; Apple reçoit son SHA-256 en hexadécimal minuscule, Supabase le nonce brut
///   (signInWithIdToken compare sha256(nonce) au claim nonce du jeton).
/// - Session : supabase-js lit et écrit sa session par getItem / setItem / removeItem. Elle est rangée
///   dans le Trousseau (kSecClassGenericPassword), lisible dès le premier déverrouillage (rafraîchissement
///   en arrière-plan), jamais synchronisée dans iCloud ni restaurée sur un autre appareil
///   (kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly). Le localStorage de la vue web peut être vidé
///   par iOS quand la place manque : le Trousseau, non. Il survit aussi à la désinstallation, ce qui
///   évite de se reconnecter après une réinstallation ; une session devenue invalide est simplement
///   refusée par le serveur et l'app repasse « non connecté ».
/// - Entitlement : com.apple.developer.applesignin (App.entitlements), capacité APPLE_ID_AUTH
///   activée sur com.mdlf.training (le profil App Store doit la contenir).
@objc(AccountPlugin)
public class AccountPlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate,
                            ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "AccountPlugin"
    public let jsName = "MdlfAccount"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "credentialState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getItem", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setItem", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeItem", returnType: CAPPluginReturnPromise),
    ]

    private static let service = "com.mdlf.training.auth"
    /// Demande de connexion en cours et sa fenêtre d'Apple (une seule à la fois ; fil principal).
    /// Une demande remplacée garde son contrôleur : sa réponse tardive est ignorée, elle ne doit pas
    /// répondre à la nouvelle demande avec un jeton signé pour l'ancien nonce.
    private var pending: CAPPluginCall?
    private var currentController: ASAuthorizationController?

    // MARK: Connexion avec Apple

    /// { nonce } → { identityToken, authorizationCode, user }. Annulation : rejet de code "CANCELED".
    @objc func signIn(_ call: CAPPluginCall) {
        guard let raw = call.getString("nonce"), !raw.isEmpty else { call.reject("Nonce manquant"); return }
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = []
        request.nonce = SHA256.hash(data: Data(raw.utf8)).map { String(format: "%02x", $0) }.joined()
        DispatchQueue.main.async {
            if let previous = self.pending { previous.reject("Remplacée par une nouvelle demande", "CANCELED") }
            self.pending = call
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.currentController = controller
            controller.performRequests()
        }
    }

    /// { user } → { state: authorized | revoked | notFound | transferred | unknown }.
    /// Appelé au lancement : un identifiant révoqué (Réglages › Apple ID) déconnecte l'app.
    @objc func credentialState(_ call: CAPPluginCall) {
        guard let user = call.getString("user"), !user.isEmpty else { call.reject("Utilisateur manquant"); return }
        ASAuthorizationAppleIDProvider().getCredentialState(forUserID: user) { state, _ in
            let name: String
            switch state {
            case .authorized: name = "authorized"
            case .revoked: name = "revoked"
            case .notFound: name = "notFound"
            case .transferred: name = "transferred"
            @unknown default: name = "unknown"
            }
            call.resolve(["state": name])
        }
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        bridge?.webView?.window ?? ASPresentationAnchor()
    }

    public func authorizationController(controller: ASAuthorizationController,
                                        didCompleteWithAuthorization authorization: ASAuthorization) {
        guard controller === currentController, let call = pending else { return }
        pending = nil
        currentController = nil
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let token = String(data: tokenData, encoding: .utf8) else {
            call.reject("Réponse d'Apple incomplète"); return
        }
        let code = credential.authorizationCode.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        call.resolve(["identityToken": token, "authorizationCode": code, "user": credential.user])
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard controller === currentController, let call = pending else { return }
        pending = nil
        currentController = nil
        // Fenêtre fermée par l'utilisateur : rejet silencieux côté interface (code CANCELED)
        if (error as? ASAuthorizationError)?.code == .canceled { call.reject("Connexion annulée", "CANCELED"); return }
        call.reject(error.localizedDescription)
    }

    // MARK: Trousseau (stockage de la session supabase-js)

    private func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: Self.service,
         kSecAttrAccount as String: key]
    }

    /// { key } → { value: chaîne ou null }. Toute erreur de lecture vaut « rien » : supabase-js
    /// n'attrape pas une exception de son stockage.
    @objc func getItem(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { call.resolve(["value": NSNull()]); return }
        var q = query(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &out)
        guard status == errSecSuccess, let data = out as? Data, let value = String(data: data, encoding: .utf8) else {
            call.resolve(["value": NSNull()]); return
        }
        call.resolve(["value": value])
    }

    /// { key, value } : remplace la valeur (mise à jour, sinon ajout)
    @objc func setItem(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), let value = call.getString("value") else { call.reject("Clé ou valeur manquante"); return }
        let data = Data(value.utf8)
        let attrs: [String: Any] = [kSecValueData as String: data,
                                    kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(query(key) as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound {
            var add = query(key)
            add.merge(attrs) { $1 }
            status = SecItemAdd(add as CFDictionary, nil)
        }
        if status == errSecSuccess { call.resolve() } else { call.reject("Trousseau : erreur \(status)") }
    }

    @objc func removeItem(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else { call.resolve(); return }
        let status = SecItemDelete(query(key) as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound { call.resolve() } else { call.reject("Trousseau : erreur \(status)") }
    }
}
