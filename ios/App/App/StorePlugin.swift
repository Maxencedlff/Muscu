import Foundation
import UIKit
import Capacitor
import StoreKit

/// Abonnement MDLF Training : achats dans l'app par StoreKit 2 (docs/PAYANT_V1.md).
/// Côté web : Capacitor.registerPlugin('MdlfStore') (js/platform/native.js, Native.store), utilisé par
/// js/features/paywall-ui.js et js/data/access.js. Hors app iOS, aucun achat n'est possible.
///
/// **Ce module ne décide jamais d'un droit d'accès.** Il ne fait que récolter des preuves signées par
/// Apple (JWS) et les passer au web, qui les envoie à l'Edge Function `verify-purchase` ; c'est le
/// serveur qui écrit `entitlements`. Rien ici n'est une source de vérité : ni les dates, ni l'état.
///
/// - **Prix jamais écrits en dur** : `products()` rend le `displayPrice` d'Apple, déjà formaté pour la
///   boutique (devise et locale) de l'utilisateur, plus la période et l'éventuelle offre d'essai.
/// - **Toute transaction passe par `VerificationResult`** : une transaction `.unverified` (signature
///   d'Apple invalide, appareil modifié) est **refusée**, jamais transmise au web, et **jamais finie** —
///   StoreKit la représentera, et une preuve non signée ne doit pas atteindre le serveur.
/// - **`finish()` est à la main du web** : `purchase()` et l'écouteur rendent le JWS **sans** finir la
///   transaction ; le web appelle `finish({ transactionId })` seulement après que `verify-purchase` a
///   répondu. C'est voulu : une transaction non finie est redonnée par StoreKit au lancement suivant
///   (`Transaction.unfinished`), donc un achat encaissé par Apple mais perdu par le réseau ou par un
///   serveur en panne finit toujours par arriver. Si le web ne finissait jamais, la seule conséquence
///   serait un renvoi au prochain lancement : le serveur est idempotent (`original_transaction_id`
///   unique), rien n'est encaissé deux fois.
/// - **Écouteur permanent** (`load()`) : `Transaction.updates` tourne tant que l'app vit et prévient le
///   web de **tout** : renouvellement mensuel ou annuel, code utilisé, achat fait sur un autre iPhone,
///   « Demander la permission d'acheter » accordée plus tard, remboursement. Sans lui, un renouvellement
///   passerait inaperçu jusqu'à ce qu'Apple prévienne le serveur. Au lancement, `Transaction.unfinished`
///   est parcouru une fois en plus, pour rattraper ce qui n'a pas pu être envoyé la fois précédente.
///   L'événement s'appelle `transaction`, doublé en `change` (nom utilisé par les autres modules MDLF) ;
///   `retainUntilConsumed` le garde si le web n'est pas encore abonné (lancement, rechargement de la vue).
/// - **Produits vendus** : les dix abonnements (particulier et paliers coach, même groupe) et, depuis le
///   payant plus (31/10/2026), l'**accès à vie** `com.mdlf.training.lifetime`, achat non consommable hors
///   du groupe. `purchase()` refuse tout autre identifiant, et seuls ces produits sont lus dans les droits
///   en cours. L'ancien « Accès offert » (non consommable) a été supprimé (modèle B) et n'y revient pas. L'essai gratuit de 3 mois est l'**offre de lancement d'Apple** sur ces
///   abonnements : `products()` rend `introEligible` et `offer` (lus chez StoreKit), et c'est Apple qui
///   garantit un seul essai par identifiant Apple. La feuille de `redeemCode()` est celle des **codes
///   d'offre d'abonnement** ; la transaction qui en résulte arrive ici par l'écouteur.
/// - **Environnement** (`environment()`, payant plus) : `AppTransaction.shared` dit si l'app tourne en
///   Production (App Store) ou en Sandbox (TestFlight, Xcode avec un compte Sandbox), pour que le web
///   demande au serveur un code d'offre élève du bon environnement. Lecture sans aucune fenêtre :
///   `AppTransaction.refresh()`, qui demande le mot de passe Apple, n'est jamais appelé. Ce n'est pas une
///   preuve d'achat et rien ne s'en sert pour ouvrir un accès.
///
/// Cible de compilation iOS 16.4 (projet Xcode) : tout StoreKit 2 est disponible et
/// `AppStore.presentOfferCodeRedeemSheet(in:)` (iOS 16+) suffit — le repli
/// `SKPaymentQueue.presentCodeRedemptionSheet()`, nécessaire sous iOS 16 et **déprécié depuis iOS 18**,
/// n'a pas lieu d'être. `Transaction.reason` (iOS 17+) est le seul point protégé par une disponibilité.
@objc(StorePlugin)
public class StorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StorePlugin"
    public let jsName = "MdlfStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "products", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "current", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "redeemCode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "environment", returnType: CAPPluginReturnPromise),
    ]

    /// Les abonnements vendus, tous dans le même groupe d'App Store Connect (PAYANT_V1.md) : le
    /// particulier, puis les quatre paliers coach (10, 20, 30 élèves, illimité), mensuel et annuel.
    /// L'app ne montre les paliers coach qu'à un coach validé ; l'ordre ici est celui de l'affichage.
    private static let subscriptionIds = ["com.mdlf.training.pro.monthly",
                                          "com.mdlf.training.pro.yearly",
                                          "com.mdlf.training.coach10.monthly",
                                          "com.mdlf.training.coach10.yearly",
                                          "com.mdlf.training.coach20.monthly",
                                          "com.mdlf.training.coach20.yearly",
                                          "com.mdlf.training.coach30.monthly",
                                          "com.mdlf.training.coach30.yearly",
                                          "com.mdlf.training.coachmax.monthly",
                                          "com.mdlf.training.coachmax.yearly"]
    /// Accès à vie (payant plus) : achat non consommable, hors du groupe d'abonnements, sans date de fin.
    /// Le serveur le reconnaît (nature `life`) ; un achat Sandbox (TestFlight) n'y vaut que 7 jours.
    private static let lifetimeIds = ["com.mdlf.training.lifetime"]
    /// Tout ce que l'app vend, dans l'ordre d'affichage
    private static let soldIds = subscriptionIds + lifetimeIds

    /// Protège le cache des produits, les transactions à finir et les identifiants déjà annoncés.
    /// Ces trois tables sont touchées depuis l'écouteur, depuis le fil principal (achat) et depuis les
    /// tâches de lecture : un verrou plutôt qu'une file, comme LiveActivityPlugin.
    private let lock = NSLock()
    private var cachedProducts: [String: Product] = [:]
    /// Transactions vérifiées déjà transmises au web et pas encore finies, par identifiant
    private var pending: [String: StoreKit.Transaction] = [:]
    /// Identifiants déjà annoncés depuis le lancement : ni l'écouteur ni le rattrapage ne doublonnent
    private var announced: Set<String> = []
    private var updatesTask: Task<Void, Never>?
    private var catchUpTask: Task<Void, Never>?

    // MARK: Écouteur permanent

    /// Démarré au chargement du module, donc au lancement de l'app, avant tout appel du web : une
    /// transaction arrivée pendant que l'app était fermée ne doit pas être manquée.
    override public func load() {
        updatesTask = Task { [weak self] in
            for await result in StoreKit.Transaction.updates {
                guard let self = self else { return }
                self.announce(result, source: "update")
            }
        }
        // Rattrapage unique : ce que le web n'a pas réussi à envoyer au serveur la fois précédente
        catchUpTask = Task { [weak self] in
            for await result in StoreKit.Transaction.unfinished {
                guard let self = self else { return }
                self.announce(result, source: "unfinished")
            }
        }
    }

    deinit {
        updatesTask?.cancel()
        catchUpTask?.cancel()
    }

    /// Transmet une transaction vérifiée au web. Une transaction non vérifiée est jetée (et laissée
    /// non finie) : le serveur ne doit jamais voir une preuve que StoreKit n'a pas validée.
    private func announce(_ result: VerificationResult<StoreKit.Transaction>, source: String) {
        guard let transaction = Self.verified(result) else {
            CAPLog.print("MdlfStore : transaction non vérifiée par StoreKit, ignorée")
            return
        }
        let key = String(transaction.id)
        lock.lock()
        pending[key] = transaction
        let isNew = announced.insert(key).inserted
        lock.unlock()
        guard isNew else { return }
        var payload = Self.describe(transaction, jws: result.jwsRepresentation)
        payload["source"] = source
        notifyListeners("transaction", data: payload, retainUntilConsumed: true)
        notifyListeners("change", data: payload, retainUntilConsumed: true)
    }

    // MARK: Lecture des produits

    /// → { products: [...], missing: [identifiants qu'Apple n'a pas rendus], canMakePayments }.
    /// `missing` n'est pas vide quand un produit n'est pas encore « Prêt à être envoyé » dans App Store
    /// Connect, ou que le contrat Paid Apps n'est pas signé : l'écran d'abonnement doit alors le dire
    /// plutôt que d'afficher un prix inventé.
    @objc func products(_ call: CAPPluginCall) {
        Task {
            do {
                let fetched = try await Product.products(for: Self.soldIds)
                self.cache(fetched)
                // L'ordre d'Apple n'est pas garanti : on garde celui de PAYANT_V1.md (mensuel, annuel)
                var list: [[String: Any]] = []
                for id in Self.soldIds {
                    guard let product = fetched.first(where: { $0.id == id }) else { continue }
                    list.append(await Self.describe(product))
                }
                let missing = Self.soldIds.filter { id in !fetched.contains { $0.id == id } }
                call.resolve(["products": list,
                              "missing": missing,
                              "canMakePayments": AppStore.canMakePayments])
            } catch {
                call.reject("Produits indisponibles : \(error.localizedDescription)", "PRODUCTS_FAILED")
            }
        }
    }

    /// → { canMakePayments, subscriptionIds } sans aucun appel réseau. canMakePayments est faux
    /// quand les achats sont bloqués (Temps d'écran, profil de gestion) : l'écran ne doit rien proposer.
    @objc func status(_ call: CAPPluginCall) {
        call.resolve(["canMakePayments": AppStore.canMakePayments,
                      "subscriptionIds": Self.subscriptionIds,
                      "lifetimeIds": Self.lifetimeIds])
    }

    // MARK: Achat

    /// { productId, appAccountToken? } → { status } et, si status vaut "success", la transaction vérifiée
    /// avec son `jws`. Les trois issues de StoreKit sont rendues sans erreur :
    /// - "success" : la transaction est là, à envoyer à `verify-purchase`, puis `finish()` ;
    /// - "userCancelled" : feuille d'Apple fermée, il n'y a rien à faire ;
    /// - "pending" : « Demander la permission d'acheter » ou validation bancaire — la transaction
    ///   arrivera plus tard par l'écouteur `transaction`, l'écran doit juste le dire.
    /// Un vrai problème (réseau, produit absent, preuve non vérifiée) est un rejet, avec un code.
    /// `appAccountToken` : l'identifiant du compte MDLF (UUID Supabase), qu'Apple rend ensuite dans la
    /// transaction et dans ses notifications au serveur. Facultatif, mais il aide à rattacher un achat au
    /// bon compte ; un UUID invalide est un rejet, pour ne pas perdre le lien en silence.
    @objc func purchase(_ call: CAPPluginCall) {
        guard let productId = call.getString("productId"), !productId.isEmpty else {
            call.reject("Identifiant de produit manquant", "BAD_PRODUCT"); return
        }
        // Rien d'autre que les abonnements et l'accès à vie n'est vendu
        guard Self.soldIds.contains(productId) else {
            call.reject("Produit non vendu dans l'app", "BAD_PRODUCT"); return
        }
        var options: Set<Product.PurchaseOption> = []
        if let raw = call.getString("appAccountToken"), !raw.isEmpty {
            guard let token = UUID(uuidString: raw) else {
                call.reject("appAccountToken n'est pas un UUID", "BAD_TOKEN"); return
            }
            options.insert(.appAccountToken(token))
        }
        // purchase(options:) est @MainActor : c'est iOS qui présente la feuille de paiement
        Task { @MainActor in
            do {
                guard let product = try await self.product(productId) else {
                    call.reject("Produit introuvable sur l'App Store", "BAD_PRODUCT"); return
                }
                switch try await product.purchase(options: options) {
                case .success(let result):
                    guard let transaction = Self.verified(result) else {
                        call.reject("Transaction non vérifiée par StoreKit", "UNVERIFIED"); return
                    }
                    let key = String(transaction.id)
                    self.lock.lock()
                    self.pending[key] = transaction
                    // Marquée annoncée : c'est cette réponse qui la porte, l'écouteur ne la doublonne pas
                    self.announced.insert(key)
                    self.lock.unlock()
                    var payload = Self.describe(transaction, jws: result.jwsRepresentation)
                    payload["status"] = "success"
                    call.resolve(payload)
                case .pending:
                    call.resolve(["status": "pending"])
                case .userCancelled:
                    call.resolve(["status": "userCancelled"])
                @unknown default:
                    call.resolve(["status": "unknown"])
                }
            } catch StoreKitError.userCancelled {
                call.resolve(["status": "userCancelled"])
            } catch {
                call.reject("Achat impossible : \(error.localizedDescription)", "PURCHASE_FAILED")
            }
        }
    }

    /// { transactionId } → { finished }. À appeler **seulement** quand le serveur a accepté le JWS.
    /// Une transaction inconnue répond { finished: false, reason: "notFound" } sans être une erreur :
    /// soit elle est déjà finie, soit l'app a redémarré depuis et StoreKit ne l'a pas encore redonnée —
    /// l'écouteur la représentera (`Transaction.unfinished` au lancement) et le web rejouera l'envoi.
    @objc func finish(_ call: CAPPluginCall) {
        guard let id = call.getString("transactionId"), !id.isEmpty else {
            call.reject("transactionId manquant", "BAD_TRANSACTION"); return
        }
        lock.lock()
        let target = pending[id]
        lock.unlock()
        guard let transaction = target else {
            call.resolve(["finished": false, "reason": "notFound"]); return
        }
        Task {
            await transaction.finish()
            self.lock.lock()
            self.pending.removeValue(forKey: id)
            self.lock.unlock()
            call.resolve(["finished": true])
        }
    }

    // MARK: Restauration et droits en cours

    /// → { synced, cancelled, entitlements, unverified }. `AppStore.sync()` demande le mot de passe du
    /// compte Apple : à n'appeler que sur « Restaurer mes achats ». Fermer cette fenêtre n'est pas une
    /// erreur : les droits déjà connus de StoreKit sont rendus quand même (cancelled: true).
    @objc func restore(_ call: CAPPluginCall) {
        Task { @MainActor in
            var cancelled = false
            do {
                try await AppStore.sync()
            } catch StoreKitError.userCancelled {
                cancelled = true
            } catch {
                call.reject("Restauration impossible : \(error.localizedDescription)", "RESTORE_FAILED")
                return
            }
            let found = await Self.entitlements()
            call.resolve(["synced": !cancelled,
                          "cancelled": cancelled,
                          "entitlements": found.list,
                          "unverified": found.unverified])
        }
    }

    /// → { entitlements, unverified } : les droits en cours (`Transaction.currentEntitlements`) avec le
    /// JWS de chacun, sans rien demander au réseau ni à l'utilisateur. `unverified` compte les
    /// transactions refusées faute de signature valable (0 sur un appareil sain).
    @objc func current(_ call: CAPPluginCall) {
        Task {
            let found = await Self.entitlements()
            call.resolve(["entitlements": found.list, "unverified": found.unverified])
        }
    }

    /// Droits en cours : abonnement actif (ou en période de grâce) et accès à vie acheté. Les droits
    /// révoqués (remboursement, retrait du partage familial) et les produits inconnus sont écartés.
    private static func entitlements() async -> (list: [[String: Any]], unverified: Int) {
        var list: [[String: Any]] = []
        var refused = 0
        for await result in StoreKit.Transaction.currentEntitlements {
            guard let transaction = verified(result) else { refused += 1; continue }
            guard soldIds.contains(transaction.productID), transaction.revocationDate == nil else { continue }
            list.append(describe(transaction, jws: result.jwsRepresentation))
        }
        return (list, refused)
    }

    // MARK: Environnement

    /// → { environment: "production" | "sandbox" | "other" | "unknown" }. TestFlight tourne toujours en
    /// Sandbox : c'est ainsi que le web reconnaît une build TestFlight (code d'offre élève de Sandbox).
    /// `AppTransaction.shared` ne montre aucune fenêtre (contrairement à `refresh()`) ; s'il échoue
    /// (hors ligne au tout premier lancement, signature non vérifiée), la réponse est "unknown" et le web
    /// garde la Production. Aucune décision d'accès n'en dépend.
    @objc func environment(_ call: CAPPluginCall) {
        Task {
            do {
                switch try await AppTransaction.shared {
                case .verified(let app):
                    call.resolve(["environment": Self.name(app.environment)])
                case .unverified:
                    call.resolve(["environment": "unknown"])
                }
            } catch {
                call.resolve(["environment": "unknown"])
            }
        }
    }

    // MARK: Codes d'Apple

    /// Ouvre la feuille de codes d'offre d'abonnement d'iOS (« J'ai un code »). Apple interdit toute
    /// saisie maison : le code n'est jamais lu par l'app. La transaction qui en résulte arrive par
    /// l'écouteur `transaction`, pas par cette réponse — `presented` dit seulement que la feuille s'est
    /// ouverte. Mac Catalyst lèverait StoreKitError.unknown ; l'app est iPhone uniquement.
    @objc func redeemCode(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard let scene = self.windowScene() else {
                call.reject("Fenêtre indisponible", "NO_SCENE"); return
            }
            do {
                try await AppStore.presentOfferCodeRedeemSheet(in: scene)
                call.resolve(["presented": true])
            } catch StoreKitError.userCancelled {
                call.resolve(["presented": false, "cancelled": true])
            } catch {
                call.reject("Feuille de codes indisponible : \(error.localizedDescription)", "REDEEM_FAILED")
            }
        }
    }

    /// Scène de la vue web ; au cas où elle ne serait pas encore dans une fenêtre, la scène active
    @MainActor private func windowScene() -> UIWindowScene? {
        if let scene = bridge?.viewController?.view.window?.windowScene { return scene }
        return UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
    }

    // MARK: Outils

    /// **Seule porte d'entrée d'une transaction** : nil si StoreKit n'a pas vérifié la signature d'Apple
    private static func verified(_ result: VerificationResult<StoreKit.Transaction>) -> StoreKit.Transaction? {
        switch result {
        case .verified(let transaction): return transaction
        case .unverified: return nil
        }
    }

    private func cache(_ products: [Product]) {
        lock.lock()
        for product in products { cachedProducts[product.id] = product }
        lock.unlock()
    }

    /// Produit du cache, sinon demandé à l'App Store (un achat ne doit pas dépendre d'un `products()`
    /// appelé avant, par exemple après un rechargement de la vue web)
    private func product(_ id: String) async throws -> Product? {
        lock.lock()
        let cached = cachedProducts[id]
        lock.unlock()
        if let cached = cached { return cached }
        let fetched = try await Product.products(for: [id])
        cache(fetched)
        return fetched.first { $0.id == id }
    }

    /// Un produit pour le web : prix et nom **localisés par Apple**, et pour un abonnement la période et
    /// l'offre d'essai s'il y en a une et que l'utilisateur y a droit. L'accès à vie (non consommable)
    /// n'a ni période ni essai. Aucun prix n'est écrit dans le code.
    private static func describe(_ product: Product) async -> [String: Any] {
        var out: [String: Any] = [
            "id": product.id,
            "displayName": product.displayName,
            "description": product.description,
            "displayPrice": product.displayPrice,
            "price": NSDecimalNumber(decimal: product.price).doubleValue,
            "currency": product.priceFormatStyle.currencyCode,
        ]
        guard let subscription = product.subscription else { return out }
        out["period"] = describe(subscription.subscriptionPeriod)
        // Vrai si l'utilisateur n'a jamais eu d'offre d'introduction dans le groupe d'abonnement
        let eligible = await subscription.isEligibleForIntroOffer
        out["introEligible"] = eligible
        // Offre de lancement d'App Store Connect : c'est L'essai gratuit de 3 mois de l'app (modèle B,
        // docs/PAYANT_V1.md) ; rendue seulement si Apple l'accorde encore à cet identifiant Apple.
        if eligible, let offer = subscription.introductoryOffer {
            let described: [String: Any] = [
                "displayPrice": offer.displayPrice,
                "price": NSDecimalNumber(decimal: offer.price).doubleValue,
                "paymentMode": name(offer.paymentMode),
                "period": describe(offer.period),
                "periodCount": offer.periodCount,
            ]
            out["offer"] = described
        }
        return out
    }

    private static func describe(_ period: Product.SubscriptionPeriod) -> [String: Any] {
        let unit: String
        switch period.unit {
        case .day: unit = "day"
        case .week: unit = "week"
        case .month: unit = "month"
        case .year: unit = "year"
        default: unit = "unknown"
        }
        return ["unit": unit, "value": period.value]
    }

    private static func name(_ mode: Product.SubscriptionOffer.PaymentMode) -> String {
        if mode == .freeTrial { return "freeTrial" }
        if mode == .payAsYouGo { return "payAsYouGo" }
        if mode == .payUpFront { return "payUpFront" }
        return "unknown"
    }

    /// Une transaction vérifiée pour le web, avec son JWS (c'est lui que le serveur vérifie, l'app ne
    /// fait que le porter). Les identifiants partent en texte : ce sont des entiers 64 bits, que le JSON
    /// de la vue web arrondirait. Les dates sont en millisecondes depuis 1970, comme les autres modules.
    private static func describe(_ transaction: StoreKit.Transaction, jws: String) -> [String: Any] {
        var out: [String: Any] = [
            "jws": jws,
            "transactionId": String(transaction.id),
            "originalTransactionId": String(transaction.originalID),
            "productId": transaction.productID,
            "purchasedAt": transaction.purchaseDate.timeIntervalSince1970 * 1000,
            "expiresAt": ms(transaction.expirationDate),
            "revokedAt": ms(transaction.revocationDate),
            "isUpgraded": transaction.isUpgraded,
            "familyShared": transaction.ownershipType == .familyShared,
            "environment": name(transaction.environment),
            "subscription": subscriptionIds.contains(transaction.productID),
            "lifetime": lifetimeIds.contains(transaction.productID),
        ]
        // Renouvellement automatique ou achat : indisponible avant iOS 17, le web s'en passe
        if #available(iOS 17.0, *) {
            out["reason"] = transaction.reason == .renewal ? "renewal" : "purchase"
        }
        return out
    }

    private static func name(_ environment: AppStore.Environment) -> String {
        if environment == .production { return "production" }
        if environment == .sandbox { return "sandbox" }
        return "other"   // .xcode (fichier de configuration StoreKit) ou un cas futur
    }

    /// Millisecondes depuis 1970, ou null pour le web
    private static func ms(_ date: Date?) -> Any {
        guard let date = date else { return NSNull() }
        return date.timeIntervalSince1970 * 1000
    }
}
