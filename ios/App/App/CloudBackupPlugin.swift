import Foundation
import Capacitor

/// Copie des données dans l'iCloud de l'utilisateur (stockage clé-valeur d'iCloud,
/// NSUbiquitousKeyValueStore). Elle survit à la suppression de l'app et revient sur un nouvel
/// iPhone connecté au même compte Apple, sans compte ni serveur MDLF.
/// Côté web : Capacitor.registerPlugin('MdlfCloudBackup') (js/platform/native.js, Native.backup/boot).
///
/// - Une seule valeur : le JSON de `ppl_v2` compressé (zlib), plus sa date et son nombre de séances.
/// - Filet : une donnée sans séance n'écrase jamais une copie qui en a, sauf `force`
///   (« Supprimer toutes les données ») ; le web a son propre garde-fou (native.js, pushCloud).
/// - Limite d'Apple : 1 Mo pour toute l'app. Au-delà de MAX_BYTES compressés, rien n'est écrit
///   (la copie des Documents de l'app reste) et `save` répond { saved: false, reason: "tooLarge" }.
/// - iOS envoie lui-même les changements vers iCloud, par lots ; hors ligne, ils partent plus tard.
/// - Entitlement : com.apple.developer.ubiquity-kvstore-identifier (App.entitlements), capacité
///   iCloud activée sur com.mdlf.training (le profil App Store la contient).
@objc(CloudBackupPlugin)
public class CloudBackupPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CloudBackupPlugin"
    public let jsName = "MdlfCloudBackup"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
    ]

    private static let dataKey = "ppl_v2.zlib"
    private static let dateKey = "ppl_v2.savedAt"
    private static let sessionsKey = "ppl_v2.sessions"
    private static let maxBytes = 900_000

    private let store = NSUbiquitousKeyValueStore.default
    /// Première synchronisation avec iCloud reçue depuis le lancement (lu et écrit sur le fil principal)
    private var synced = false
    private var waiting: [CAPPluginCall] = []

    override public func load() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(externalChange(_:)),
            name: NSUbiquitousKeyValueStore.didChangeExternallyNotification, object: store)
        store.synchronize()
    }

    /// { synced, data?, savedAt? } ; data = JSON en clair. Pas de test « iCloud disponible » :
    /// ubiquityIdentityToken vaut nil sans iCloud Drive alors que le stockage clé-valeur marche,
    /// et sans compte iCloud, iOS garde simplement les valeurs sur l'appareil.
    private func snapshot() -> [String: Any] {
        var out: [String: Any] = ["synced": synced]
        if let packed = store.data(forKey: Self.dataKey),
           let raw = try? (packed as NSData).decompressed(using: .zlib) as Data,
           let json = String(data: raw, encoding: .utf8) {
            out["data"] = json
            out["savedAt"] = store.double(forKey: Self.dateKey)
        }
        return out
    }

    /// Changement venu d'iCloud (première synchronisation, autre appareil, quota) :
    /// les appels `load` en attente sont servis et le web est prévenu (`change`).
    @objc private func externalChange(_ note: Notification) {
        let reason = note.userInfo?[NSUbiquitousKeyValueStoreChangeReasonKey] as? Int
        DispatchQueue.main.async {
            if reason == NSUbiquitousKeyValueStoreQuotaViolationChange { return }
            self.synced = true
            let snap = self.snapshot()
            self.waiting.forEach { $0.resolve(snap) }
            self.waiting.removeAll()
            // Gardé jusqu'à l'abonnement du web s'il arrive avant (fin d'attente de `load`)
            self.notifyListeners("change", data: snap, retainUntilConsumed: true)
        }
    }

    /// { waitMs } : sans copie ni synchronisation, attend iCloud au plus waitMs (réinstallation :
    /// la copie arrive quelques secondes après le lancement). Répond avec snapshot().
    @objc func load(_ call: CAPPluginCall) {
        let waitMs = max(0, call.getInt("waitMs") ?? 0)
        DispatchQueue.main.async {
            let snap = self.snapshot()
            guard snap["data"] == nil, !self.synced, waitMs > 0 else {
                call.resolve(snap)
                return
            }
            self.waiting.append(call)
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(waitMs)) {
                guard let i = self.waiting.firstIndex(where: { $0 === call }) else { return }
                self.waiting.remove(at: i)
                call.resolve(self.snapshot())
            }
        }
    }

    /// { data, sessions, force } : JSON de ppl_v2 et son nombre de séances.
    /// Répond { saved, bytes } ou { saved: false, reason } (wouldErase, tooLarge, compression).
    @objc func save(_ call: CAPPluginCall) {
        guard let json = call.getString("data"), let raw = json.data(using: .utf8) else {
            call.reject("data manquant")
            return
        }
        let sessions = max(0, call.getInt("sessions") ?? 0)
        if sessions == 0, !call.getBool("force", false), store.longLong(forKey: Self.sessionsKey) > 0 {
            call.resolve(["saved": false, "reason": "wouldErase"])
            return
        }
        guard let packed = try? (raw as NSData).compressed(using: .zlib) as Data else {
            call.resolve(["saved": false, "reason": "compression"])
            return
        }
        guard packed.count <= Self.maxBytes else {
            call.resolve(["saved": false, "reason": "tooLarge", "bytes": packed.count])
            return
        }
        store.set(packed, forKey: Self.dataKey)
        store.set(Date().timeIntervalSince1970 * 1000, forKey: Self.dateKey)
        store.set(Int64(sessions), forKey: Self.sessionsKey)
        call.resolve(["saved": true, "bytes": packed.count])
    }
}
