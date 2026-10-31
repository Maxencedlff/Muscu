package com.mdlf.training

import android.content.Intent
import android.net.Uri
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClient.BillingResponseCode
import com.android.billingclient.api.BillingClient.ProductType
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.android.billingclient.api.acknowledgePurchase
import com.android.billingclient.api.queryProductDetails
import com.android.billingclient.api.queryPurchasesAsync
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Abonnement MDLF Training sur Android : Google Play Billing (bibliothèque 9), pendant de
 * StorePlugin.swift (StoreKit 2, branche payant). Côté web : Capacitor.registerPlugin('MdlfStore'),
 * **mêmes méthodes** (status, products, purchase, finish, restore, current, redeemCode) et mêmes
 * événements (`transaction`, doublé en `change`) ; contrat complet dans docs/ANDROID.md.
 *
 * **Ce module ne décide jamais d'un droit d'accès.** Il récolte la preuve d'achat de Google (le
 * `purchaseToken`) et la passe au web, qui l'enverra au serveur ; seul le serveur, après avoir
 * interrogé l'API Google Play Developer (purchases.subscriptionsv2.get), écrira `entitlements`.
 * **Non branché aujourd'hui** : la fonction serveur Android n'existe pas encore (docs/ANDROID.md).
 *
 * - **Prix jamais écrits en dur** : `products()` rend le prix formaté par Google pour le pays du compte.
 * - **Accusé de réception (acknowledge) à la main du web**, comme `finish()` sur iOS : le web appelle
 *   `finish({ transactionId })` (= purchaseToken) seulement après la réponse du serveur. Différence
 *   importante avec Apple : **Google rembourse tout seul un achat non confirmé sous 3 jours.** Le
 *   serveur devra donc confirmer lui-même (purchases.subscriptions.acknowledge) ; `finish()` reste un
 *   filet, et le rattrapage du lancement (`load()`) renvoie au web tout achat non confirmé.
 * - **Achat en attente** (paiement en espèces, validation parentale) : status "pending", aucun droit ;
 *   la transaction arrive plus tard par l'écouteur, une fois payée.
 * - **« Accès offert »** (`com.mdlf.training.access.gift`, produit ponctuel) n'est **jamais achetable** :
 *   seulement obtenu par code promo Google Play et lu dans les achats en cours.
 * - Les identifiants de produits sont ceux d'App Store Connect (mêmes noms, un seul catalogue côté
 *   serveur). Chaque abonnement Play aura une offre de base (base plan) « monthly » ou « yearly ».
 */
@CapacitorPlugin(name = "MdlfStore")
class StorePlugin : Plugin(), PurchasesUpdatedListener {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var billing: BillingClient
    private var setup: CompletableDeferred<Boolean>? = null

    /** Produits lus à Google, par identifiant (nécessaires pour lancer un achat) */
    private val cachedProducts = mutableMapOf<String, ProductDetails>()
    /** Achat en cours : une seule feuille Google à la fois */
    private var purchaseCall: PluginCall? = null
    private var purchaseProductId: String? = null
    /** Jetons déjà annoncés depuis le lancement : l'écouteur et le rattrapage ne doublonnent pas */
    private val announced = mutableSetOf<String>()

    override fun load() {
        billing = BillingClient.newBuilder(context)
            .setListener(this)
            // Obligatoire depuis la bibliothèque 8 ; les abonnements n'ont pas d'achat en attente
            // au premier achat, mais les produits ponctuels (accès offert) peuvent en avoir
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            // Reconnexion automatique au service Play quand un appel arrive après une déconnexion
            .enableAutoServiceReconnection()
            .build()
        // Rattrapage unique : achats payés mais pas encore confirmés (réseau coupé, serveur en panne)
        scope.launch { catchUp() }
    }

    override fun handleOnDestroy() {
        scope.cancel()
        if (::billing.isInitialized) billing.endConnection()
        super.handleOnDestroy()
    }

    /** Connexion au service Google Play, une fois ; faux si Play est absent ou ne répond pas sous 10 s. */
    private suspend fun ready(): Boolean {
        if (billing.isReady) return true
        val pending = setup ?: CompletableDeferred<Boolean>().also { deferred ->
            setup = deferred
            billing.startConnection(object : BillingClientStateListener {
                override fun onBillingSetupFinished(result: BillingResult) {
                    deferred.complete(result.responseCode == BillingResponseCode.OK)
                    if (setup === deferred) setup = null
                }
                override fun onBillingServiceDisconnected() {
                    // Avant la fin de la mise en route : échec ; après, la reconnexion est automatique
                    deferred.complete(false)
                    if (setup === deferred) setup = null
                }
            })
        }
        return withTimeoutOrNull(10_000) { pending.await() } ?: false
    }

