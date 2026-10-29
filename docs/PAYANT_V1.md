# Payant V1 : contrat entre l'app, le serveur et Apple

Décisions de Maxence (26/10 au 28/10/2026), dont le **modèle B** voté le 28/10 au soir :
- **essai gratuit de 3 mois géré par Apple** : c'est une **offre de lancement** (« 3 mois gratuits ») configurée dans App Store Connect sur les deux abonnements. Apple exige un moyen de paiement et garantit **un seul essai par identifiant Apple et par groupe d'abonnements**. Le serveur ne tient plus d'essai maison ;
- puis **tout est payant** (pas de version gratuite limitée) : **5,99 €/mois** et **41,99 €/an** ;
- sans abonnement : le profil et l'historique restent **consultables**, l'**export** reste possible ; on ne peut plus **enregistrer de nouvelle séance** ;
- **compte obligatoire pour enregistrer une séance quand le verrou est allumé** (vote 8 contre 2), connexion avec Apple en premier ; verrou éteint, rien ne change ; Historique, Progrès et export restent toujours ouverts, avec ou sans compte ;
- **« Accès offert » d'Apple supprimé** (10 voix sur 10) : le non consommable `com.mdlf.training.access.gift` n'est plus reconnu nulle part ; Maxence supprime le produit dans App Store Connect ;
- **codes cadeaux maison** (inchangés) : les codes promotionnels d'Apple sont limités à 100 par version, expirent en 28 jours et se saisissent dans l'App Store ; nos codes sont faits par notre serveur (voir « Codes cadeaux maison ») ;
- codes d'offre d'abonnement d'Apple : **1 an gratuit au maximum** ;
- le **mode coach** reste gratuit en V1 ; un **élève suivi par un coach a l'accès gratuit tant qu'il est suivi**, **au plus 10 élèves gratuits par coach** (vote 6 contre 4), les plus anciens liens d'abord.

**Le verrou est livré ÉTEINT.** Tant que `app_config.paywall_on` est faux, l'app ne bloque rien. On allume après validation de Maxence.

## Produits App Store Connect
| Produit | Identifiant | Type | Prix |
|---|---|---|---|
| MDLF Training mensuel | `com.mdlf.training.pro.monthly` | abonnement, 1 mois, offre de lancement 3 mois gratuits | 5,99 € |
| MDLF Training annuel | `com.mdlf.training.pro.yearly` | abonnement, 1 an, offre de lancement 3 mois gratuits | 41,99 € |

Groupe d'abonnement `MDLF Training Acces` (id 22520671) : les deux abonnements sont au **même niveau**, pour que l'on puisse passer de l'un à l'autre sans perdre l'accès. L'offre de lancement se configure par Maxence (App Store Connect › l'abonnement › Prix de l'abonnement › Offre de lancement : gratuite, 3 mois, tous les pays).

## Principe de sécurité (le point le plus important)
**L'app ne décide jamais seule.** Un appareil peut être modifié : on ne fait confiance ni à son horloge, ni à son stockage.

- **Le serveur fait foi.** La table `entitlements` est la seule source de vérité, écrite uniquement par le serveur après vérification chez Apple.
- **L'essai est celui d'Apple.** Il n'existe plus de date d'essai côté serveur : rien à réinitialiser en recréant un compte, en réinstallant l'app ou en changeant l'horloge. Une nouvelle adresse e-mail ne redonne rien : c'est Apple qui refuse un second essai au même identifiant Apple.
- **Une preuve d'achat n'est jamais crue sur parole** : l'app transmet la transaction signée par Apple (JWS), et c'est l'**Edge Function** qui en vérifie la signature contre les certificats Apple (racine **Apple Root CA G3** épinglée), puis relit la transaction auprès de l'**App Store Server API**. Aucune RPC ne permet à un client d'écrire un droit d'accès.
- **Un abonnement ne sert qu'à un compte** : `original_transaction_id` est **unique**. La même transaction sur un second compte est refusée (`transaction_taken`).
- **Un remboursé le reste, sauf réabonnement réel** : `revoked_at` n'est levé que par un évènement à la fois **plus récent** et portant une période **strictement plus lointaine**.
- **Le serveur est prévenu par Apple** (App Store Server Notifications V2) : l'accès tombe tout seul, même si l'app n'est jamais rouverte.
- **Hors ligne** : l'app garde le dernier droit connu **signé par le serveur** avec une date d'expiration courte. Elle ne peut pas se prolonger elle-même.

