import Foundation
import Security

// Données échangées entre l'app iPhone et ses compagnons : l'app Apple Watch (WatchConnectivity)
// et le widget de l'écran d'accueil (trousseau partagé). Ce fichier appartient à trois cibles : App,
// MDLFWatch et RestActivity (voir docs/WATCH_WIDGETS.md). Foundation et Security seulement : il compile
// pour iOS, watchOS et l'extension WidgetKit.
//
// Le contenu est produit par le JS de l'app (js/features/watch.js, js/features/home-widget.js) : les
// noms des champs ci-dessous sont ceux de watchState() et de widgetSnapshot(). Les versions doivent
// rester égales à WATCH_VERSION et WIDGET_VERSION (vérifié par tests/unit/companions.mjs).

enum Companion {
    /// Groupe de trousseau partagé par l'app et l'extension RestActivity (droit keychain-access-groups
    /// des deux cibles, préfixe d'équipe compris). Pas d'App Group : un App Group doit être enregistré à
    /// la main sur developer.apple.com (l'API App Store Connect ne sait pas le faire), alors qu'un groupe
    /// de trousseau de l'équipe est accepté par tout profil (« NMK739Z59B.* »).
    static let keychainGroup = "NMK739Z59B.com.mdlf.training.shared"
    /// Élément du trousseau qui porte l'instantané du widget
    static let widgetSnapshotKey = "widget.snapshot"
    /// Nom du widget pour WidgetCenter.reloadTimelines(ofKind:)
    static let widgetKind = "NextSessionWidget"

    static let watchStateVersion = 1
    static let widgetSnapshotVersion = 1

    /// Clés des dictionnaires WatchConnectivity (types de liste de propriétés seulement : le contenu
    /// voyage en JSON dans une chaîne)
    enum Key {
        static let state = "state"       // iPhone → montre : WatchSessionState en JSON
        static let action = "action"     // montre → iPhone : WatchAction en JSON
        static let request = "request"   // montre → iPhone : « renvoie l'état », valeur true
    }

    /// Un geste de la montre plus vieux que ceci est ignoré (message resté en file)
    static let actionMaxAge: TimeInterval = 30
}

// MARK: - Apple Watch

/// État de la séance envoyé à la montre (js/features/watch.js, watchState). Sans séance en cours,
/// seuls `v`, `active` et `next` sont présents : tout le reste est facultatif.
struct WatchSessionState: Codable, Equatable {
    struct NextSession: Codable, Equatable {
        var title: String
        var tint: String
    }
    struct SetRef: Codable, Equatable {
        var ei: Int
        var si: Int
    }
    struct Rest: Codable, Equatable {
        /// Fin du repos, en millisecondes depuis 1970 (Date.now() du JS)
        var endTime: Double
        /// Durée totale en secondes (anneau de progression)
        var total: Int

        var endDate: Date { Date(timeIntervalSince1970: endTime / 1000) }
        var startDate: Date { endDate.addingTimeInterval(-Double(max(1, total))) }
        var interval: ClosedRange<Date> { startDate...max(endDate, startDate) }
    }

    var v: Int
    var active: Bool
    var next: NextSession?
    var title: String?
    var tint: String?
    var startedAt: Double?
    var done: Int?
    var total: Int?
    var cur: SetRef?
    var exercise: String?
    var setNo: Int?
    var setCount: Int?
    var load: String?
    var canValidate: Bool?
    var blocked: String?
    var rest: Rest?

    static let idle = WatchSessionState(v: Companion.watchStateVersion, active: false)

    /// Lecture tolérante : un état illisible ou d'une version inconnue vaut « pas d'état »
    static func decode(_ json: String?) -> WatchSessionState? {
        guard let data = json?.data(using: .utf8),
              let state = try? JSONDecoder().decode(WatchSessionState.self, from: data),
              state.v == Companion.watchStateVersion else { return nil }
        return state
    }
}