    private suspend fun canMakePayments(): Boolean = ready() &&
        billing.isFeatureSupported(BillingClient.FeatureType.SUBSCRIPTIONS).responseCode == BillingResponseCode.OK

    // MARK: Lecture des produits

    /** → { canMakePayments, subscriptionIds, giftId }. Ne lit pas les produits. */
    @PluginMethod
    fun status(call: PluginCall) {
        scope.launch {
            call.resolve(JSObject()
                .put("canMakePayments", canMakePayments())
                .put("subscriptionIds", JSArray(SUBSCRIPTION_IDS))
                .put("giftId", GIFT_ID))
        }
    }

    /**
     * → { products, missing, canMakePayments }. `missing` : abonnements que Google n'a pas rendus
     * (pas encore actifs dans la Play Console, app pas installée depuis Play) : l'écran d'abonnement
     * doit le dire plutôt que d'inventer un prix.
     */
    @PluginMethod
    fun products(call: PluginCall) {
        scope.launch {
            if (!ready()) { call.reject("Google Play indisponible", "PRODUCTS_FAILED"); return@launch }
            val params = QueryProductDetailsParams.newBuilder().setProductList(SUBSCRIPTION_IDS.map {
                QueryProductDetailsParams.Product.newBuilder().setProductId(it).setProductType(ProductType.SUBS).build()
            }).build()
            val result = billing.queryProductDetails(params)
            if (result.billingResult.responseCode != BillingResponseCode.OK) {
                call.reject("Produits indisponibles : ${result.billingResult.debugMessage}", "PRODUCTS_FAILED")
                return@launch
            }
            val fetched = result.productDetailsList.orEmpty()
            fetched.forEach { cachedProducts[it.productId] = it }
            val list = JSArray()
            // Ordre de PAYANT_V1.md (mensuel, annuel), pas celui de Google
            for (id in SUBSCRIPTION_IDS) fetched.firstOrNull { it.productId == id }?.let { describe(it)?.let { d -> list.put(d) } }
            val missing = SUBSCRIPTION_IDS.filter { id -> fetched.none { it.productId == id } }
            call.resolve(JSObject()
                .put("products", list)
                .put("missing", JSArray(missing))
                .put("canMakePayments", canMakePayments()))
        }
    }

    // MARK: Achat

