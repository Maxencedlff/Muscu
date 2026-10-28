# Payant V1 : contrat entre l'app, le serveur et Apple

Décisions de Maxence (26/10 et 27/10/2026) :
- **essai gratuit de 3 mois**, puis **tout est payant** (pas de version gratuite limitée) ;
- **5,99 €/mois** et **41,99 €/an** ;
- après l'essai sans payer : le profil et l'historique restent **consultables**, et l'**export** reste possible ; on ne peut plus **enregistrer de nouvelle séance** ;
- **« Accès offert »** : achat non consommable **jamais proposé à la vente** dans l'app ni mis en avant (Maxence ne veut pas qu'on puisse acheter un accès à vie) ;
- **codes cadeaux maison** (ajout du 28/10) : les codes promotionnels d'Apple sont limités à 100 par version, expirent au bout de 28 jours et se saisissent dans l'App Store, pas dans l'app. Inutilisables pour ce que Maxence veut en faire : les codes cadeaux sont donc faits par notre serveur (voir « Codes cadeaux maison ») ;
- codes d'offre d'abonnement : **1 an gratuit au maximum** ;
- **essai rattaché à l'identifiant Apple** (ajout du 28/10 au soir) : une nouvelle adresse e-mail ne redonne plus 3 mois ; voir « Essai rattaché à l'identifiant Apple » ;
- **compte obligatoire pour enregistrer une séance quand le verrou est allumé** (ajout du 28/10 au soir) ; verrou éteint, rien ne change ; Historique, Progrès et **export** restent toujours ouverts, avec ou sans compte ;
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
- **Un remboursé le reste, sauf réabonnement réel** : `revoked_at` n'est levé que par un évènement à la fois **plus récent** et portant une période **strictement plus lointaine**. Apple garde la même `originalTransactionId` au réabonnement, donc un client remboursé qui repaie retrouve son accès tout seul ; un évènement en retard, rejoué, de même période ou sans date ne rouvre rien.
- **Le serveur est prévenu par Apple** (App Store Server Notifications V2) des renouvellements, annulations, remboursements et expirations : l'accès tombe tout seul, même si l'app n'est jamais rouverte.
- **Hors ligne** : l'app garde le dernier droit connu **signé par le serveur** avec une date d'expiration courte (voir plus bas). Elle ne peut pas se prolonger elle-même.