## Données (serveur)
- `entitlements (user_id pk, status, product_id, expires_at, original_transaction_id unique, gift bool, gift_until, in_coach_team bool, updated_at)`.
  - `status` : `none` (jamais eu d'accès) | `active` (abonnement Apple, offre de lancement comprise) | `expired` (un accès a existé, il est échu ou remboursé) | `gift` (code cadeau maison) | `coach_team` (élève gratuit).
  - `gift` : accès **à vie** (code cadeau maison `lifetime`). `gift_until` : fin d'un **cadeau en jours**, cumulée à chaque code. `expires_at` : la plus lointaine des deux dates (abonnement payé, cadeau en jours).
  - Plus de `trial_started_at` (retirée par `20261029000000_payant_modele_b.sql`).
  - RLS fermée sans politique, aucun GRANT : lecture seulement par RPC, écriture seulement par les fonctions du serveur.
- `entitlement_claims (original_transaction_id pk, user_id, product_id, kind = 'sub', expires_at, revoked_at, event_at, intro_offer, environment, created_at, updated_at)` : registre **à vie** des transactions Apple vérifiées. `intro_offer` : la transaction appliquée en dernier est dans l'offre de lancement. `environment` : `Production` ou `Sandbox`. RLS fermée, aucun GRANT.
- `app_config (key pk, value jsonb)` : `paywall_on` (booléen, défaut **false**) et `min_build` (build native minimale, défaut **0** = aucune). `trial_days` a été retiré. Lisible par `authenticated` ; **anon ne lit que les lignes `paywall_on` et `min_build`** (colonnes `key`, `value`). Écrit seulement par l'administrateur.
- `private.coach_free_limits (coach_id pk, max_free, updated_at)` : plafond d'élèves gratuits d'un coach (absent : **10**). Hors de l'API, écrit seulement par l'administrateur.
- `gift_codes` et `gift_redemptions` : voir « Codes cadeaux maison ».

## Fonctions RPC (rôle `authenticated`)
| Fonction | Renvoie | Règles |
|---|---|---|
| `my_access()` | `jsonb` | `{ status, until, paywall_on, days_left, can_write, gift, gift_until, coach_team, intro_offer, intro_until, server_now }`. Crée la ligne `entitlements` (statut `none`) au premier appel, sans rien donner. `can_write` = droit d'enregistrer une séance : **toujours `true` tant que `paywall_on` est faux** ; verrou allumé, vrai seulement pour `active`, `gift` et `coach_team`. `intro_offer` / `intro_until` : l'abonnement en cours est dans l'offre de lancement d'Apple, et sa fin. |
| `access_state()` | `jsonb` | Même état, en lecture seule, sans rien créer. |
| `redeem_gift_code(code text)` | `jsonb` | Code cadeau maison : `{ ok, error, kind, access }`, un refus de code n'est **pas** une exception. |

Aucune RPC d'écriture du droit d'accès venant d'Apple : les écritures d'abonnement viennent des Edge Functions.

## Edge Functions
- **`verify-purchase`** (`verify_jwt = false` dans `supabase/config.toml` : le jeton est vérifié dans le code, `caller()` → `_shared/auth-guard.js` → `auth.getUser`, 401 avant tout travail ; prouvé par `tests/unit/auth-guard.mjs`) : entrée `{ jws }`. Vérifie la chaîne de certificats Apple, le `bundleId`, l'environnement (**Production ou Sandbox, tous deux acceptés**, Xcode refusé), relit la transaction par l'**App Store Server API** (`/inApps/v1/transactions/{id}`, hôte Production ou Sandbox selon la transaction), lit l'**offre de lancement** et écrit `entitlements` par `srv_access_purchase(…, p_intro, p_environment)`. Erreurs : `invalid_jws`, `bad_bundle`, `bad_environment`, `unknown_product`, `bad_type`, `not_purchased`, `invalid_transaction`, `transaction_taken`, `not_found`, `rate_limited`.
- **`appstore-notify`** (pas de JWT, vérifiée par la signature Apple ; à déployer avec `--no-verify-jwt`) : reçoit les **App Store Server Notifications V2**. Traite `SUBSCRIBED`, `DID_RENEW`, `DID_CHANGE_RENEWAL_STATUS`, `EXPIRED`, `GRACE_PERIOD_EXPIRED`, `REFUND`, `REVOKE` et `DID_FAIL_TO_RENEW` (période de grâce de facturation). Production et Sandbox acceptés ; offre de lancement et environnement remontés par `srv_access_event(…, p_intro, p_environment)`.

## Modèle B : l'essai gratuit est celui d'Apple (28/10/2026)
- **Ce qui a été retiré** (migration `20261029000000_payant_modele_b.sql`, la migration du 28/10 étant déjà en production) : l'essai maison (`trial_started_at`, `trial_days`, statut `trial`), le rattachement de l'essai à l'identifiant Apple (`verify-app-transaction`, `store_installs`, purge à 2 ans, plafond « sans preuve », plateforme déclarée, `appTransaction()` du Swift et du JS), et l'« Accès offert » d'Apple. Le piège évité : sans ce retrait, un compte aurait eu 3 mois de serveur **puis** 3 mois d'Apple.
- **Offre de lancement** : l'achat d'un abonnement par quelqu'un qui y a droit commence par 3 mois gratuits, que StoreKit annonce (`introEligible`, `offer`). Côté serveur, c'est un abonnement `active` comme un autre ; la transaction signée porte **`offerType` = 1** (`OfferType.INTRODUCTORY_OFFER` de l'App Store Server Library) et **`offerDiscountType` = `FREE_TRIAL`** (avec `offerPeriod`, par exemple `P3M`). Le serveur retient `intro_offer`, vrai seulement quand `offerType` vaut 1 **et** `offerDiscountType` vaut `FREE_TRIAL` (une offre de lancement payante ne s'affiche jamais comme « Essai gratuit »), et expose `intro_until` = la fin de cette période. Au premier renouvellement payé (sans `offerType`), `intro_offer` repasse à faux.
- **Écran d'abonnement** (règle 3.1.2(c) d'Apple : l'essai ne doit pas dominer le prix réellement débité) : chaque formule montre **en gros le prix et sa période** (« 41,99 € par an »), et « 3 mois gratuits » en **ligne secondaire** seulement si Apple l'accorde encore. Au-dessus des formules, ce que donne l'abonnement (« tu enregistres de nouvelles séances ; ton historique, tes progrès et l'export restent ouverts »). Le texte du haut dit exactement : « 3 mois gratuits, puis l'abonnement continue sauf si tu le résilies au moins 24 heures avant la fin de l'essai » (Apple demande de résilier au moins 24 h avant : https://support.apple.com/en-us/118428). Les mentions sous les formules disent la même chose (« sauf si tu le résilies au moins 24 heures avant la fin de l'essai », puis le renouvellement automatique « pour la même période », sans promettre « au même prix »).
- **Verrou éteint : aucune formule n'est proposée** (relecture du 28/10). Ni « Voir les formules » dans Réglages › Abonnement, ni prix sur l'écran d'abonnement : acheter ferait commencer l'essai d'Apple pour rien, et la personne serait débitée 3 mois plus tard. « Restaurer mes achats », « Gérer chez Apple » et les codes restent.
- **Décision de Maxence : la build part à l'examen d'Apple avec le verrou ALLUMÉ**, pour que l'abonnement débloque vraiment quelque chose (règle 3.1.2(a)). En **TestFlight**, le verrou reste éteint et les formules sont donc masquées. À côté des boutons, les **mentions de la règle 3.1.2** d'Apple : durée de l'essai, prix et période après l'essai, renouvellement automatique (sauf résiliation au moins 24 h avant la fin de la période), résiliable à tout moment dans les réglages de l'identifiant Apple, puis les liens **Conditions d'utilisation** et **Confidentialité**. Une phrase rappelle qu'un identifiant Apple n'a droit qu'à un seul essai et qu'un même abonnement ne sert qu'à un compte.
- **Réglages › Abonnement** pendant l'essai : « **Essai gratuit jusqu'au <date>, puis <prix>** » (date du serveur, formule lue dans les droits en cours de l'iPhone, prix lu chez StoreKit).
- Le bandeau « il te reste N jours » de l'essai maison a disparu ; le bandeau de l'accueil ne s'affiche plus que quand l'écriture est refusée.

## Sandbox accepté en production (28/10/2026)
- **Pourquoi** : l'équipe d'examen d'Apple teste les achats d'une version de **production** en environnement **Sandbox**. Refuser le Sandbox (ce que faisait `APPLE_ALLOW_SANDBOX`, retiré) menait à un refus quasi certain. `verify-purchase` et `appstore-notify` acceptent donc les deux environnements, avec la **même** chaîne de signature et le **même** `bundleId`, et l'environnement est **enregistré** sur chaque transaction (`entitlement_claims.environment`).
- **Ce que ça ouvre, honnêtement** :
  - Un **compte Sandbox** ne se crée que dans App Store Connect, donc seulement par l'équipe de Maxence, et ne fonctionne que pour les apps de ce compte développeur.
  - Sur un iPhone normal, une app **téléchargée sur l'App Store** achète toujours en **Production** : un utilisateur ne peut pas y payer en Sandbox. Le réglage « Compte Sandbox » n'apparaît que dans **Réglages › Développeur**, donc avec le **mode développeur** activé, après un premier achat dans une app signée pour le développement (documentation StoreKit, vérifiée par Context7 le 28/10).
  - **TestFlight tourne toujours en Sandbox**, même avec un identifiant Apple ordinaire : un testeur TestFlight « s'abonne » sans payer et obtient un vrai accès sur son compte MDLF. Un abonnement TestFlight se **renouvelle chaque jour, 6 fois au plus**, puis s'arrête ; mais le testeur peut **se réabonner gratuitement** autant de fois qu'il veut. **Conséquence : tout testeur TestFlight a l'app gratuite.** C'est l'ouverture réelle, et elle est acceptée parce que le Sandbox est indispensable à l'examen d'Apple.
  - **Règle : jamais de lien TestFlight public une fois le verrou allumé.** Les testeurs restent des personnes invitées par Maxence.
  - Requête d'administration (lecture seule) qui liste les accès Sandbox :
    `select c.user_id, p.username, c.product_id, c.expires_at, c.revoked_at, c.updated_at from public.entitlement_claims c left join public.user_profiles p using (user_id) where c.environment = 'Sandbox' order by c.updated_at desc;`

## Élèves de coach (28/10/2026)
- **Bogue corrigé** : l'accès gratuit d'un élève exige maintenant que son coach ait **encore** le rôle (`user_profiles.coach_at` non nul). Avant, retirer le rôle à un coach laissait ses élèves gratuits pour toujours.
- **Au plus 10 élèves gratuits par coach**, les plus anciens liens d'abord (`coach_links.created_at`), en ne classant que les élèves **sans droit payé propre** (`private.access_own_paid` : abonnement en cours, cadeau maison en jours ou à vie) : un élève abonné n'occupe pas une place gratuite. Au-delà, l'élève reste suivi (le coach voit ses séances, envoie des programmes) mais il lui faut son propre abonnement ou un code. Si un ancien élève part, ou s'abonne, le suivant entre dans les 10.
- Plafond par coach, relevé à la main par l'administrateur :
  `insert into private.coach_free_limits (coach_id, max_free) values ('<uuid>', 25) on conflict (coach_id) do update set max_free = excluded.max_free, updated_at = now();`
- Côté élève, Réglages › Abonnement dit : « **Accès offert par ton coach tant qu'il te suit** ». Voir aussi `docs/COACH_V1.md`.

## Grâce de fin de séance (28/10/2026)
- **Le problème** : une séance commencée avec le droit d'écrire était refusée à « Terminer » si l'abonnement prenait fin pendant la séance.
- **Côté app** : `startSession` note `activeSession.writeOk` (le droit d'écrire au début de la séance). « Terminer » ne passe pas par la porte quand il est vrai. Démarrer une séance, ajouter une séance passée ou en modifier une passent toujours par la porte.
- **Côté serveur** (`private.sessions_paywall`), une séance nouvelle sans droit d'écrire est acceptée seulement si **toutes** ces conditions tiennent :
  - le statut est `expired` et la fin de l'accès (`until`) est connue ;
  - on est **au plus 24 h après cette fin, à l'heure du serveur** (salle sans réseau, envoi le lendemain) ;
  - la séance a **commencé avant la fin et au plus 12 h avant** (début = `data.date - data.duration`, l'app enregistre `date` = fin de séance) ;
  - **2 séances au plus** par fin d'accès (journal `private.social_rate`, action `session_grace`), comptées sous **verrou consultatif** (`pg_advisory_xact_lock(hashtextextended('session_grace:' || user_id, 0))`) : 6 envois simultanés n'en font passer que 2 (`tests/sql/grace_race_test.sh`). Seules les **vraies nouvelles lignes** sont comptées : le test d'existence de la ligne est fait une première fois, puis **refait sous le verrou**, si bien qu'une séance de grâce renvoyée (réessai réseau, correction), même par deux envois simultanés, ne consomme qu'une grâce (`grace_race_test.sh`, second cas).
- **Pourquoi l'antidatage ne sert à rien** : la fenêtre se ferme 24 h après la fin à l'heure du **serveur**, quelle que soit la date déclarée, et ne laisse passer que 2 séances. Sans date de fin connue (jamais abonné, élève dont le coach n'a plus le rôle) : aucune grâce. Une séance refusée quand même reste sur l'iPhone, rien n'est perdu.

## Compte obligatoire quand le verrou est allumé (28/10/2026)
- **Verrou allumé, sans compte** : démarrer une séance, enregistrer une séance passée ou en modifier une ouvre l'écran de connexion (contexte `paywall` d'`openAuthFlow`), **« Continuer avec Apple » en premier**, puis Google et e-mail ; « Annuler » le ferme. Rien n'est supprimé.
- **Verrou éteint ou lu à faux** : **rien ne change**, rien ne bloque.
- **Historique, Progrès et export** restent toujours ouverts.
- **Lire le verrou sans compte** : la seule ligne `paywall_on` de `app_config` est lisible par `anon`. L'app la garde sur l'appareil (`mdlf_paywall_anon`). Sans compte, aucune séance n'atteint le serveur, dont le verrou dur (`sessions_paywall`) reste la vraie garde.
- **Valeur jamais lue** : tant que le verrou n'est **pas mis en service** (constante `PAYWALL_LAUNCHED` de `js/data/access.js`, livrée à `false`), un verrou jamais lu ne ferme **rien**, jamais (« éteint = rien ne bloque »). Une fois mis en service : ouverte seulement **7 jours après la première ouverture de l'app** (date gardée dans le **Trousseau**, `mdlf_first_seen`, elle survit à une réinstallation) ; ensuite une lecture réussie est nécessaire, et l'app le dit (« Connexion à Internet nécessaire »). Un verrou lu à faux une fois ne bloque jamais. Restent ouverts (documentés) : reculer l'horloge de l'iPhone, ou lire le verrou à faux une fois puis bloquer le serveur pour toujours (l'app perd alors toute synchronisation).
- `accessSignInRequired()` exige `account.ready` : au démarrage à froid, un compte connecté ne voit jamais l'écran de connexion.

### Note pour l'équipe d'examen d'Apple (règle 5.1.1(v)), prête à coller
**À trancher par Maxence** : le comportement est codé, cette note l'explique.

> MDLF Training can be used without an account: browsing programs, the exercise library, history, progress charts and data export never require one. An account is only required to record new workouts once the subscription is active, for three reasons. (1) The auto-renewable subscription (with its 3-month free trial offered by Apple) is attached to the user's account on our server, which verifies Apple's signed transactions and App Store Server Notifications; without an account there is nothing to attach the entitlement to, and no way to restore it on a new device. (2) Recorded workouts are synced to that account so they are not lost when the subscription is restored on another iPhone. (3) It lets a coach follow a student's workouts. Sign in with Apple is offered first, alongside Google and a one-time email code; no password is ever required. Users can delete their account and all its data from Settings › Account › Delete my account. Test account for review: [à remplir par Maxence].

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

## Précisions du serveur
- **Deux tables** : `entitlement_claims` (chaque transaction Apple, à vie) et `entitlements` (l'instantané du compte).
- **L'état qui fait foi est recalculé à chaque lecture** (`private.access_json`). `entitlements.status` et `in_coach_team` ne sont que le dernier instantané.
- **Ordre des statuts** : `gift` > `active` > `coach_team` > `expired` > `none`. Un abonné est `active` même s'il est aussi élève d'un coach.
- **`until`** : fin de l'abonnement ou du cadeau en jours (`active`, `gift`) ; pour `expired`, la dernière fin d'accès (fin d'abonnement, remboursement, cadeau en jours) ; `null` sinon. **`days_left`** : jours entiers restants pour `active` et `gift`, `null` sinon.
- **`app_config`** : une valeur absente ou du mauvais type retombe sur « éteint ». Pour allumer le verrou : `update public.app_config set value = 'true'::jsonb, updated_at = now() where key = 'paywall_on';`
- **Produits reconnus** en dur (`private.access_product_kind`) : les deux abonnements. Tout autre produit, dont l'ancien « Accès offert », est refusé (`unknown_product`), et l'app termine cette transaction pour qu'elle ne revienne pas.
- **Erreurs levées** (message exact, errcode `P0001`) : `not_found`, `transaction_taken`, `unknown_product`, `invalid_transaction`, `rate_limited`, `paywall_locked`, et `invalid_kind` pour l'administrateur qui se trompe de `kind` dans `make_gift_code`.
- **Débit** : 120 appels de `srv_access_purchase` par compte et par 24 h, 10 essais de code cadeau par heure.
- **Partage familial refusé** (`not_purchased`) : il n'est pas activé sur ces produits.
- **Verrou des mises à jour** (relecture du 28/10) : sans lui, un `UPDATE` (ou le « do update » d'un upsert) permettait d'écrire une séance neuve par une ligne déjà là. Le déclencheur `sessions_paywall_upd` (`before update`, fonction `private.sessions_paywall_update`) refuse `paywall_locked`, quand le verrou est allumé et que le compte n'a pas le droit d'écrire, si **l'`id` change**, si **`deleted_at` passe de non nul à null** (sortie de la corbeille) ou si **`data->'date'` change sur une ligne vivante**. Restent permis : corriger une séance sans changer sa date, la mettre à la corbeille, modifier une ligne qui reste à la corbeille. Il couvre le chemin `on conflict do update` et passe avant `sessions_touch` (ordre alphabétique). Des lignes de corbeille semées à l'avance verrou éteint ne se réveillent donc pas verrou allumé (testé). **Côté app**, une séance refusée par ce chemin (par exemple sortie de la corbeille sans droit) est traitée comme une séance nouvelle refusée : isolée dans son lot, gardée dans `syncLockedIds`, **jamais marquée envoyée**, elle reste sur l'iPhone et repart dès que le droit revient.
- **Verrou dur côté serveur** : un déclencheur `before insert on public.sessions` refuse l'enregistrement d'une séance **nouvelle** avec l'erreur P0001 `paywall_locked` quand le verrou est allumé et `can_write` faux, sauf grâce de fin de séance. Les **mises à jour** et les **suppressions** restent permises, **y compris par `upsert`** (`insert … on conflict`, ce que fait l'app pour corriger et mettre à la corbeille) : une ligne `(user_id, id)` déjà présente passe toujours (relecture du 28/10). Côté app (`syncNow`, js/data/account.js) ce refus n'est ni une panne ni un problème de réseau : la séance reste sur l'iPhone, elle n'est **jamais marquée envoyée**, le lot est coupé en deux pour isoler les refusées, le **profil et les programmes partent quand même**. L'accueil le dit et mène à l'abonnement ; dès que le droit revient, ce qui était gardé repart tout seul.
- **Journaux des fonctions Edge** : aucun identifiant de transaction n'y est écrit (relecture du 28/10), seulement le type d'évènement et la cause d'un refus.
- **Pas de contrôle de révocation des certificats** (OCSP, CRL) : la révocation d'une **transaction**, elle, est vue (relecture chez Apple, notifications `REFUND` et `REVOKE`).
- **Suppression du compte avec un abonnement en cours** : la feuille de confirmation dit que l'abonnement continuera d'être facturé par Apple et propose « Gérer chez Apple » avant de supprimer (exigence d'Apple : https://developer.apple.com/support/offering-account-deletion-in-your-app/).
- **Fonctions du serveur** (clé serveur seulement) : `srv_access_purchase(p_user, p_product, p_expires, p_original_tx, p_revoked, p_event_at, p_intro, p_environment)` et `srv_access_event(p_original_tx, p_product, p_expires, p_revoked, p_event_at, p_force, p_uuid, p_account_token, p_intro, p_environment)`.
## Réouverture après un remboursement
- **Réouverture après un remboursement** (`private.access_claim`, règle 4) : la révocation n'est levée que par un évènement **à la fois plus récent** (`event_at` connu des deux côtés) **et portant une période strictement plus lointaine**. Un vrai réabonnement rouvre donc l'accès tout seul, sans support, alors qu'un évènement en retard, rejoué, de même période ou sans date d'évènement ne rouvre rien. Tant qu'une transaction reste révoquée, **sa période ne bouge pas** : sinon un évènement sans date relèverait la barre du réabonnement sans rien rouvrir.
  - En secours (si la période d'Apple ne va pas plus loin que l'ancienne) : `update public.entitlement_claims set revoked_at = null, event_at = null where original_transaction_id = '…';` puis `select private.access_refresh('<user_id>');`

## App
- `js/data/access.js` : lit `my_access()`, garde le dernier état connu par compte (`mdlf_access`), expose `canWrite()`, `accessStatus()`, `accessUntil()`, `accessIntroUntil()`.
  - **Hors ligne** : le dernier état connu vaut **7 jours** au plus après sa lecture (`server_now`) ; un abonnement ou un cadeau daté vaut jusqu'à sa date de fin du serveur plus deux jours. L'horloge de l'appareil ne décide jamais : avancer ou reculer l'horloge ne peut rien ouvrir.
  - `can_write` vient du serveur et n'est jamais recalculé dans l'app.
  - Formules : `accessLoadProducts()` lit les prix (`displayPrice`) et l'essai (`accessTrialOf` : `introEligible` et `offer.paymentMode = 'freeTrial'`) chez StoreKit.
  - Codes cadeaux : `accessRedeemGiftCode(code)` regarde `ok` et `error` de `redeem_gift_code`, pas seulement le bloc d'erreur.
- `js/features/paywall-ui.js` : écran d'abonnement (offre lue chez StoreKit, mentions 3.1.2, conditions et confidentialité), « Restaurer mes achats », **« J'ai un code »** (code cadeau MDLF) et **« J'ai un code d'offre Apple »** (feuille d'Apple), Réglages › Abonnement, porte des écritures `accessGate()`.
- **Mode lecture seule** (verrou allumé, `can_write` faux) : Historique, Progrès, profil et **export** restent ouverts ; démarrer ou enregistrer une séance propose l'abonnement. Rien n'est supprimé.

## Natif (iOS, StoreKit 2)
`ios/App/App/StorePlugin.swift`, module Capacitor `MdlfStore`. **Cette section décrit le module tel qu'il est vraiment** : la première version de ce contrat décrivait un plugin imaginaire (`price` au lieu de `displayPrice`, un `jws` à la racine de `restore()`), ce qui a cassé l'écran d'abonnement sans qu'aucun test ne le voie. `tests/unit/store-contract.mjs` lit désormais le vrai Swift et vérifie clé par clé ce que l'app consomme et ce que le faux StoreKit des tests rend.

- `status()` → `{ canMakePayments, subscriptionIds }`, sans aucun appel réseau. `canMakePayments` est **faux** quand les achats sont bloqués (Temps d'écran, profil de gestion) : l'écran ne propose alors aucun bouton d'achat.
- `products()` → `{ products, missing, canMakePayments }`. Chaque produit : `{ id, displayName, description, displayPrice, price, currency, period: { unit, value }, introEligible, offer? }`. **Le prix affichable est `displayPrice`**. **Offre de lancement (l'essai gratuit de 3 mois, modèle B)** : `introEligible` vaut vrai quand Apple accorde encore l'essai à cet identifiant Apple, et `offer` vaut alors `{ displayPrice, price, paymentMode, period: { unit, value }, periodCount }` ; l'app n'annonce un essai que si `introEligible` et `paymentMode = 'freeTrial'` (`accessTrialOf`), et sa durée est `period × periodCount`. Sinon elle montre le prix normal. (chaîne déjà formatée par Apple dans la monnaie de la boutique) ; `price` est un **nombre**, inutilisable tel quel à l'écran. `missing` liste les identifiants qu'Apple ne connaît pas encore (contrat **Paid Apps** non signé, produit pas encore « Prêt à être envoyé ») : `products` est alors **vide** et l'écran le dit, sans prix inventé.
- `purchase({ productId, appAccountToken? })` : **ne rejette jamais** sur annulation. Il résout `{ status: 'success' | 'userCancelled' | 'pending' }` ; pour `success`, la réponse porte **toute la transaction** (`jws`, `transactionId`, `originalTransactionId`, `productId`, `purchasedAt`, `expiresAt`, `revokedAt`, `environment`, `subscription`…). L'app passe **toujours** `appAccountToken` = identifiant du compte MDLF (UUID Supabase) : sans lui, un achat dont la vérification échoue (réseau coupé juste après le paiement) devient **orphelin**, le serveur ne pouvant le rattacher à aucun compte. Un vrai problème (produit absent, preuve non vérifiée) est un rejet avec un code.
- `finish({ transactionId })` → `{ finished, reason? }` : **obligatoire**. `purchase()`, `restore()`, `current()` et l'écouteur rendent le JWS **sans terminer** la transaction, exprès : un achat perdu par le réseau revient au lancement suivant (`Transaction.unfinished`). L'app appelle `finish()` **après** que le serveur a confirmé, ou sur un refus définitif (`invalid_jws`, `bad_bundle`, `unknown_product`). **Jamais** sur une erreur passagère (503 : Apple injoignable) ni sur `transaction_taken` : la transaction est gardée, et simplement plus réenvoyée tant qu'on reste sur ce compte.
- `restore()` → `{ synced, cancelled, entitlements, unverified }`. `AppStore.sync()` demande le mot de passe du compte Apple : à n'appeler que sur « Restaurer mes achats ». **Le JWS est dans chaque `entitlements[i]`, jamais à la racine** ; l'app les envoie tous. Fermer la fenêtre d'Apple n'est pas une erreur (`cancelled: true`, les droits déjà connus sont rendus).
- `current()` → `{ entitlements, unverified }` : les droits en cours (`Transaction.currentEntitlements`) **sans rien demander à l'utilisateur**. L'app le lit au lancement quand le verrou est allumé et `can_write` faux, pour rattraper un achat qui n'est jamais arrivé au serveur (réseau coupé, app réinstallée, nouvel iPhone).
- `redeemCode()` → `{ presented: true }`, ou `{ presented: false, cancelled: true }` si la fenêtre est fermée : **ce n'est pas un succès**. Elle n'accepte que les **codes d'offre d'abonnement** d'Apple ; les **codes cadeaux maison** se saisissent dans un champ de l'app. L'écran propose les deux séparément et ne promet jamais qu'un code d'Apple se saisit dans l'app.
- **Écouteur permanent** `Transaction.updates` (plus `Transaction.unfinished` au lancement) : toute transaction (renouvellement, code utilisé, achat sur un autre appareil) est transmise au serveur, puis terminée par `finish()`. Le module émet le même événement sous **deux noms** (`transaction` et `change`, en `retainUntilConsumed`) : l'app s'abonne à **un seul** des deux, sinon chaque transaction serait traitée deux fois.
- Une transaction `.unverified` (signature d'Apple invalide) est **refusée par le module**, jamais transmise au web et jamais finie.

Hors app iOS (web) : aucun achat possible, l'écran invite à utiliser l'app.

## Ordre de déploiement (relecture du 28/10)
Toujours dans cet ordre, une étape seulement quand la précédente est en place :
1. **Contrôle avant la migration**, en lecture seule, sur la production : `select status, count(*) from public.entitlements group by 1;` (les lignes `trial` deviennent `none`, les anciens « Accès offert » perdent leur accès à vie ; rien d'autre ne doit surprendre). `tests/sql/upgrade_test.sh` rejoue cette montée de version sur des données réalistes.
2. **Migration** `20261029000000_payant_modele_b.sql`.
3. **Fonctions Edge** `verify-purchase` et `appstore-notify`. Elles envoient `p_intro` et `p_environment` : déployées AVANT la migration, la base ne connaîtrait pas ces paramètres et refuserait chaque achat et chaque notification.
4. **Build de l'app ET mise à jour à chaud, ensemble** (une seule étape) : `StorePlugin.swift` change, donc l'**empreinte native** change, et une mise à jour à chaud publiée avant la build n'atteindrait aucun appareil. Le contenu web lit `paywall_on` et `min_build` sans compte (lecture `anon`, posée par la migration) et ne connaît plus le statut `trial` : il ne doit pas précéder la migration.

**Version minimale (`min_build`)** : `app_config.min_build` (livré à 0, lisible sans compte comme `paywall_on`) est la build native minimale. Une app dont la build est plus ancienne affiche un écran « Mets à jour l'app » (lien TestFlight, à remplacer par la page App Store à la sortie publique) qui ne se ferme pas ; ses séances restent sur l'iPhone. Ce code part AVEC la build payante : il protège les builds suivantes. Le jour d'allumer le verrou, régler `min_build` sur la première build payante :
`update public.app_config set value = '<build>'::jsonb, updated_at = now() where key = 'min_build';`

**Builds déjà installées sans ce code** (celles d'avant le payant) : elles ne recevront jamais le nouveau contenu web (empreinte native) et ne liront pas `min_build`. Verrou allumé, leur synchronisation échouerait au premier refus sans rien proposer. **On attend qu'elles ne soient plus utilisées avant d'allumer le verrou.** Ces builds n'appellent jamais `my_access()` : un compte qui synchronise encore mais n'a pas de ligne `entitlements` tourne sur une ancienne build. Requête de contrôle (lecture seule), à voir tomber à zéro :
`select count(*) from auth.users u where exists (select 1 from public.sessions s where s.user_id = u.id and s.updated_at > now() - interval '14 days') and not exists (select 1 from public.entitlements e where e.user_id = u.id);`
Les utilisateurs sans compte d'une ancienne build ne synchronisent rien : le verrou ne les touche pas.

**Allumer le verrou**, plus tard, après validation de Maxence :
- vérifier que la requête des anciennes builds ci-dessus est tombée à zéro, et régler `min_build` sur la première build payante ;
- publier une mise à jour à chaud avec **`PAYWALL_LAUNCHED = true`** dans `js/data/access.js` (sans elle, un verrou jamais lu ne ferme jamais rien) ;
- puis `update public.app_config set value = 'true'::jsonb, updated_at = now() where key = 'paywall_on';`
- et ne plus publier de lien TestFlight public (voir « Sandbox accepté »).

## Ce qui reste à faire par Maxence (ne peut pas être fait par l'API)
1. Signer le contrat **Paid Apps** sur App Store Connect.
2. Vérifier le statut micro-entreprise pour la vente d'applications.
3. Configurer l'**offre de lancement** « 3 mois gratuits » sur les deux abonnements, et supprimer le produit « Accès offert » (`com.mdlf.training.access.gift`).
4. Créer un **testeur Sandbox** pour l'essai d'achat réel.
5. Fournir l'**URL de notification** à App Store Connect et la clé d'API **In-App Purchase**.
6. Suivre l'**ordre de déploiement** ci-dessus : contrôle, migration, `verify-purchase` (sa ligne `verify_jwt = false` est dans `supabase/config.toml`) et `appstore-notify` (avec `--no-verify-jwt`), mise à jour à chaud, build.
7. Poser les secrets des Edge Functions : `APPLE_IAP_KEY_ID`, `APPLE_IAP_PRIVATE_KEY`, `APPLE_ISSUER_ID`. `APPLE_ALLOW_SANDBOX` n'existe plus (le Sandbox est toujours accepté) : le retirer s'il avait été posé.
8. Trancher la règle 5.1.1(v) (note ci-dessus), et le lien TestFlight public (voir « Sandbox accepté »).
9. Fabriquer ses premiers codes cadeaux : `select private.make_gift_code('days', 90, 10, 'Beta');`