    /**
     * { productId, appAccountToken? } → { status } : "success" (avec la transaction), "pending",
     * "userCancelled", "unknown". appAccountToken (identifiant du compte MDLF, comme sur iOS) part chez
     * Google en obfuscatedAccountId : le serveur vérifiera que l'achat appartient bien à ce compte.
     */
    @PluginMethod
    fun purchase(call: PluginCall) {
        val productId = call.getString("productId")
        if (productId == null || productId !in SUBSCRIPTION_IDS) { call.reject("Produit inconnu", "UNKNOWN_PRODUCT"); return }
        if (purchaseCall != null) { call.reject("Un achat est déjà en cours", "PURCHASE_IN_PROGRESS"); return }
        val activity = activity ?: run { call.reject("App au second plan", "PURCHASE_FAILED"); return }
        scope.launch {
            if (!ready()) { call.reject("Google Play indisponible", "PURCHASE_FAILED"); return@launch }
            val product = cachedProducts[productId] ?: run { call.reject("Produits pas encore lus", "PRODUCTS_FAILED"); return@launch }
            val offer = chooseOffer(product) ?: run { call.reject("Aucune offre pour ce produit", "PRODUCTS_FAILED"); return@launch }
            val flow = BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(
                BillingFlowParams.ProductDetailsParams.newBuilder()
                    .setProductDetails(product)
                    .setOfferToken(offer.offerToken)
                    .build(),
            ))
            call.getString("appAccountToken")?.take(64)?.let { flow.setObfuscatedAccountId(it) }
            purchaseCall = call
            purchaseProductId = productId
            val launched = billing.launchBillingFlow(activity, flow.build())
            if (launched.responseCode != BillingResponseCode.OK) {
                purchaseCall = null
                purchaseProductId = null
                call.resolve(JSObject().put("status", if (launched.responseCode == BillingResponseCode.USER_CANCELED) "userCancelled" else "unknown")
                    .put("reason", launched.debugMessage))
            }
            // Sinon la réponse arrive par onPurchasesUpdated
        }
    }

    /** Résultat de la feuille Google, et achats arrivés hors de l'app (renouvellement, code, autre appareil). */
    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        scope.launch {
            val call = purchaseCall
            val wanted = purchaseProductId
            purchaseCall = null
            purchaseProductId = null
            val mine = purchases?.firstOrNull { wanted != null && wanted in it.products }
            purchases?.forEach { announce(it, if (it === mine) "purchase" else "update") }
            if (call == null) return@launch
            when {
                result.responseCode == BillingResponseCode.USER_CANCELED -> call.resolve(JSObject().put("status", "userCancelled"))
                result.responseCode == BillingResponseCode.OK && mine != null -> when (mine.purchaseState) {
                    Purchase.PurchaseState.PURCHASED -> call.resolve(describe(mine).put("status", "success"))
                    Purchase.PurchaseState.PENDING -> call.resolve(JSObject().put("status", "pending"))
                    else -> call.resolve(JSObject().put("status", "unknown"))
                }
                // Déjà abonné (autre appareil, même compte Google) : le web relit les achats en cours
                result.responseCode == BillingResponseCode.ITEM_ALREADY_OWNED ->
                    call.resolve(JSObject().put("status", "unknown").put("reason", "alreadyOwned"))
                else -> call.resolve(JSObject().put("status", "unknown").put("reason", result.debugMessage))
            }
        }
    }

    /**
     * { transactionId } (le purchaseToken) → { finished }. À n'appeler qu'après la réponse du serveur.
     * Déjà confirmé (par le serveur, ce qui sera le cas normal) : finished vrai sans rien faire.
     */
    @PluginMethod
    fun finish(call: PluginCall) {
        val token = call.getString("transactionId")
        if (token.isNullOrEmpty()) { call.reject("transactionId manquant"); return }
        scope.launch {
            if (!ready()) { call.resolve(JSObject().put("finished", false).put("reason", "unavailable")); return@launch }
            val purchase = activePurchases().firstOrNull { it.purchaseToken == token }
                ?: run { call.resolve(JSObject().put("finished", false).put("reason", "notFound")); return@launch }
            if (purchase.isAcknowledged) { call.resolve(JSObject().put("finished", true)); return@launch }
            if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) {
                call.resolve(JSObject().put("finished", false).put("reason", "pending")); return@launch
            }
            val ack = billing.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(token).build())
            call.resolve(JSObject().put("finished", ack.responseCode == BillingResponseCode.OK))
        }
    }

    /**
     * → { synced, cancelled, entitlements, unverified }. Google Play tient les achats à jour tout seul :
     * « Restaurer » relit simplement les achats en cours (pas de fenêtre de connexion comme sur iOS).
     */
    @PluginMethod
    fun restore(call: PluginCall) {
        scope.launch {
            if (!ready()) { call.reject("Google Play indisponible", "RESTORE_FAILED"); return@launch }
            call.resolve(entitlements().put("synced", true).put("cancelled", false))
        }
    }

    /** → { entitlements, unverified } : achats payés en cours (abonnements actifs, accès offert). */
    @PluginMethod
    fun current(call: PluginCall) {
        scope.launch {
            if (!ready()) { call.reject("Google Play indisponible", "CURRENT_FAILED"); return@launch }
            call.resolve(entitlements())
        }
    }

    /**
     * Code promo : Google n'a pas de feuille dans l'app ; la page « Utiliser un code » du Play Store
     * s'ouvre, et l'achat qui en résulte arrive par l'écouteur au retour dans l'app.
     */
    @PluginMethod
    fun redeemCode(call: PluginCall) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/redeem")).apply {
            setPackage("com.android.vending")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(intent)
            call.resolve(JSObject().put("presented", true))
        } catch (e: Exception) {
            call.resolve(JSObject().put("presented", false).put("reason", "noPlayStore"))
        }
    }

    // MARK: Interne

    private suspend fun catchUp() {
        if (!ready()) return
        activePurchases().filter { it.purchaseState == Purchase.PurchaseState.PURCHASED && !it.isAcknowledged }
            .forEach { announce(it, "unfinished") }
    }

    /** Abonnements puis produits ponctuels en cours (Google ne rend que les achats actifs) */
    private suspend fun activePurchases(): List<Purchase> {
        val subs = billing.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(ProductType.SUBS).build())
        val inapp = billing.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(ProductType.INAPP).build())
        return listOf(subs, inapp).filter { it.billingResult.responseCode == BillingResponseCode.OK }
            .flatMap { it.purchasesList }
    }

    private suspend fun entitlements(): JSObject {
        val list = JSArray()
        activePurchases().filter { p -> p.purchaseState == Purchase.PurchaseState.PURCHASED && p.products.any { it in KNOWN_IDS } }
            .forEach { list.put(describe(it)) }
        // Pas de vérification de signature dans l'app : elle est faite par le serveur (API Google)
        return JSObject().put("entitlements", list).put("unverified", 0)
    }

    private fun announce(purchase: Purchase, source: String) {
        if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) return
        if (!announced.add(purchase.purchaseToken)) return
        val payload = describe(purchase).put("source", source)
        notifyListeners("transaction", payload, true)
        notifyListeners("change", payload, true)
    }

    /**
     * Offre proposée à l'achat : l'essai gratuit si Google en propose un à ce compte (il ne rend que
     * les offres auxquelles l'utilisateur a droit), sinon l'offre de base. Seule règle, la plus simple.
     */
    private fun chooseOffer(product: ProductDetails): ProductDetails.SubscriptionOfferDetails? {
        val offers = product.subscriptionOfferDetails.orEmpty()
        return offers.firstOrNull { o -> o.pricingPhases.pricingPhaseList.any { it.priceAmountMicros == 0L } }
            ?: offers.firstOrNull { it.offerId == null }
            ?: offers.firstOrNull()
    }

    private fun describe(product: ProductDetails): JSObject? {
        val offer = chooseOffer(product) ?: return null
        val phases = offer.pricingPhases.pricingPhaseList
        val regular = phases.lastOrNull() ?: return null   // la dernière phase est le prix récurrent
        val out = JSObject()
            .put("id", product.productId)
            .put("displayName", product.name)
            .put("description", product.description)
            .put("displayPrice", regular.formattedPrice)
            .put("price", regular.priceAmountMicros / 1_000_000.0)
            .put("currency", regular.priceCurrencyCode)
            .put("period", period(regular.billingPeriod))
            .put("basePlanId", offer.basePlanId)
        phases.firstOrNull { it.priceAmountMicros == 0L }?.let { trial ->
            out.put("introductoryOffer", JSObject()
                .put("displayPrice", trial.formattedPrice)
                .put("price", 0)
                .put("paymentMode", "freeTrial")
                .put("period", period(trial.billingPeriod))
                .put("periodCount", maxOf(1, trial.billingCycleCount)))
        }
        return out
    }

    private fun describe(purchase: Purchase): JSObject {
        val productId = purchase.products.firstOrNull().orEmpty()
        return JSObject()
            .put("platform", "android")
            // Preuve à envoyer au serveur (l'équivalent du jws d'Apple)
            .put("purchaseToken", purchase.purchaseToken)
            .put("transactionId", purchase.purchaseToken)
            .put("orderId", purchase.orderId)
            .put("packageName", purchase.packageName)
            .put("productId", productId)
            .put("purchasedAt", purchase.purchaseTime.toDouble())
            .put("acknowledged", purchase.isAcknowledged)
            .put("autoRenewing", purchase.isAutoRenewing)
            .put("appAccountToken", purchase.accountIdentifiers?.obfuscatedAccountId)
            .put("subscription", productId in SUBSCRIPTION_IDS)
            .put("gift", productId == GIFT_ID)
    }

    /** "P1M" → { unit: "month", value: 1 } (forme ISO 8601 de Google, même forme que l'iOS) */
    private fun period(iso: String): JSObject {
        val m = Regex("^P(\\d+)([DWMY])$").find(iso)
        val unit = when (m?.groupValues?.get(2)) { "D" -> "day"; "W" -> "week"; "M" -> "month"; "Y" -> "year"; else -> "unknown" }
        return JSObject().put("unit", unit).put("value", m?.groupValues?.get(1)?.toIntOrNull() ?: 0)
    }

    companion object {
        /** Les deux abonnements vendus, dans l'ordre d'affichage (PAYANT_V1.md) */
        val SUBSCRIPTION_IDS = listOf("com.mdlf.training.pro.monthly", "com.mdlf.training.pro.yearly")
        /** « Accès offert » : produit ponctuel obtenu seulement par code, jamais mis en vente */
        const val GIFT_ID = "com.mdlf.training.access.gift"
        val KNOWN_IDS = SUBSCRIPTION_IDS.toSet() + GIFT_ID
    }
}
