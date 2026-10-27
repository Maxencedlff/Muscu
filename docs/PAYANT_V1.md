# Payant V1 : contrat entre l'app, le serveur et Apple

Décisions de Maxence (26/10 et 27/10/2026) :
- **essai gratuit de 3 mois**, puis **tout est payant** (pas de version gratuite limitée) ;
- **5,99 €/mois** et **41,99 €/an** ;
- après l'essai sans payer : le profil et l'historique restent **consultables**, et l'**export** reste possible ; on ne peut plus **enregistrer de nouvelle séance** ;
- **« Accès offert »** : achat non consommable **jamais proposé à la vente** dans l'app ni mis en avant, obtenu **uniquement par code promotionnel** (Maxence ne veut pas qu'on puisse acheter un accès à vie) ;
- codes d'offre d'abonnement : **1 an gratuit au maximum** ;
- le **mode coach** reste gratuit en V1 (le coach paiera plus tard, selon son nombre d'élèves) ; un **élève suivi par un coach a l'accès gratuit** tant qu'il est suivi.

**Le verrou est livré ÉTEINT.** Tant que `data.paywallOn` n'est pas activé côté serveur (`app_config.paywall_on`), l'app ne bloque rien : elle calcule l'état et l'affiche en Réglages, sans jamais empêcher une séance. On allume après validation de Maxence.

## Produits App Store Connect (créés le 28/10/2026)
| Produit | Identifiant | Type | Prix |
|---|---|---|---|
| MDLF Training mensuel | `com.mdlf.training.pro.monthly` | abonnement, 1 mois | 5,99 € |
| MDLF Training annuel | `com.mdlf.training.pro.yearly` | abonnement, 1 an | 41,99 € |
| Accès offert | `com.mdlf.training.access.gift` | non consommable | jamais vendu, codes seulement |

Groupe d'abonnement `MDLF Training Acces` (id 22520671) : les deux abonnements sont au **même niveau**, pour que l'on puisse passer de l'un à l'autre sans perdre l'accès.

## Principe de sécurité (le point le plus important)
**L'app ne décide jamais seule.** Un appareil peut être modifié : on ne fait confiance ni à son horloge, ni à son stockage.

- **Le serveur fait foi.** La table `entitlements` est la seule source de vérité, écrite uniquement par le serveur après vérification chez Apple.
- **Le début de l'essai est posé par le serveur** (`trial_started_at`, à la création du profil), jamais par l'app. Réinstaller l'app ou vider le stockage ne redonne pas d'essai.
- **Une preuve d'achat n'est jamais crue sur parole** : l'app transmet la transaction signée par Apple (JWS), et c'est l'**Edge Function** qui en vérifie la signature contre les certificats Apple, puis relit la transaction auprès de l'**App Store Server API**. Aucune RPC ne permet à un client d'écrire un droit d'accès.
- **Un abonnement ne sert qu'à un compte** : `original_transaction_id` est **unique**. Si la même transaction arrive sur un second compte, elle est refusée (`transaction_taken`), pour éviter qu'un abonnement soit partagé entre plusieurs comptes.
- **Le serveur est prévenu par Apple** (App Store Server Notifications V2) des renouvellements, annulations, remboursements et expirations : l'accès tombe tout seul, même si l'app n'est jamais rouverte.
- **Hors ligne** : l'app garde le dernier droit connu **signé par le serveur** avec une date d'expiration courte (voir plus bas). Elle ne peut pas se prolonger elle-même.

## Données (serveur)
- `entitlements (user_id pk, status, product_id, expires_at, original_transaction_id unique, trial_started_at, gift bool, in_coach_team bool, updated_at)`.
  - `status` : `trial` | `active` | `expired` | `gift` | `coach_team`.
  - RLS fermée sans politique, aucun GRANT : lecture seulement par RPC, écriture seulement par les fonctions du serveur.
- `app_config (key pk, value jsonb)` : `paywall_on` (booléen, défaut **false**), `trial_days` (défaut **90**). Lisible par `authenticated`, écrit seulement par l'administrateur.
- `user_profiles.trial_started_at` n'existe pas : l'essai vit dans `entitlements`, créé à la première lecture.

## Fonctions RPC (rôle `authenticated`)
| Fonction | Renvoie | Règles |
|---|---|---|
| `my_access()` | `jsonb` | `{ status, until, paywall_on, trial_days, days_left, can_write, gift, coach_team, server_now }`. Crée la ligne `entitlements` en `trial` au premier appel (c'est là que l'essai démarre, à l'heure du serveur). `can_write` = droit d'enregistrer une séance ; **toujours `true` tant que `paywall_on` est faux**. |
| `access_state()` | `jsonb` | Alias de lecture seule, sans rien créer (pour les écrans qui ne doivent pas démarrer l'essai). |

Aucune RPC d'écriture du droit d'accès. Les seules écritures viennent des Edge Functions.

## Edge Functions
- **`verify-purchase`** (JWT vérifié) : entrée `{ jws }` (la transaction signée rendue par StoreKit 2). Vérifie la chaîne de certificats Apple (racine Apple Root CA G3), le `bundleId`, l'environnement, puis relit la transaction par l'**App Store Server API** (`/inApps/v1/transactions/{id}`). Écrit `entitlements`. Erreurs : `invalid_jws`, `bad_bundle`, `transaction_taken`, `not_found`.
- **`appstore-notify`** (pas de JWT, vérifiée par la signature Apple) : reçoit les **App Store Server Notifications V2**. Traite `SUBSCRIBED`, `DID_RENEW`, `DID_CHANGE_RENEWAL_STATUS`, `EXPIRED`, `GRACE_PERIOD_EXPIRED`, `REFUND`, `REVOKE`. Met `entitlements` à jour. Une notification dont la signature ne vérifie pas est **rejetée en 401** et n'écrit rien.

## App
- `js/data/access.js` : lit `my_access()`, garde le dernier état connu par compte (`mdlf_access`, verrouillé par `userId`), expose `canWrite()`, `accessStatus()`, `daysLeft()`.
  - **Hors ligne** : le dernier état connu vaut **7 jours** au plus après sa lecture (`server_now`), pour qu'une salle sans réseau ne bloque personne, sans permettre de rester bloqué en « gratuit » indéfiniment. Au-delà, l'app redemande au premier réseau.
  - L'horloge de l'appareil n'est jamais utilisée pour décider : on compare les dates du serveur.
- `js/features/paywall-ui.js` : écran d'abonnement (deux formules, prix lus chez StoreKit, pas écrits en dur), bandeau « il te reste N jours », écran de fin d'essai, « Restaurer mes achats », « J'ai un code » (feuille de codes d'Apple), et le lien obligatoire vers les conditions et la confidentialité.
- **Mode lecture seule** (quand `can_write` est faux et le verrou allumé) : Historique, Progrès, profil et **export** restent ouverts ; démarrer ou enregistrer une séance propose l'abonnement. Rien n'est supprimé.
- **Réglages › Abonnement** : état en clair, date de fin, gérer l'abonnement (lien Apple), restaurer, code.

## Natif (iOS, StoreKit 2)
`ios/App/App/StorePlugin.swift`, module Capacitor `MdlfStore` :
- `products()` : les deux abonnements avec leur prix **localisé par Apple** ;
- `purchase({ productId })` : achat, puis renvoie le JWS de la transaction ;
- `restore()` : `AppStore.sync()` puis l'état courant ;
- `current()` : droits en cours (`Transaction.currentEntitlements`), avec leur JWS ;
- `redeemCode()` : ouvre la feuille de codes d'Apple ;
- **écouteur permanent** `Transaction.updates` : toute transaction (renouvellement, code utilisé, achat sur un autre appareil) est transmise au serveur, puis `finish()`.

Hors app iOS (web) : aucun achat possible, l'écran invite à utiliser l'app.

## Ce qui reste à faire par Maxence (ne peut pas être fait par l'API)
1. Signer le contrat **Paid Apps** (coordonnées bancaires et fiscales) sur App Store Connect.
2. Vérifier le statut micro-entreprise pour la vente d'applications.
3. Créer un **testeur Sandbox** pour l'essai d'achat réel.
4. Fournir l'**URL de notification** à App Store Connect (donnée par l'Edge Function) et la clé d'API **In-App Purchase** si elle diffère de la clé Admin.