## Données (serveur)
- `entitlements (user_id pk, status, product_id, expires_at, original_transaction_id unique, trial_started_at, gift bool, gift_until, in_coach_team bool, updated_at)`.
  - `status` : `trial` | `active` | `expired` | `gift` | `coach_team`.
  - `gift` : accès **à vie** (non consommable d'Apple ou code cadeau `lifetime`). `gift_until` : fin d'un **cadeau en jours**, cumulée à chaque code. `expires_at` : la plus lointaine des deux dates (abonnement payé, cadeau en jours).
  - RLS fermée sans politique, aucun GRANT : lecture seulement par RPC, écriture seulement par les fonctions du serveur.
- `entitlement_claims (original_transaction_id pk, user_id, product_id, kind sub|gift, expires_at, revoked_at, created_at, updated_at)` : registre **à vie** des transactions Apple vérifiées. C'est lui qui fait qu'un abonnement ne sert qu'à un compte, même après que le compte a changé de transaction. RLS fermée, aucun GRANT.
- `app_config (key pk, value jsonb)` : `paywall_on` (booléen, défaut **false**), `trial_days` (défaut **90**), `trial_unproven_days` (défaut **14**, essai d'un compte sans identifiant Apple lié, verrou allumé). Lisible par `authenticated` ; **anon ne lit que la ligne `paywall_on`** (colonnes `key`, `value`). Écrit seulement par l'administrateur.
- `apple_app_ids (app_transaction_id pk, environment, first_trial_at, created_at)` et `apple_app_links (user_id, app_transaction_id)` : voir « Essai rattaché à l'identifiant Apple ». RLS fermée, aucun GRANT.
- `gift_codes` et `gift_redemptions` : voir « Codes cadeaux maison ».
- `user_profiles.trial_started_at` n'existe pas : l'essai vit dans `entitlements`, créé à la première lecture.

## Fonctions RPC (rôle `authenticated`)
| Fonction | Renvoie | Règles |
|---|---|---|
| `my_access()` | `jsonb` | `{ status, until, paywall_on, trial_days, days_left, can_write, gift, gift_until, coach_team, apple_linked, server_now }` (`apple_linked` : un identifiant Apple est lié au compte, ajout du 28/10). Crée la ligne `entitlements` en `trial` au premier appel (c'est là que l'essai démarre, à l'heure du serveur). `can_write` = droit d'enregistrer une séance ; **toujours `true` tant que `paywall_on` est faux**. |
| `access_state()` | `jsonb` | Alias de lecture seule, sans rien créer (pour les écrans qui ne doivent pas démarrer l'essai). |
| `redeem_gift_code(code text)` | `jsonb` | Utilise un code cadeau maison. Voir « Codes cadeaux maison » : la réponse est `{ ok, error, kind, access }`, un refus de code n'est **pas** une exception. |

Aucune RPC d'écriture du droit d'accès venant d'Apple. Les seules écritures d'abonnement viennent des Edge Functions ; `redeem_gift_code` n'ajoute que ce que l'administrateur a mis dans un code.

## Edge Functions
- **`verify-purchase`** (JWT vérifié) : entrée `{ jws }` (la transaction signée rendue par StoreKit 2). Vérifie la chaîne de certificats Apple (racine Apple Root CA G3), le `bundleId`, l'environnement, puis relit la transaction par l'**App Store Server API** (`/inApps/v1/transactions/{id}`). Écrit `entitlements`. Erreurs : `invalid_jws`, `bad_bundle`, `transaction_taken`, `not_found`.
- **`verify-app-transaction`** (ajout du 28/10, `verify_jwt = false` dans `supabase/config.toml`, jeton relu dans le code par `auth.getUser` comme `delete-account`) : entrée `{ jws }` (l'`AppTransaction` signé rendu par `appTransaction()`). Signature vérifiée par **la même** fonction que les achats (`_shared/apple-jws.js`), puis `app-transaction-policy.js` : `bundleId` `com.mdlf.training`, `receiptType` `Production` (`Sandbox` seulement avec `APPLE_ALLOW_SANDBOX=1`), `appTransactionId` présent. Écrit par `srv_link_app_transaction` (clé serveur). Sortie `{ ok: true, access }`. Erreurs : `invalid_jws`, `bad_bundle`, `bad_environment`, `not_app_transaction` (une transaction d'achat n'est pas une preuve de téléchargement), `no_app_transaction_id`, `invalid_app_transaction`, `rate_limited` (30 liaisons par 24 h), `not_found`.
- **`appstore-notify`** (pas de JWT, vérifiée par la signature Apple ; à déployer avec `--no-verify-jwt`) : reçoit les **App Store Server Notifications V2**. Traite `SUBSCRIBED`, `DID_RENEW`, `DID_CHANGE_RENEWAL_STATUS`, `EXPIRED`, `GRACE_PERIOD_EXPIRED`, `REFUND`, `REVOKE`, et `DID_FAIL_TO_RENEW` (ajouté le 28/10 : c'est lui qui porte la **période de grâce de facturation**). Met `entitlements` à jour.

## Essai rattaché à l'identifiant Apple (28/10/2026)
Problème : une nouvelle adresse e-mail = un nouveau compte = 3 mois gratuits de plus, à l'infini. Migration `20261029000000_payant_apple.sql`.

- **Preuve** : `AppTransaction.shared` (StoreKit 2), signée par Apple, obtenue **sans rien demander** à l'utilisateur. Son champ **`appTransactionId`** est l'identifiant **unique et stable** du téléchargement de l'app par un identifiant Apple : le même après réinstallation, sur un autre appareil, après un remboursement ou un changement de pays, présent même sans aucun achat (documentation StoreKit, vérifiée par Context7 le 28/10). Côté Swift, `appTransactionID` est déclaré **iOS 16.0+** et `@backDeployed(before: iOS 18.4)` : compilé avec le SDK d'Xcode 26 (`ios.yml`), il existe sur toute notre cible (iOS 16.4), sans `#available`. À ne pas confondre avec `originalPurchaseDate`, **fixe en Sandbox** (2013-08-01), inutilisable comme identifiant.
- **Serveur** : `apple_app_ids` retient, par `appTransactionId`, la date du **premier essai** = le départ de l'essai du **premier compte** qui l'a présenté (la première liaison fait foi, `on conflict do nothing`). Cette table **ne part pas** avec les comptes : supprimer son compte et en recréer un ne rend pas l'essai. Elle ne contient qu'un identifiant opaque d'Apple, son environnement et une date. `apple_app_links` (compte ↔ identifiant) part en cascade avec le compte.
- **Règle** : le départ de l'essai d'un compte est le **plus ancien** entre son propre départ et celui de chaque identifiant Apple auquel il est lié. Calculé à chaque lecture (`private.access_json`), donc indépendant de l'ordre. Les droits payés, les cadeaux et les élèves de coach ne changent pas : seule la fin de l'essai bouge. La liaison n'écrit jamais `trial_started_at`.
- **Quand l'app l'envoie** : au lancement (`accessBoot`), tant que `apple_linked` est faux, et juste avant de refuser une séance (`accessEnsure`). Verrou éteint aussi : l'historique des identifiants Apple est déjà là quand on allume.

**Cas limites (choix pris)** :
- **iPhone hors ligne, App Store pas connecté, preuve indisponible** : rien n'est bloqué tout de suite. L'app réessaie à chaque lancement et avant tout refus ; dès que la preuve arrive, l'essai complet revient (calculé depuis le départ du compte).
- **Preuve absente durablement, ou client modifié qui ne l'envoie jamais** : verrou allumé, un compte sans identifiant Apple lié a un essai **plafonné à `trial_unproven_days` jours (14)** depuis son propre départ. Repartir de zéro demande donc un nouveau compte tous les 14 jours (au lieu de 90, et ses séances ne le suivent pas). Un plafond à 0 fermerait complètement la porte mais bloquerait les honnêtes dont la preuve échoue un moment : il est **réglable sans redéployer**. L'écran d'abonnement propose alors **« Vérifier mon identifiant Apple »**, qui appelle `AppTransaction.refresh()` (fenêtre de mot de passe d'Apple, sur ce geste seulement).
- **Verrou éteint** : le plafond ne s'applique pas, `can_write` reste toujours vrai.
- **TestFlight et Sandbox** : la preuve existe, signée par Apple, avec `receiptType` `Sandbox` : **refusée sans `APPLE_ALLOW_SANDBOX=1`** (comme les achats), le compte est alors « sans preuve ». Pour essayer le verrou en TestFlight, poser le secret. Fichier StoreKit d'Xcode : signée par Xcode, toujours refusée (mauvaise racine).
- **iOS plus ancien** : rien en dessous de la cible (16.4). Si `appTransactionID` était vide malgré tout (preuve ancienne gardée par StoreKit), le module répond `noIdentifier` et le compte reste « sans preuve » ; le serveur refuse aussi une charge utile sans `appTransactionId` (`no_app_transaction_id`).
- **Proche qui se connecte le premier sur un iPhone** : la date de cet identifiant Apple devient le départ de son essai à lui. Réparation à la main : `update public.apple_app_ids set first_trial_at = now() where app_transaction_id = '…';`. Un vieux compte qui se connecte **après** ne raccourcit rien (la première liaison fait foi).
- **Preuve d'un autre** : elle ne peut que rapprocher la fin de l'essai (plus ancien des départs) ; elle ne rapporte rien.
- **Transition** : une mise à jour à chaud peut arriver avant la build qui a `appTransaction()`. Allumer le verrou avec `trial_unproven_days` à 90 (aucun plafond), puis le redescendre à 14 quand la build est installée :
  `update public.app_config set value = '14'::jsonb, updated_at = now() where key = 'trial_unproven_days';`

## Compte obligatoire quand le verrou est allumé (28/10/2026)
- Avant : `canWrite()` était vrai sans compte, ce qui rendait le verrou inopérant (tout restait en local).
- **Verrou allumé, sans compte** : démarrer une séance, enregistrer une séance (en cours ou passée) ou en modifier une ouvre l'écran de connexion (contexte `paywall` d'`openAuthFlow` : Apple, Google, e-mail, les moyens habituels ; « Annuler » le ferme). Rien n'est supprimé : une séance en cours reste en cours.
- **Verrou éteint** : **rien ne change**, rien ne bloque, même sans compte.
- **Historique, Progrès et export** restent toujours ouverts, avec ou sans compte.
- **Lire le verrou sans compte** : la seule ligne `paywall_on` de `app_config` est lisible par `anon` (politique RLS sur la clé, `grant select (key, value)`). C'est la solution la plus simple : aucune fonction de plus, aucune autre donnée exposée (`trial_days`, `trial_unproven_days` restent réservés aux comptes), et c'est un réglage public par nature (l'app l'affiche). L'app la garde sur l'appareil (`mdlf_paywall_anon`). Valeur jamais lue (premier lancement hors ligne), erreur, ou comptes indisponibles sur l'appareil : **rien ne bloque**. Ce n'est pas une barrière de sécurité : sans compte, aucune séance n'atteint le serveur, dont le verrou dur (`sessions_paywall`) reste la vraie garde.

## Codes cadeaux maison (28/10/2026)
Fabriqués par Maxence en SQL, utilisés **dans l'app** (Réglages › Abonnement › « J'ai un code »).

- `gift_codes (code pk, kind, days, created_at, expires_at, max_uses défaut 1, uses défaut 0, note)`.
  - `kind` : `lifetime` (accès à vie) ou `days` (N jours offerts, **cumulables**).
  - RLS fermée sans politique, **aucun GRANT** : personne ne lit la table par l'API (sinon tous les codes seraient connus), et **aucune RPC ne crée de code**.
- `gift_redemptions (code, user_id, redeemed_at)`, clé `(code, user_id)` : un compte n'utilise un code qu'une fois. Part en cascade avec le compte ; le compteur `uses` du code, lui, ne redescend pas.
- **Un code ne se devine pas** : la base impose 10 à 24 caractères parmi 32 symboles lisibles (sans `0`/`O`/`1`/`I`). Un code court ou choisi à la main (« NOEL2026 ») est refusé par la contrainte. L'administrateur les fabrique avec `private.make_gift_code(kind, days, n, note [, valid_for, uses_max])`, non exécutable par un rôle de l'API : 12 caractères tirés au hasard, soit 32^12 ≈ 1,2·10^18 possibilités.
  - `select private.make_gift_code('days', 90, 20, 'Beta testeurs');` → 20 codes de 90 jours, valables 1 an, 1 usage chacun.
  - `select private.make_gift_code('lifetime', null, 3, 'Famille');` → 3 accès à vie.
  - `select code, kind, days, uses, max_uses, expires_at, note from public.gift_codes order by created_at desc;`
- **`redeem_gift_code(code text)`** renvoie `{ ok, error, kind, access }` : `access` est la charge utile de `my_access()`, pour que l'app se rafraîchisse d'un seul appel. Saisie souple comme `coach_join` (majuscules, espaces et tirets ignorés).
  - `kind = 'lifetime'` : `gift` passe à vrai, sans date de fin.
  - `kind = 'days'` : `gift_until` = **maximum entre maintenant et l'expiration en cours** + `days` jours. Deux codes de 30 jours donnent donc 60 jours, et un code utilisé pendant un abonnement payé ne perd pas ses jours.
  - **⚠ Un refus de code n'est pas une exception** : il est dans `error` (`invalid_code`, `code_expired`, `code_used_up`, `already_redeemed`), avec `ok: false`. C'est voulu : Postgres annule tout ce qu'une fonction a écrit quand elle lève une exception, donc un refus levé effacerait le comptage de l'essai et on pourrait **tenter des codes sans fin**. L'app doit regarder `ok` et `error`, pas seulement l'exception.
  - **Seuls `rate_limited` et `not_found`** (aucun utilisateur) sont levés en `P0001`. `rate_limited` : plus de **10 essais par heure et par compte, réussis OU ratés**.
  - `uses` est incrémenté sous verrou de ligne : deux appareils qui utilisent le même code en même temps ne dépassent jamais `max_uses`.

## Précisions du serveur (migration 20261028000000_payant.sql, 28/10)
Points que les tableaux ne disaient pas, tranchés côté serveur ; l'app doit les connaître :
- **Deux tables** : `entitlement_claims` (chaque transaction Apple, à vie) et `entitlements` (l'instantané du compte). Sans ce registre, remplacer sa transaction par une nouvelle libérerait l'ancienne, qu'un second compte pourrait réclamer.
- **L'état qui fait foi est recalculé à chaque lecture.** `entitlements.status` et `entitlements.in_coach_team` ne sont que le dernier instantané : un essai ou un abonnement arrive à terme sans que personne n'écrive rien.
- **Ordre des statuts** quand plusieurs droits se cumulent : `gift` > `active` > `coach_team` > `trial` > `expired`. Le cadeau passe avant tout le reste ; un abonné est `active` même s'il est aussi élève d'un coach.
- **`until`** : fin de l'abonnement ou du cadeau en jours (`active`, `gift`), fin de l'essai (`trial`), dernière date échue (`expired`), `null` sans fin (accès à vie, `coach_team`). **`days_left`** : jours entiers restants arrondis au plus grand, jamais négatif, `null` quand il n'y a pas de fin. **`gift_until`** : fin d'un cadeau en jours, `null` pour un accès à vie ou sans cadeau.
- **`access_state()` sur un compte qui n'a jamais appelé `my_access()`** : `status: 'trial'`, `days_left: trial_days`, `until: null`, et rien n'est créé. L'essai ne démarre qu'avec `my_access()`, que l'app appelle au lancement.
- **`app_config`** : une valeur absente ou du mauvais type retombe sur les défauts (le verrou ne s'allume jamais tout seul). `trial_days` est borné à 0..3650. Pour allumer le verrou : `update public.app_config set value = 'true'::jsonb, updated_at = now() where key = 'paywall_on';`
- **Produits reconnus** en dur dans la migration : un produit inconnu est refusé (`unknown_product`) plutôt qu'écrit.
- **Erreurs levées** (message exact, errcode `P0001`) : `not_found`, `transaction_taken`, `unknown_product`, `invalid_transaction`, `rate_limited`, et `invalid_kind` pour l'administrateur qui se trompe de `kind` dans `make_gift_code`.
- **Débit** : 120 appels de `srv_access_purchase` par compte et par 24 h, 10 essais de code cadeau par heure.
- **Environnement Sandbox refusé par défaut** par les deux Edge Functions (`bad_environment`) : un testeur Sandbox s'obtient gratuitement, sans cette règle n'importe qui aurait l'app à vie. Poser le secret `APPLE_ALLOW_SANDBOX=1` pendant les essais d'achat, et le **retirer avant la mise en vente**.
- **Partage familial refusé** (`not_purchased`) : il n'est pas activé sur ces produits.
- **Verrou dur côté serveur** : un déclencheur `before insert on public.sessions` refuse l'enregistrement d'une séance **nouvelle** avec l'erreur P0001 `paywall_locked` quand le verrou est allumé et `can_write` faux. Les **mises à jour** et les **suppressions** restent permises. Côté app (`syncNow`, js/data/account.js) ce refus n'est ni une panne ni un problème de réseau : la séance reste sur l'iPhone, elle n'est **jamais marquée envoyée**, le lot est coupé en deux pour isoler les refusées (le reste passe), le **profil et les programmes partent quand même**, et les identifiants refusés ne sont plus renvoyés tant que le droit d'écrire n'est pas revenu (ou pendant une heure). L'accueil le dit (« 1 séance n'est pas sauvegardée sur ton compte ») et mène à l'abonnement ; dès que le droit revient (abonnement, code), ce qui était gardé repart tout seul.
- **Pas de contrôle de révocation des certificats** (OCSP, CRL) : il demanderait un appel réseau à chaque vérification. La révocation d'une **transaction**, elle, est vue : `verify-purchase` relit la transaction chez Apple, et Apple prévient (`REFUND`, `REVOKE`).
- **Fonctions du serveur** (clé serveur seulement, aucun client ne peut les exécuter) : `srv_access_purchase(p_user, p_product, p_expires, p_original_tx, p_revoked)` et `srv_access_event(p_original_tx, p_product, p_expires, p_revoked)`.

## App
- `js/data/access.js` : lit `my_access()`, garde le dernier état connu par compte (`mdlf_access`, verrouillé par `userId`), expose `canWrite()`, `accessStatus()`, `daysLeft()`.
  - **Hors ligne** : le dernier état connu vaut **7 jours** au plus après sa lecture (`server_now`), pour qu'une salle sans réseau ne bloque personne, sans permettre de rester bloqué en « gratuit » indéfiniment. Au-delà, l'app redemande au premier réseau.
  - L'horloge de l'appareil n'est jamais utilisée pour décider : on compare les dates du serveur. Conséquence : passé les 7 jours, un **droit d'écriture** gardé ne vaut plus (l'app ne se prolonge pas elle-même) et un **refus** gardé reste un refus (seul le serveur le lève). Les deux sens vont vers le plus strict : avancer ou reculer l'horloge de l'iPhone ne peut rien ouvrir, et déclenche seulement une nouvelle lecture.
  - `can_write` vient du serveur et n'est jamais recalculé dans l'app.
  - Codes cadeaux : `accessRedeemGiftCode(code)` regarde `ok` et `error` de `redeem_gift_code`, **pas seulement** le bloc d'erreur, et traduit `invalid_code`, `code_expired`, `code_used_up`, `already_redeemed` et `rate_limited`.
- **Règle 2 (28/10)** : sans compte, `canWrite()` est faux **seulement** si le verrou lu sans compte (`access.anon`) est allumé et que les comptes existent sur l'appareil (`accessSignInRequired()`) ; `accessAnonRefresh()` lit `app_config` au lancement, au retour au premier plan (10 min au plus) et au retour du réseau.
- **Règle 1 (28/10)** : `accessLinkApple({ refresh, force })` envoie la preuve à `verify-app-transaction` quand `apple_linked` est faux ; preuve indisponible = rien d'envoyé, rien de bloqué ; refus définitif (`bad_environment` en TestFlight…) = plus renvoyée pendant ce lancement.
- `js/features/paywall-ui.js` : écran d'abonnement (deux formules, prix lus chez StoreKit, pas écrits en dur), bandeau « il te reste N jours », écran de fin d'essai, « Restaurer mes achats », **« J'ai un code »** (champ de saisie du code cadeau MDLF, saisie souple) et **« J'ai un code d'offre Apple »** (feuille d'Apple, app iOS seulement), et le lien obligatoire vers les conditions et la confidentialité. Produits inconnus d'Apple (`missing`) : message clair, aucun prix affiché.
- **Mode lecture seule** (quand `can_write` est faux et le verrou allumé) : Historique, Progrès, profil et **export** restent ouverts ; démarrer ou enregistrer une séance propose l'abonnement. Rien n'est supprimé.
- **Réglages › Abonnement** : état en clair, date de fin, gérer l'abonnement (lien Apple), restaurer, code.

## Natif (iOS, StoreKit 2)
`ios/App/App/StorePlugin.swift`, module Capacitor `MdlfStore`. **Cette section décrit le module tel qu'il est vraiment** : la première version de ce contrat décrivait un plugin imaginaire (`price` au lieu de `displayPrice`, un `jws` à la racine de `restore()`), ce qui a cassé l'écran d'abonnement sans qu'aucun test ne le voie. `tests/unit/store-contract.mjs` lit désormais le vrai Swift et vérifie clé par clé ce que l'app consomme et ce que le faux StoreKit des tests rend.

- `status()` → `{ canMakePayments, subscriptionIds, giftId }`, sans aucun appel réseau. `canMakePayments` est **faux** quand les achats sont bloqués (Temps d'écran, profil de gestion) : l'écran ne propose alors aucun bouton d'achat.
- `products()` → `{ products, missing, canMakePayments }`. Chaque produit : `{ id, displayName, description, displayPrice, price, currency, period: { unit, value }, introEligible, offer? }`. **Le prix affichable est `displayPrice`** (chaîne déjà formatée par Apple dans la monnaie de la boutique) ; `price` est un **nombre**, inutilisable tel quel à l'écran. `missing` liste les identifiants qu'Apple ne connaît pas encore (contrat **Paid Apps** non signé, produit pas encore « Prêt à être envoyé ») : `products` est alors **vide** et l'écran le dit, sans prix inventé.
- `purchase({ productId, appAccountToken? })` : **ne rejette jamais** sur annulation. Il résout `{ status: 'success' | 'userCancelled' | 'pending' }` ; pour `success`, la réponse porte **toute la transaction** (`jws`, `transactionId`, `originalTransactionId`, `productId`, `purchasedAt`, `expiresAt`, `revokedAt`, `environment`, `subscription`, `gift`…). L'app passe **toujours** `appAccountToken` = identifiant du compte MDLF (UUID Supabase) : sans lui, un achat dont la vérification échoue (réseau coupé juste après le paiement) devient **orphelin**, le serveur ne pouvant le rattacher à aucun compte. Un vrai problème (produit absent, preuve non vérifiée) est un rejet avec un code.
- `finish({ transactionId })` → `{ finished, reason? }` : **obligatoire**. `purchase()`, `restore()`, `current()` et l'écouteur rendent le JWS **sans terminer** la transaction, exprès : un achat perdu par le réseau revient au lancement suivant (`Transaction.unfinished`). L'app appelle `finish()` **après** que le serveur a confirmé, ou sur un refus définitif (`invalid_jws`, `bad_bundle`). **Jamais** sur une erreur passagère (503 : Apple injoignable) ni sur `transaction_taken` : la transaction est gardée, et simplement plus réenvoyée tant qu'on reste sur ce compte.
- `restore()` → `{ synced, cancelled, entitlements, unverified }`. `AppStore.sync()` demande le mot de passe du compte Apple : à n'appeler que sur « Restaurer mes achats ». **Le JWS est dans chaque `entitlements[i]`, jamais à la racine** ; un abonnement et un « Accès offert » peuvent coexister, l'app les envoie donc tous. Fermer la fenêtre d'Apple n'est pas une erreur (`cancelled: true`, les droits déjà connus sont rendus).
- `current()` → `{ entitlements, unverified }` : les droits en cours (`Transaction.currentEntitlements`) **sans rien demander à l'utilisateur**. L'app le lit au lancement quand le verrou est allumé et `can_write` faux, pour rattraper un achat qui n'est jamais arrivé au serveur (réseau coupé, app réinstallée, nouvel iPhone).
- `appTransaction({ refresh? })` → `{ available: true, jws, appTransactionId, environment, bundleId, originalPurchaseDate, appVersion, originalAppVersion }`, ou `{ available: false, reason }` avec `reason` : `unavailable` (pas de réseau, App Store pas connecté), `unverified` (résultat `.unverified` de StoreKit : **refusé**, le JWS n'est jamais transmis), `cancelled` (fenêtre d'Apple fermée) ou `noIdentifier` (`appTransactionID` vide). **Ne rejette jamais** : l'absence de preuve n'est pas une erreur. Sans `refresh`, rien n'est demandé à l'utilisateur (`AppTransaction.shared`) ; `refresh: true` appelle `AppTransaction.refresh()`, qui affiche la fenêtre de mot de passe d'Apple : seulement sur un geste. L'app ne lit que `available`, `jws` et `reason` ; `appTransactionId` est indicatif, le serveur le lit dans la charge utile **signée**. Une coquille plus ancienne que la méthode rend `null` côté web (`Native.store.appTransaction`).
- `redeemCode()` → `{ presented: true }`, ou `{ presented: false, cancelled: true }` si la fenêtre est fermée : **ce n'est pas un succès**. Elle n'accepte que les **codes d'offre d'abonnement** d'Apple ; les **codes cadeaux maison** se saisissent dans un champ de l'app. L'écran propose les deux séparément et ne promet jamais qu'un code d'Apple se saisit dans l'app.
- **Écouteur permanent** `Transaction.updates` (plus `Transaction.unfinished` au lancement) : toute transaction (renouvellement, code utilisé, achat sur un autre appareil) est transmise au serveur, puis terminée par `finish()`. Le module émet le même événement sous **deux noms** (`transaction` et `change`, en `retainUntilConsumed`) : l'app s'abonne à **un seul** des deux, sinon chaque transaction serait traitée deux fois.
- Une transaction `.unverified` (signature d'Apple invalide) est **refusée par le module**, jamais transmise au web et jamais finie.

Hors app iOS (web) : aucun achat possible, l'écran invite à utiliser l'app.

## Ce qui reste à faire par Maxence (ne peut pas être fait par l'API)
1. Signer le contrat **Paid Apps** (coordonnées bancaires et fiscales) sur App Store Connect.
2. Vérifier le statut micro-entreprise pour la vente d'applications.
3. Créer un **testeur Sandbox** pour l'essai d'achat réel.
4. Fournir l'**URL de notification** à App Store Connect (donnée par l'Edge Function) et la clé d'API **In-App Purchase** si elle diffère de la clé Admin.
5. Déployer `verify-app-transaction` (sa ligne `verify_jwt = false` est dans `supabase/config.toml`) et appliquer `20261029000000_payant_apple.sql`.
6. Poser les secrets des Edge Functions : `APPLE_IAP_KEY_ID`, `APPLE_IAP_PRIVATE_KEY` (contenu du `.p8` In-App Purchase), `APPLE_ISSUER_ID`, et `APPLE_ALLOW_SANDBOX=1` **seulement** pendant les essais Sandbox.
7. Déployer `appstore-notify` avec `--no-verify-jwt` (Apple n'a pas de jeton Supabase) et `verify-purchase` normalement.
8. Fabriquer ses premiers codes cadeaux : `select private.make_gift_code('days', 90, 10, 'Beta');`

## Précisions du serveur (28/10)
- **Réouverture après un remboursement** (`private.access_claim`, règle 4) : la révocation n'est levée que par un évènement **à la fois plus récent** (`event_at` connu des deux côtés) **et portant une période strictement plus lointaine**. Un vrai réabonnement rouvre donc l'accès tout seul, sans support, alors qu'un évènement en retard, rejoué, de même période ou sans date d'évènement ne rouvre rien. Tant qu'une transaction reste révoquée, **sa période ne bouge pas** : sinon un évènement sans date relèverait la barre du réabonnement sans rien rouvrir.
  - En secours (si la période d'Apple ne va pas plus loin que l'ancienne, ou pour un accès offert, qui n'a pas de date de fin) : `update public.entitlement_claims set revoked_at = null, event_at = null where original_transaction_id = '…';` puis `select private.access_refresh('<user_id>');`