/// Geste de la montre. Le JS le vérifie encore (watchActionFor) : la série visée doit être la série
/// en cours, ±15 s seulement, rien hors repos.
struct WatchAction: Codable, Equatable {
    enum Kind: String, Codable {
        case validate
        case skipRest
        case restAdjust
    }

    var type: Kind
    var ei: Int?
    var si: Int?
    var d: Int?
    /// Heure du geste, en millisecondes depuis 1970
    var at: Double

    static func validate(_ ref: WatchSessionState.SetRef) -> WatchAction {
        WatchAction(type: .validate, ei: ref.ei, si: ref.si, d: nil, at: Date().timeIntervalSince1970 * 1000)
    }
    static var skipRest: WatchAction {
        WatchAction(type: .skipRest, ei: nil, si: nil, d: nil, at: Date().timeIntervalSince1970 * 1000)
    }
    static func restAdjust(_ seconds: Int) -> WatchAction {
        WatchAction(type: .restAdjust, ei: nil, si: nil, d: seconds, at: Date().timeIntervalSince1970 * 1000)
    }

    func json() -> String? {
        guard let data = try? JSONEncoder().encode(self) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func decode(_ json: String?) -> WatchAction? {
        guard let data = json?.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(WatchAction.self, from: data)
    }

    /// Geste trop ancien (resté en file pendant que l'iPhone dormait) : ignoré
    func isFresh(now: Date = Date()) -> Bool {
        let age = now.timeIntervalSince1970 - at / 1000
        return age >= -5 && age <= Companion.actionMaxAge
    }
}

// MARK: - Widget

/// Instantané laissé par l'app pour le widget (js/features/home-widget.js, widgetSnapshot)
struct WidgetSnapshot: Codable, Equatable {
    struct Next: Codable, Equatable {
        var title: String
        var tint: String
        var exercises: Int
        /// Heure où les muscles seront reposés (ms depuis 1970), 0 : prête
        var readyAt: Double

        var readyDate: Date? { readyAt > 0 ? Date(timeIntervalSince1970: readyAt / 1000) : nil }
    }
    struct Week: Codable, Equatable {
        var count: Int
        var goal: Int
        /// Lundi → dimanche : couleur de la séance du jour, nil si rien
        var days: [String?]
        /// Début de la semaine et lundi suivant (ms depuis 1970)
        var start: Double
        var end: Double

        var endDate: Date { Date(timeIntervalSince1970: end / 1000) }
    }
    struct Active: Codable, Equatable {
        var title: String
        var tint: String
        var startedAt: Double
    }

    var v: Int
    var at: Double
    var next: Next?
    var week: Week
    var active: Active?

    static func decode(_ json: String?) -> WidgetSnapshot? {
        guard let data = json?.data(using: .utf8),
              let snap = try? JSONDecoder().decode(WidgetSnapshot.self, from: data),
              snap.v == Companion.widgetSnapshotVersion else { return nil }
        return snap
    }

    /// Dernier instantané écrit par l'app (nil : app jamais ouverte depuis l'installation du widget,
    /// ou droit de trousseau absent de la cible)
    static func load() -> WidgetSnapshot? {
        decode(SharedKeychain.read(Companion.widgetSnapshotKey))
    }
}

// MARK: - Trousseau partagé

/// Petites chaînes partagées entre l'app et son extension (Apple, « Sharing access to keychain items
/// among a collection of apps »). Lisibles après le premier déverrouillage (le widget se redessine
/// iPhone verrouillé), jamais sauvegardées ni migrées : c'est un cache que l'app réécrit.
enum SharedKeychain {
    private static let service = "com.mdlf.training.companion"

    private static func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: key,
         kSecAttrAccessGroup as String: Companion.keychainGroup]
    }

    @discardableResult
    static func write(_ value: String, for key: String) -> Bool {
        let attributes: [String: Any] = [
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(query(key) as CFDictionary, attributes as CFDictionary)
        guard status == errSecItemNotFound else { return status == errSecSuccess }
        return SecItemAdd(query(key).merging(attributes) { $1 } as CFDictionary, nil) == errSecSuccess
    }

    static func read(_ key: String) -> String? {
        var request = query(key)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
